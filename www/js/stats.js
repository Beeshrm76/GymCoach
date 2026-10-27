// js/stats.js — Statistics Dashboard controller and progression trend graphs.
// Renders Daily Training Score (DTS) trend graph, explainable score breakdown,
// and exercise-specific progression graphs (Estimated 1RM, Volume Load, Max Weight, Intensity).

window.StatsDashboard = (() => {
  const $ = id => document.getElementById(id);

  let selectedRange = "30d"; // '7d', '30d', '90d', 'all'
  let selectedExerciseName = "";
  let dailyScoresCache = {};
  let dailyLogsCache = {}; // { [date]: { exercises: [], cardio: [] } }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Gather all historical logs grouped by date (YYYY-MM-DD)
  function aggregateHistory() {
    const byDate = {};
    const projects = window.Store?.all() || [];

    projects.forEach(p => {
      (p.days || []).forEach(day => {
        // Collect exercises
        (day.exercises || []).forEach(ex => {
          (ex.logs || []).forEach(log => {
            if (!log.date) return;
            const dKey = log.date.slice(0, 10);
            if (!byDate[dKey]) byDate[dKey] = { exercises: [], cardio: [] };

            let exEntry = byDate[dKey].exercises.find(e => e.name === ex.name);
            if (!exEntry) {
              exEntry = { name: ex.name, logs: [] };
              byDate[dKey].exercises.push(exEntry);
            }
            exEntry.logs.push(log);
          });
        });

        // Collect cardio
        (day.cardio || []).forEach(c => {
          const dKey = c.date ? c.date.slice(0, 10) : "";
          if (!dKey) return;
          if (!byDate[dKey]) byDate[dKey] = { exercises: [], cardio: [] };
          byDate[dKey].cardio.push(c);
        });
      });
    });

    dailyLogsCache = byDate;
    return byDate;
  }

  // Compute DTS for every date in history
  function computeAllDailyScores() {
    const byDate = aggregateHistory();
    const sortedDates = Object.keys(byDate).sort();

    const userProfile = window.Store?.profile()?.current || {};
    const userWeight = Number(userProfile.weight) || 75;

    const scores = {};
    const historyWorkloads = [];

    sortedDates.forEach(dKey => {
      const dayData = byDate[dKey];
      const scoreObj = window.DTS.calculateDailyScore({
        exercises: dayData.exercises,
        cardio: dayData.cardio,
        userBodyWeightKg: userWeight,
        historyWorkloads: [...historyWorkloads],
        getExerciseMetaFn: window.ExerciseMetadata?.get
      });

      scores[dKey] = scoreObj;

      // Add to history for subsequent days' EWMA baseline
      if (scoreObj.strengthWorkload > 0 || scoreObj.cardioWorkload > 0) {
        historyWorkloads.push({
          date: dKey,
          strengthWorkload: scoreObj.strengthWorkload,
          cardioWorkload: scoreObj.cardioWorkload
        });
      }
    });

    dailyScoresCache = scores;
    debouncedSyncScores();
    return scores;
  }

  // Sync daily scores to Supabase daily_training_scores table
  let isSyncingScores = false;
  let syncScoresTimer = null;

  function debouncedSyncScores() {
    if (syncScoresTimer) clearTimeout(syncScoresTimer);
    syncScoresTimer = setTimeout(syncScoresToCloud, 2500);
  }

  async function syncScoresToCloud() {
    const user = window.Auth?.getUser();
    const sb = window.supabaseClient;
    if (!user || !sb || isSyncingScores) return;

    const dates = Object.keys(dailyScoresCache);
    if (!dates.length) return;

    isSyncingScores = true;
    try {
      const records = dates.map(dKey => {
        const s = dailyScoresCache[dKey];
        let bandEnum = 'REST';
        const b = (s.band || '').toUpperCase();
        if (b.includes('VERY HIGH')) bandEnum = 'VERY_HIGH';
        else if (b.includes('HIGH')) bandEnum = 'HIGH';
        else if (b.includes('MODERATE') || b.includes('REFERENCE')) bandEnum = 'MODERATE';
        else if (b.includes('LOW')) bandEnum = 'LOW';

        return {
          user_id: user.id,
          workout_date: dKey,
          score: s.dts,
          score_band: bandEnum,
          strength_component: s.strengthComponent || 0,
          cardio_component: s.cardioContribution || 0,
          strength_workload: s.strengthWorkload || 0,
          cardio_workload: s.cardioWorkload || 0,
          scoring_version: String(s.scoringVersion || 'v1'),
          reference_version: Number(s.referenceVersion || 1),
          details: {
            strengthDetails: s.strengthDetails || {},
            cardioDetails: s.cardioDetails || {}
          },
          updated_at: new Date().toISOString()
        };
      });

      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        const { error } = await sb.from('daily_training_scores').upsert(batch, {
          onConflict: 'user_id, workout_date'
        });
        if (error) {
          console.warn("Could not sync daily_training_scores batch:", error.message);
          break;
        }
      }
    } catch (e) {
      console.warn("DTS cloud sync skipped:", e.message);
    } finally {
      isSyncingScores = false;
    }
  }

  // Filter dates by active range
  function getFilteredDates(allDates) {
    if (!allDates.length) return [];
    if (selectedRange === "all") return allDates;

    const daysCount = selectedRange === "7d" ? 7 : selectedRange === "90d" ? 90 : 30;
    const now = new Date();
    const cutoff = new Date(now.getTime() - (daysCount * 24 * 60 * 60 * 1000));
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    return allDates.filter(d => d >= cutoffKey);
  }

  // -------------------------------------------------------------
  // 1. RENDER DTS DAILY TREND GRAPH (SVG)
  // -------------------------------------------------------------
  function renderDtsChart() {
    const container = $("dtsChartContainer");
    if (!container) return;

    computeAllDailyScores();
    const allDates = Object.keys(dailyScoresCache).sort();
    const dates = getFilteredDates(allDates);

    if (!dates.length) {
      container.innerHTML = `
        <div class="stats-empty-state">
          <div style="font-size:32px; margin-bottom:8px;">📊</div>
          <p>No workout logs found in this time range.</p>
          <small class="muted">Log your sets on Today or Build to see your Daily Training Score.</small>
        </div>
      `;
      updateKpis([]);
      return;
    }

    // Chart dimensions
    const W = 800;
    const H = 260;
    const padL = 45;
    const padR = 25;
    const padT = 30;
    const padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const dataPoints = dates.map((dKey, idx) => {
      const score = dailyScoresCache[dKey]?.dts || 0;
      const x = dates.length === 1 ? padL + (chartW / 2) : padL + (idx / (dates.length - 1)) * chartW;
      const y = padT + chartH - (score / 100) * chartH;
      return { date: dKey, score, x, y };
    });

    // Generate SVG path for line
    let pathD = "";
    if (dataPoints.length === 1) {
      pathD = `M ${dataPoints[0].x - 10} ${dataPoints[0].y} L ${dataPoints[0].x + 10} ${dataPoints[0].y}`;
    } else {
      pathD = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    }

    // Area fill path
    const areaD = dataPoints.length > 1
      ? `${pathD} L ${dataPoints[dataPoints.length - 1].x.toFixed(1)} ${padT + chartH} L ${dataPoints[0].x.toFixed(1)} ${padT + chartH} Z`
      : "";

    // Y Axis guidelines (0, 20, 40, 60, 80, 100)
    const yLines = [0, 20, 40, 60, 80, 100].map(val => {
      const y = padT + chartH - (val / 100) * chartH;
      return `
        <g class="grid-line-group">
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="${val === 50 ? '4 4' : 'none'}" />
          <text x="${padL - 8}" y="${y + 4}" fill="var(--text-muted, #94a3b8)" font-size="10" text-anchor="end">${val}</text>
        </g>
      `;
    }).join("");

    // X Axis date labels (sample every few points to prevent overlap)
    const step = Math.max(1, Math.ceil(dates.length / 6));
    const xLabels = dates.filter((_, i) => i % step === 0 || i === dates.length - 1).map(dKey => {
      const idx = dates.indexOf(dKey);
      const x = dates.length === 1 ? padL + (chartW / 2) : padL + (idx / (dates.length - 1)) * chartW;
      const formatted = formatDateLabel(dKey);
      return `<text x="${x}" y="${H - 12}" fill="var(--text-muted, #94a3b8)" font-size="10" text-anchor="middle">${formatted}</text>`;
    }).join("");

    // Interactive Circles
    const circles = dataPoints.map(p => `
      <circle class="dts-data-dot" data-date="${p.date}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"
        fill="var(--accent, #00f2fe)" stroke="#0f172a" stroke-width="2"
        style="cursor:pointer; transition:transform 0.2s;"
      >
        <title>${p.date}: DTS ${p.score} (${dailyScoresCache[p.date]?.band || ''})</title>
      </circle>
    `).join("");

    container.innerHTML = `
      <svg class="dts-svg" viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; overflow:visible;">
        <defs>
          <linearGradient id="dtsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent, #00f2fe)" stop-opacity="0.35" />
            <stop offset="100%" stop-color="var(--accent, #00f2fe)" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${yLines}
        ${areaD ? `<path d="${areaD}" fill="url(#dtsGrad)" />` : ''}
        <path d="${pathD}" fill="none" stroke="var(--accent, #00f2fe)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
        ${xLabels}
      </svg>
    `;

    // Wire clicks on circles to open breakdown modal
    container.querySelectorAll(".dts-data-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        const dKey = dot.dataset.date;
        openBreakdownModal(dKey);
      });
      dot.addEventListener("mouseenter", () => dot.setAttribute("r", "7"));
      dot.addEventListener("mouseleave", () => dot.setAttribute("r", "5"));
    });

    updateKpis(dates);
  }

  function formatDateLabel(dKey) {
    if (!dKey) return "";
    const parts = dKey.split("-");
    if (parts.length < 3) return dKey;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${months[mIdx] || parts[1]} ${parseInt(parts[2], 10)}`;
  }

  // Update top KPI cards
  function updateKpis(dates) {
    if (!$("kpiAvgDts")) return;
    if (!dates.length) {
      $("kpiAvgDts").textContent = "—";
      $("kpiMaxDts").textContent = "—";
      $("kpiWorkoutsCount").textContent = "0";
      $("kpiStrengthCardioRatio").textContent = "—";
      return;
    }

    let sumDts = 0;
    let maxDts = 0;
    let maxDate = "";
    let totalStrengthVol = 0;
    let totalCardioVol = 0;

    dates.forEach(dKey => {
      const s = dailyScoresCache[dKey];
      if (s) {
        sumDts += s.dts;
        if (s.dts > maxDts) {
          maxDts = s.dts;
          maxDate = dKey;
        }
        totalStrengthVol += s.strengthWorkload || 0;
        totalCardioVol += s.cardioWorkload || 0;
      }
    });

    const avgDts = Math.round(sumDts / dates.length);
    $("kpiAvgDts").textContent = avgDts;
    $("kpiMaxDts").textContent = maxDts > 0 ? `${maxDts} (${formatDateLabel(maxDate)})` : "—";
    $("kpiWorkoutsCount").textContent = dates.length;

    const totalLoad = totalStrengthVol + (totalCardioVol * 10);
    if (totalLoad > 0) {
      const strengthPct = Math.round((totalStrengthVol / totalLoad) * 100);
      $("kpiStrengthCardioRatio").textContent = `${strengthPct}% Strength / ${100 - strengthPct}% Cardio`;
    } else {
      $("kpiStrengthCardioRatio").textContent = "100% Strength";
    }
  }

  // -------------------------------------------------------------
  // 2. EXERCISE-SPECIFIC TREND GRAPHS
  // -------------------------------------------------------------
  function populateExercisePicker() {
    const picker = $("statsExercisePicker");
    if (!picker) return;

    aggregateHistory();
    const setOfExercises = new Set();
    Object.values(dailyLogsCache).forEach(day => {
      (day.exercises || []).forEach(e => {
        if (e.logs && e.logs.length > 0) setOfExercises.add(e.name);
      });
    });

    const exerciseNames = Array.from(setOfExercises).sort();
    if (!exerciseNames.length) {
      picker.innerHTML = `<option value="">No exercises logged yet</option>`;
      selectedExerciseName = "";
      renderExerciseTrends();
      return;
    }

    picker.innerHTML = exerciseNames.map(name => `
      <option value="${esc(name)}" ${name === selectedExerciseName ? 'selected' : ''}>${esc(name)}</option>
    `).join("");

    if (!selectedExerciseName || !setOfExercises.has(selectedExerciseName)) {
      selectedExerciseName = exerciseNames[0];
      picker.value = selectedExerciseName;
    }

    renderExerciseTrends();
  }

  function renderExerciseTrends() {
    const container = $("exerciseTrendsContainer");
    if (!container) return;

    if (!selectedExerciseName) {
      container.innerHTML = `
        <div class="stats-empty-state">
          <p>Select an exercise above to view performance trends.</p>
        </div>
      `;
      return;
    }

    // Extract sessions for selected exercise across all dates
    const dates = Object.keys(dailyLogsCache).sort();
    const series = [];

    const meta = window.ExerciseMetadata?.get(selectedExerciseName) || {
      bodyweight_factor: 0,
      scoring_multiplier: 1.0
    };
    const userProfile = window.Store?.profile()?.current || {};
    const userWeight = Number(userProfile.weight) || 75;

    dates.forEach(dKey => {
      const dayData = dailyLogsCache[dKey];
      const exData = (dayData.exercises || []).find(e => e.name === selectedExerciseName);
      if (!exData || !exData.logs || !exData.logs.length) return;

      let max1RM = 0;
      let maxWeight = 0;
      let maxReps = 0;
      let totalVolume = 0;
      let completedSets = 0;

      exData.logs.forEach(log => {
        const w = Number(log.values?.weight ?? log.values?.Weight) || 0;
        const r = Number(log.values?.reps ?? log.values?.Reps) || 0;
        if (r > 0) {
          completedSets++;
          const effectiveLoad = window.DTS.calculateEffectiveLoad(w, meta, userWeight);
          const epley = window.DTS.calculateEpley1RM(effectiveLoad, r);
          if (epley > max1RM) max1RM = epley;
          if (w > maxWeight) maxWeight = w;
          if (r > maxReps) maxReps = r;
          totalVolume += (effectiveLoad * r);
        }
      });

      if (completedSets > 0) {
        series.push({
          date: dKey,
          max1RM: Math.round(max1RM),
          maxWeight: Math.round(maxWeight),
          maxReps,
          totalVolume: Math.round(totalVolume),
          completedSets
        });
      }
    });

    if (!series.length) {
      container.innerHTML = `
        <div class="stats-empty-state">
          <p>No completed sets recorded for <b>${esc(selectedExerciseName)}</b> yet.</p>
        </div>
      `;
      return;
    }

    // Render 4 progression sub-charts in a responsive 2x2 grid
    container.innerHTML = `
      <div class="exercise-charts-grid">
        <!-- 1. Estimated 1RM Progression -->
        <div class="panel exercise-trend-card">
          <div class="panel-head">
            <div>
              <h3>Estimated 1RM Progression</h3>
              <small class="muted">Calculated via Epley formula: weight × (1 + reps/30)</small>
            </div>
          </div>
          <div class="trend-svg-box" id="chart1RM">
            ${renderMiniLineChart(series, 'max1RM', 'kg', 'var(--accent, #00f2fe)')}
          </div>
        </div>

        <!-- 2. Volume Load Progression -->
        <div class="panel exercise-trend-card">
          <div class="panel-head">
            <div>
              <h3>Volume Load Progression</h3>
              <small class="muted">Total effective weight × reps per session</small>
            </div>
          </div>
          <div class="trend-svg-box" id="chartVolume">
            ${renderMiniLineChart(series, 'totalVolume', 'kg', 'var(--accent-secondary, #9d4edd)')}
          </div>
        </div>

        <!-- 3. Max Weight Progression -->
        <div class="panel exercise-trend-card">
          <div class="panel-head">
            <div>
              <h3>Max Weight Progression</h3>
              <small class="muted">Heaviest external load lifted per session</small>
            </div>
          </div>
          <div class="trend-svg-box" id="chartMaxWeight">
            ${renderMiniLineChart(series, 'maxWeight', 'kg', '#38ef7d')}
          </div>
        </div>

        <!-- 4. Max Reps Progression -->
        <div class="panel exercise-trend-card">
          <div class="panel-head">
            <div>
              <h3>Max Reps Progression</h3>
              <small class="muted">Highest reps achieved in a single set</small>
            </div>
          </div>
          <div class="trend-svg-box" id="chartMaxReps">
            ${renderMiniLineChart(series, 'maxReps', 'reps', '#f5af19')}
          </div>
        </div>
      </div>
    `;
  }

  // Helper to generate a mini progression SVG chart
  function renderMiniLineChart(series, key, unit, strokeColor) {
    const W = 360;
    const H = 160;
    const padL = 40;
    const padR = 20;
    const padT = 20;
    const padB = 30;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const values = series.map(s => s[key] || 0);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal === 0 ? 1 : maxVal - minVal;

    const points = series.map((s, idx) => {
      const x = series.length === 1 ? padL + (chartW / 2) : padL + (idx / (series.length - 1)) * chartW;
      const y = padT + chartH - ((s[key] - minVal) / range) * chartH;
      return { date: s.date, val: s[key], x, y };
    });

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

    const circles = points.map(p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${strokeColor}" stroke="#0f172a" stroke-width="1.5">
        <title>${p.date}: ${p.val} ${unit}</title>
      </circle>
    `).join("");

    const xLabels = [series[0].date, series[series.length - 1].date].filter(Boolean).map((d, i) => {
      const x = i === 0 ? padL : W - padR;
      const anchor = i === 0 ? "start" : "end";
      return `<text x="${x}" y="${H - 8}" fill="var(--text-muted, #94a3b8)" font-size="9" text-anchor="${anchor}">${formatDateLabel(d)}</text>`;
    }).join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">
        <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="rgba(255,255,255,0.07)" />
        <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="rgba(255,255,255,0.07)" />
        <text x="${padL - 6}" y="${padT + 4}" fill="var(--text-muted, #94a3b8)" font-size="9" text-anchor="end">${maxVal}</text>
        <text x="${padL - 6}" y="${padT + chartH + 4}" fill="var(--text-muted, #94a3b8)" font-size="9" text-anchor="end">${minVal}</text>
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
        ${xLabels}
      </svg>
    `;
  }

  // -------------------------------------------------------------
  // 3. EXPLAINABLE SCORE BREAKDOWN MODAL (Section 13.2 & 18)
  // -------------------------------------------------------------
  function openBreakdownModal(dateKey) {
    const modal = $("dtsBreakdownModal");
    if (!modal) return;

    const score = dailyScoresCache[dateKey];
    if (!score) return;

    $("modalDtsDate").textContent = `${formatDateLabel(dateKey)} (${dateKey})`;
    $("modalDtsScore").textContent = score.dts;
    $("modalDtsBand").textContent = score.band;
    $("modalDtsBand").className = `role-badge badge-${score.band.toLowerCase().replace(/\s+/g, '-')}`;

    // Contributions
    $("modalStrengthScore").textContent = score.strengthComponent;
    $("modalCardioScore").textContent = `+${score.cardioContribution}`;

    // Strength details
    $("modalStrengthWorkload").textContent = `${score.strengthWorkload.toLocaleString()} kg`;
    $("modalStrengthRef").textContent = `${score.activeStrengthReference.toLocaleString()} kg`;
    $("modalStrengthNorm").textContent = `${score.strengthNormalized}x`;
    $("modalStrengthSets").textContent = score.strengthDetails.totalSets;
    $("modalStrengthReps").textContent = score.strengthDetails.totalReps;

    // Render exercises in breakdown table
    const exTbody = $("modalExercisesTableBody");
    if (exTbody) {
      if (!score.strengthDetails.exercises || !score.strengthDetails.exercises.length) {
        exTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No resistance exercises logged.</td></tr>`;
      } else {
        exTbody.innerHTML = score.strengthDetails.exercises.map(ex => `
          <tr>
            <td><b>${esc(ex.name)}</b></td>
            <td><span class="role-badge">${esc(ex.metadata?.exercise_type || 'compound')}</span></td>
            <td>${ex.sets} sets × ${ex.reps} reps</td>
            <td>${ex.weightedVolume.toLocaleString()} kg</td>
            <td>${ex.max1RM > 0 ? `${ex.max1RM} kg` : '—'}</td>
          </tr>
        `).join("");
      }
    }

    // Cardio details
    $("modalCardioWorkload").textContent = `${score.cardioWorkload} units`;
    if ($("modalCardioTreadmill")) $("modalCardioTreadmill").textContent = score.cardioDetails.aggregates?.treadmill || 0;
    if ($("modalCardioCycling")) $("modalCardioCycling").textContent = score.cardioDetails.aggregates?.cycling || 0;
    if ($("modalCardioOther")) $("modalCardioOther").textContent = score.cardioDetails.aggregates?.other || 0;
    $("modalCardioRef").textContent = `${score.activeCardioReference} units`;
    $("modalCardioNorm").textContent = `${score.cardioNormalized}x`;
    $("modalCardioDuration").textContent = `${score.cardioDetails.totalDuration} min`;
    $("modalCardioSpeed").textContent = score.cardioDetails.avgSpeed > 0 ? `${score.cardioDetails.avgSpeed} km/h` : "—";
    $("modalCardioIncline").textContent = score.cardioDetails.avgIncline > 0 ? `${score.cardioDetails.avgIncline}%` : "0%";

    // Versions
    $("modalScoringVersion").textContent = `v${score.scoringVersion}`;
    $("modalRefVersion").textContent = `Ref v${score.referenceVersion}`;

    modal.style.display = "flex";
  }

  function closeBreakdownModal() {
    const modal = $("dtsBreakdownModal");
    if (modal) modal.style.display = "none";
  }

  // -------------------------------------------------------------
  // 4. BODY WEIGHT CHANGE TREND GRAPH
  // -------------------------------------------------------------
  function renderWeightTrendChart() {
    const container = $("weightTrendChartContainer");
    if (!container) return;

    const prof = window.Store?.profile() || { current: {}, history: [] };
    const history = Array.isArray(prof.history) ? [...prof.history] : [];
    
    // Check if current is not yet in history
    if (prof.current?.weight && !history.some(h => h.date === prof.current.date)) {
      history.unshift({ ...prof.current });
    }

    const validEntries = history
      .filter(h => h && h.weight && !isNaN(parseFloat(h.weight)))
      .map(h => ({
        date: h.date ? h.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
        weight: parseFloat(h.weight)
      }));

    // Sort chronologically (oldest first)
    validEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Deduplicate by date if multiple on same day (take latest)
    const deduped = [];
    const seen = new Set();
    for (let i = validEntries.length - 1; i >= 0; i--) {
      if (!seen.has(validEntries[i].date)) {
        seen.add(validEntries[i].date);
        deduped.unshift(validEntries[i]);
      }
    }

    // Update KPI badges
    const kpiCurrent = $("weightKpiCurrent");
    const kpiChange = $("weightKpiChange");
    const kpiMinMax = $("weightKpiMinMax");

    if (!deduped.length) {
      if (kpiCurrent) kpiCurrent.innerHTML = `Current: <b>—</b>`;
      if (kpiChange) kpiChange.innerHTML = `Change: <b>—</b>`;
      if (kpiMinMax) kpiMinMax.innerHTML = `Range: <b>—</b>`;

      container.innerHTML = `
        <div class="stats-empty-state" style="padding: 30px 20px; text-align: center;">
          <p class="muted">No body weight logged yet. Save your current weight in Home (Weekly Check) or User Profile to view your trend over time.</p>
        </div>
      `;
      return;
    }

    const currentW = deduped[deduped.length - 1].weight;
    const startW = deduped[0].weight;
    const netChange = currentW - startW;
    const allWeights = deduped.map(d => d.weight);
    const minW = Math.min(...allWeights);
    const maxW = Math.max(...allWeights);

    if (kpiCurrent) kpiCurrent.innerHTML = `Current: <b>${currentW.toFixed(1)} kg</b> <small style="color:var(--text-secondary);">(${(currentW * 2.20462).toFixed(1)} lb)</small>`;
    if (kpiChange) {
      const sign = netChange > 0 ? "+" : "";
      const changeColor = netChange < 0 ? "var(--accent, #00f2fe)" : netChange > 0 ? "#f5af19" : "var(--text-secondary)";
      kpiChange.innerHTML = `Change: <b style="color:${changeColor};">${sign}${netChange.toFixed(1)} kg</b>`;
    }
    if (kpiMinMax) kpiMinMax.innerHTML = `Range: <b>${minW.toFixed(1)} – ${maxW.toFixed(1)} kg</b>`;

    // Render SVG
    const W = 800;
    const H = 220;
    const pad = { top: 25, right: 30, bottom: 35, left: 55 };

    const yMin = Math.floor(minW - 1);
    const yMax = Math.ceil(maxW + 1);
    const yRange = (yMax - yMin) || 1;

    const getX = (idx, total) => total <= 1 ? pad.left + (W - pad.left - pad.right) / 2 : pad.left + (idx / (total - 1)) * (W - pad.left - pad.right);
    const getY = (val) => pad.top + (1 - (val - yMin) / yRange) * (H - pad.top - pad.bottom);

    // Y Grid lines
    const ySteps = 4;
    let yLines = "";
    for (let i = 0; i <= ySteps; i++) {
      const val = yMin + (i / ySteps) * yRange;
      const y = getY(val);
      yLines += `
        <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />
        <text x="${pad.left - 10}" y="${y + 4}" font-size="11" fill="var(--text-secondary)" text-anchor="end">${val.toFixed(1)}</text>
      `;
    }

    // Points
    const points = deduped.map((d, i) => ({
      x: getX(i, deduped.length),
      y: getY(d.weight),
      date: d.date,
      weight: d.weight
    }));

    let pathD = "";
    let areaD = "";
    if (points.length === 1) {
      pathD = `M ${points[0].x - 20} ${points[0].y} L ${points[0].x + 20} ${points[0].y}`;
    } else {
      pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      const bottomY = H - pad.bottom;
      areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${bottomY} L ${points[0].x.toFixed(1)} ${bottomY} Z`;
    }

    const circles = points.map(p => `
      <circle 
        cx="${p.x.toFixed(1)}" 
        cy="${p.y.toFixed(1)}" 
        r="5" 
        fill="#38ef7d" 
        stroke="var(--bg-primary, #0d1117)" 
        stroke-width="2" 
        style="cursor: pointer; transition: r 0.15s ease;"
        class="weight-data-dot"
        data-date="${p.date}"
        data-weight="${p.weight}"
      >
        <title>${p.date}: ${p.weight} kg (${(p.weight * 2.20462).toFixed(1)} lb)</title>
      </circle>
    `).join("");

    // X Labels (sample if too many)
    const step = Math.max(1, Math.floor(points.length / 6));
    const xLabels = points.filter((p, i) => i === 0 || i === points.length - 1 || i % step === 0).map(p => `
      <text x="${p.x.toFixed(1)}" y="${H - 12}" font-size="11" fill="var(--text-secondary)" text-anchor="middle">
        ${formatDateLabel(p.date)}
      </text>
    `).join("");

    container.innerHTML = `
      <svg class="weight-svg" viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; overflow:visible;">
        <defs>
          <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38ef7d" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#38ef7d" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${yLines}
        ${areaD ? `<path d="${areaD}" fill="url(#weightGrad)" />` : ''}
        <path d="${pathD}" fill="none" stroke="#38ef7d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
        ${xLabels}
      </svg>
    `;

    // Add hover micro-interactions
    container.querySelectorAll(".weight-data-dot").forEach(dot => {
      dot.addEventListener("mouseenter", () => dot.setAttribute("r", "8"));
      dot.addEventListener("mouseleave", () => dot.setAttribute("r", "5"));
    });
  }

  // -------------------------------------------------------------
  // 5. 7-DATE BODY COMPOSITION & METRIC PREDICTOR PANEL
  // -------------------------------------------------------------
  let selectedPredictionMetric = "all"; // 'all', 'weight', 'bodyFat', 'waist', 'chest', 'arm'
  let sampleDataActive = false;
  let originalProfileBackup = null;

  const PREDICTION_METRICS = [
    { key: "weight", label: "Body Weight", unit: "kg", altUnit: "lb", altFactor: 2.20462, icon: "⚖️", color: "#00f2fe" },
    { key: "bodyFat", label: "Body Fat", unit: "%", altUnit: "", altFactor: 1, icon: "💧", color: "#38ef7d" },
    { key: "waist", label: "Waist Size", unit: "cm", altUnit: "in", altFactor: 0.393701, icon: "📏", color: "#f5af19" },
    { key: "chest", label: "Chest Size", unit: "cm", altUnit: "in", altFactor: 0.393701, icon: "👕", color: "#a855f7" },
    { key: "biceps", label: "Biceps Size", unit: "cm", altUnit: "in", altFactor: 0.393701, icon: "💪", color: "#ff416c" },
    { key: "forearm", label: "Forearm Size", unit: "cm", altUnit: "in", altFactor: 0.393701, icon: "✊", color: "#ff8c00" },
    { key: "arm", label: "Arm Size", unit: "cm", altUnit: "in", altFactor: 0.393701, icon: "💪", color: "#ff416c", isAlias: true }
  ];

  function getChronologicalLoggedBodyDates() {
    const prof = window.Store?.profile() || { current: {}, history: [] };
    const history = Array.isArray(prof.history) ? [...prof.history] : [];
    
    // Check if current is not yet in history
    if (prof.current && (prof.current.weight || prof.current.waist || prof.current.chest || prof.current.biceps || prof.current.arm || prof.current.forearm || prof.current.bodyFat)) {
      if (!history.some(h => h.date && prof.current.date && h.date.slice(0, 10) === prof.current.date.slice(0, 10))) {
        history.unshift({ ...prof.current });
      }
    }

    const validEntries = history
      .map(h => {
        if (!h) return null;
        const w = (h.weight !== undefined && h.weight !== null && h.weight !== "") ? parseFloat(h.weight) : null;
        const waist = (h.waist !== undefined && h.waist !== null && h.waist !== "") ? parseFloat(h.waist) : null;
        const chest = (h.chest !== undefined && h.chest !== null && h.chest !== "") ? parseFloat(h.chest) : null;
        const bicepVal = (h.biceps !== undefined && h.biceps !== null && h.biceps !== "") ? parseFloat(h.biceps)
          : (h.arm !== undefined && h.arm !== null && h.arm !== "") ? parseFloat(h.arm) : null;
        const forearmVal = (h.forearm !== undefined && h.forearm !== null && h.forearm !== "") ? parseFloat(h.forearm) : null;
        let bf = (h.bodyFat !== undefined && h.bodyFat !== null && h.bodyFat !== "") ? parseFloat(h.bodyFat) : null;
        
        let bfEstimated = false;
        if ((bf === null || isNaN(bf)) && w !== null && !isNaN(w) && waist !== null && !isNaN(waist)) {
          // YMCA Anthropometric body fat formula fallback estimation
          const wLbs = w * 2.20462;
          const wIn = waist / 2.54;
          const calculatedBf = ((4.15 * wIn) - (0.082 * wLbs) - 98.42) / wLbs * 100;
          bf = Math.round(Math.max(6.0, Math.min(45.0, calculatedBf)) * 10) / 10;
          bfEstimated = true;
        }

        const hasAny = [w, waist, chest, bicepVal, forearmVal, bf].some(v => v !== null && !isNaN(v));
        if (!hasAny) return null;

        return {
          date: h.date ? h.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
          weight: !isNaN(w) && w !== null ? w : null,
          waist: !isNaN(waist) && waist !== null ? waist : null,
          chest: !isNaN(chest) && chest !== null ? chest : null,
          biceps: !isNaN(bicepVal) && bicepVal !== null ? bicepVal : null,
          arm: !isNaN(bicepVal) && bicepVal !== null ? bicepVal : null,
          forearm: !isNaN(forearmVal) && forearmVal !== null ? forearmVal : null,
          bodyFat: !isNaN(bf) && bf !== null ? bf : null,
          bodyFatEstimated: bfEstimated
        };
      })
      .filter(Boolean);

    // Sort chronologically (oldest first)
    validEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Deduplicate by date (keep latest on same day)
    const deduped = [];
    const seen = new Set();
    for (let i = validEntries.length - 1; i >= 0; i--) {
      if (!seen.has(validEntries[i].date)) {
        seen.add(validEntries[i].date);
        deduped.unshift(validEntries[i]);
      }
    }

    return deduped;
  }

  function evaluateMetricRegression(points) {
    const valid = points.filter(p => p.y !== null && !isNaN(p.y));
    const n = valid.length;
    if (n < 2) {
      const val = n === 1 ? valid[0].y : 0;
      return { slope: 0, intercept: val, r2: 1, current: val, next: val, forecast30d: val, delta: 0, n };
    }

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    valid.forEach(p => {
      sumX += p.x;
      sumY += p.y;
      sumXY += (p.x * p.y);
      sumXX += (p.x * p.x);
    });

    const denom = (n * sumXX - sumX * sumX);
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // R2 correlation
    const meanY = sumY / n;
    let ssTot = 0, ssRes = 0;
    valid.forEach(p => {
      ssTot += Math.pow(p.y - meanY, 2);
      ssRes += Math.pow(p.y - (slope * p.x + intercept), 2);
    });
    const r2 = ssTot > 0 ? Math.max(0, 1 - (ssRes / ssTot)) : 1;

    const current = valid[valid.length - 1].y;
    const first = valid[0].y;
    const delta = current - first;
    
    const nextX = points.length;
    const f30dX = points.length + 3;
    const nextVal = Math.round((slope * nextX + intercept) * 10) / 10;
    const f30dVal = Math.round((slope * f30dX + intercept) * 10) / 10;

    return {
      slope: Math.round(slope * 100) / 100,
      intercept,
      r2: Math.round(r2 * 100) / 100,
      current: Math.round(current * 10) / 10,
      next: nextVal,
      forecast30d: f30dVal,
      delta: Math.round(delta * 10) / 10,
      n
    };
  }

  function togglePredictionDemoData() {
    const btn = $("btnPredictionDemoData");
    if (sampleDataActive) {
      // Restore backup
      if (originalProfileBackup) {
        localStorage.setItem("gym_profile", JSON.stringify(originalProfileBackup));
      }
      sampleDataActive = false;
      originalProfileBackup = null;
      if (btn) btn.textContent = "Load 7-Date Sample";
      if (window.UI?.toast) window.UI.toast("Restored original profile data");
    } else {
      // Backup current
      try {
        const raw = localStorage.getItem("gym_profile");
        originalProfileBackup = raw ? JSON.parse(raw) : null;
      } catch (_) { originalProfileBackup = null; }

      // Generate 7 progressive sample dates
      const sampleList = [];
      const now = new Date();
      const baseW = 77.2;
      const baseBf = 17.5;
      const baseWaist = 85.0;
      const baseChest = 101.0;
      const baseBiceps = 36.4;
      const baseForearm = 29.8;

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - (i * 7));
        const dateStr = d.toISOString().slice(0, 10);
        const step = 6 - i; // 0 to 6
        sampleList.push({
          date: `${dateStr}T12:00:00.000Z`,
          weight: (baseW - step * 0.45).toFixed(1),
          bodyFat: (baseBf - step * 0.42).toFixed(1),
          waist: (baseWaist - step * 0.6).toFixed(1),
          chest: (baseChest + step * 0.25).toFixed(1),
          biceps: (baseBiceps + step * 0.18).toFixed(1),
          arm: (baseBiceps + step * 0.18).toFixed(1),
          forearm: (baseForearm + step * 0.12).toFixed(1)
        });
      }

      const pData = {
        current: sampleList[6],
        history: sampleList.slice().reverse()
      };
      localStorage.setItem("gym_profile", JSON.stringify(pData));
      sampleDataActive = true;
      if (btn) btn.textContent = "Reset My Data";
      if (window.UI?.toast) window.UI.toast("Loaded 7-date evaluation progression sample!");
    }

    render();
    window.Home?.render?.();
  }

  function renderBodyPredictionPanel() {
    const panel = $("bodyPredictionPanel");
    if (!panel) return;

    const allDates = getChronologicalLoggedBodyDates();
    const evalDates = allDates.slice(-7); // Evaluate last 7 logged dates results
    const count = evalDates.length;

    // 1. Evaluation Badge
    const badge = $("predictionEvalBadge");
    if (badge) {
      if (count >= 7) {
        badge.textContent = "✓ 7 Logged Dates Evaluated (100% Calibrated)";
        badge.className = "prediction-eval-badge calibrated";
      } else if (count > 0) {
        badge.textContent = `Evaluating ${count}/7 Logged Dates`;
        badge.className = "prediction-eval-badge evaluating";
      } else {
        badge.textContent = "Waiting for Logged Dates (0/7)";
        badge.className = "prediction-eval-badge empty";
      }
    }

    // 2. Timeline Strip
    const timelineStrip = $("predictionTimelineStrip");
    if (timelineStrip) {
      if (count === 0) {
        timelineStrip.innerHTML = `
          <div class="prediction-empty-notice">
            <span>ℹ️ No measurement dates logged yet. Enter your weekly check-in or click <b>Load 7-Date Sample</b> above to evaluate predictions.</span>
          </div>
        `;
      } else {
        const pills = evalDates.map((d, i) => `
          <div class="pred-timeline-node">
            <span class="pred-node-num">#${i + 1}</span>
            <span class="pred-node-date">${formatDateLabel(d.date)}</span>
            <small class="pred-node-val">${d.weight ? `${d.weight}kg` : ''}${d.bodyFat ? ` · ${d.bodyFat}%` : ''}</small>
          </div>
        `).join('<div class="pred-timeline-arrow">→</div>');

        const nextForecastNode = `
          <div class="pred-timeline-arrow forecast-arrow">⤏</div>
          <div class="pred-timeline-node forecast-node">
            <span class="pred-node-num">#8</span>
            <span class="pred-node-date">Next Projected</span>
            <small class="pred-node-val">AI Forecast</small>
          </div>
        `;

        timelineStrip.innerHTML = pills + nextForecastNode;
      }
    }

    // 3. Compute regression for all metrics
    const evaluations = {};
    PREDICTION_METRICS.forEach(m => {
      const points = evalDates.map((d, idx) => ({ x: idx, y: d[m.key] }));
      evaluations[m.key] = evaluateMetricRegression(points);
    });
    if (evaluations.biceps && !evaluations.arm) evaluations.arm = evaluations.biceps;
    if (evaluations.arm && !evaluations.biceps) evaluations.biceps = evaluations.arm;

    // 4. Render Metric Cards Grid (exclude alias)
    const displayMetrics = PREDICTION_METRICS.filter(m => !m.isAlias);
    const cardsGrid = $("predictionCardsGrid");
    if (cardsGrid) {
      if (count === 0) {
        cardsGrid.innerHTML = `
          <div class="stats-empty-state" style="grid-column: 1 / -1; padding: 24px; text-align: center;">
            <p class="muted">Log your measurements across 7 dates in <b>Home → Weekly Check</b> to generate predictive models for Body Weight, Body Fat, Chest, Waist, Biceps, and Forearm size.</p>
          </div>
        `;
      } else {
        cardsGrid.innerHTML = displayMetrics.map(m => {
          const reg = evaluations[m.key];
          const hasData = reg && reg.n > 0 && reg.current > 0;
          const altCurrent = m.altUnit && hasData ? ` (${(reg.current * m.altFactor).toFixed(1)} ${m.altUnit})` : '';
          const altNext = m.altUnit && hasData ? ` (${(reg.next * m.altFactor).toFixed(1)} ${m.altUnit})` : '';
          
          let sign = reg.slope > 0 ? "+" : "";
          let slopeColor = "var(--text-secondary)";
          let statusText = "Stable";

          if (m.key === "weight") {
            if (reg.slope < -0.1) { statusText = "Trending Down (Cutting)"; slopeColor = "#00f2fe"; }
            else if (reg.slope > 0.1) { statusText = "Trending Up (Bulking)"; slopeColor = "#f5af19"; }
          } else if (m.key === "bodyFat") {
            if (reg.slope < -0.05) { statusText = "Leaning Down"; slopeColor = "#38ef7d"; }
            else if (reg.slope > 0.05) { statusText = "Fat Gain"; slopeColor = "#ff416c"; }
          } else if (m.key === "waist") {
            if (reg.slope < -0.1) { statusText = "Trimming Waist"; slopeColor = "#38ef7d"; }
            else if (reg.slope > 0.1) { statusText = "Expanding"; slopeColor = "#f5af19"; }
          } else if (m.key === "chest" || m.key === "biceps" || m.key === "forearm" || m.key === "arm") {
            if (reg.slope > 0.05) { statusText = "Hypertrophy Growth"; slopeColor = "#38ef7d"; }
            else if (reg.slope < -0.05) { statusText = "Volume Depleting"; slopeColor = "#ff416c"; }
          }

          const isCardActive = selectedPredictionMetric === m.key || (m.key === "biceps" && selectedPredictionMetric === "arm");

          return `
            <div class="panel prediction-kpi-card ${isCardActive ? 'card-active' : ''}" style="border-top: 3px solid ${m.color}; cursor: pointer;" onclick="window.StatsDashboard?.setPredictionMetric('${m.key}')">
              <div class="pred-card-header">
                <span class="pred-card-title">${m.icon} ${m.label}</span>
                <span class="pred-card-status" style="color:${slopeColor}; font-size:11px; font-weight:600;">${statusText}</span>
              </div>
              
              <div class="pred-card-values">
                <div class="pred-val-group">
                  <span class="pred-val-label">Current (#${count})</span>
                  <b class="pred-val-main" style="color:${m.color};">${hasData ? `${reg.current} ${m.unit}` : '—'}</b>
                  <small class="muted">${altCurrent}</small>
                </div>
                <div class="pred-val-divider"></div>
                <div class="pred-val-group">
                  <span class="pred-val-label">Projected Next (#${count + 1})</span>
                  <b class="pred-val-target">${hasData ? `${reg.next} ${m.unit}` : '—'}</b>
                  <small class="muted">${altNext}</small>
                </div>
              </div>

              <div class="pred-card-footer">
                <span class="pred-slope-pill" style="color:${slopeColor};">
                  ${hasData ? `${sign}${reg.slope} ${m.unit}/check` : 'No slope'}
                </span>
                <span class="pred-30d-pill" title="30-day forecast (+4 checks)">
                  30d: <b>${hasData ? `${reg.forecast30d} ${m.unit}` : '—'}</b>
                </span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 5. Render Chart Container
    renderPredictionChart(evalDates, evaluations);

    // 6. AI Composition Trajectory Insight
    const insightBox = $("predictionInsightBox");
    if (insightBox) {
      if (count < 2) {
        insightBox.innerHTML = `
          <div class="pred-insight-content">
            <span class="pred-insight-icon">🤖</span>
            <div>
              <b>AI Trajectory Diagnostic</b>
              <p class="muted small">Evaluation activates automatically when at least 2 logged dates are available, reaching peak clinical predictive power at 7 logged dates.</p>
            </div>
          </div>
        `;
      } else {
        const wS = evaluations.weight.slope;
        const bfS = evaluations.bodyFat.slope;
        const waistS = evaluations.waist.slope;
        const chestS = evaluations.chest.slope;
        const bicepS = evaluations.biceps?.slope ?? evaluations.arm?.slope ?? 0;
        const forearmS = evaluations.forearm?.slope ?? 0;

        let diagTitle = "Body Composition Equilibrium";
        let diagBadge = "Maintaining";
        let diagDesc = "Your evaluated measurements indicate stable baseline maintenance with balanced caloric and hypertrophy equilibrium.";

        if (waistS < -0.08 && (chestS > 0.04 || bicepS > 0.03 || forearmS > 0.02)) {
          diagTitle = "Optimal Body Recomposition (Fat Loss + Hypertrophy)";
          diagBadge = "Recomp Active";
          diagDesc = `Exceptional adaptation: Your waist is narrowing by ${Math.abs(waistS)} cm per check while chest (+${chestS} cm), biceps (+${bicepS} cm), and forearm (+${forearmS} cm) musculature are expanding. This verifies visceral/subcutaneous fat reduction alongside skeletal muscle protein synthesis.`;
        } else if (wS < -0.15 && waistS < -0.1) {
          diagTitle = "Deficit Phase / Active Fat Loss Trajectory";
          diagBadge = "Cutting";
          diagDesc = `Steady leaning trajectory: Weight is dropping by ${Math.abs(wS)} kg/check and waist by ${Math.abs(waistS)} cm/check. Next projected milestone projects weight at ${evaluations.weight.next} kg (${evaluations.bodyFat.next}% body fat).`;
        } else if (wS > 0.15 && (chestS > 0.05 || bicepS > 0.04 || forearmS > 0.03) && waistS <= 0.12) {
          diagTitle = "Lean Hypertrophy / Clean Mass Gain";
          diagBadge = "Lean Bulk";
          diagDesc = `High muscle-sparing surplus: Mass is climbing at +${wS} kg/check with significant upper torso, bicep, and forearm development while keeping waist circumferences under control.`;
        } else if (wS > 0.2 && waistS > 0.2) {
          diagTitle = "Mass Building Surplus Trajectory";
          diagBadge = "Hypertrophy Surplus";
          diagDesc = `Accelerated mass accumulation: Weight and circumferences are increasing. Projected 30-day weight is ${evaluations.weight.forecast30d} kg.`;
        }

        const dateRangeStr = count >= 2 ? `${formatDateLabel(evalDates[0].date)} to ${formatDateLabel(evalDates[count - 1].date)}` : '';

        insightBox.innerHTML = `
          <div class="pred-insight-card">
            <div class="pred-insight-head">
              <span class="pred-insight-icon">🧠</span>
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                  <b>${diagTitle}</b>
                  <span class="pred-status-tag">${diagBadge}</span>
                </div>
                <small class="muted">Evaluated over ${count} logged dates (${dateRangeStr})</small>
              </div>
            </div>
            <p class="pred-insight-text">${diagDesc}</p>
            <div class="pred-next-forecast-summary">
              <b>Target Projections for Check #${count + 1}:</b> 
              <span>Weight <b>${evaluations.weight.next} kg</b></span> · 
              <span>Body Fat <b>${evaluations.bodyFat.next}%</b></span> · 
              <span>Waist <b>${evaluations.waist.next} cm</b></span> · 
              <span>Chest <b>${evaluations.chest.next} cm</b></span> · 
              <span>Biceps <b>${(evaluations.biceps || evaluations.arm).next} cm</b></span> · 
              <span>Forearm <b>${evaluations.forearm ? evaluations.forearm.next : '—'} cm</b></span>
            </div>
          </div>
        `;
      }
    }

    // 7. Update Home view quick card
    renderHomePredictionQuickCard(count, evaluations);
  }

  function renderPredictionChart(evalDates, evaluations) {
    const container = $("predictionChartContainer");
    if (!container) return;

    if (!evalDates || evalDates.length < 2) {
      container.innerHTML = `
        <div class="stats-empty-state" style="padding: 30px; text-align: center;">
          <p class="muted">Interactive predictive trajectory chart will render once 2 or more logged dates are evaluated.</p>
        </div>
      `;
      return;
    }

    const metricKey = selectedPredictionMetric === "all" ? "weight" : selectedPredictionMetric;
    const metricDef = PREDICTION_METRICS.find(m => m.key === metricKey) || PREDICTION_METRICS[0];
    const reg = evaluations[metricKey];

    const W = 800;
    const H = 220;
    const pad = { top: 25, right: 60, bottom: 35, left: 55 };

    // Points: actual historical evaluated points + 2 future forecast points
    const histPoints = evalDates.map((d, i) => ({
      xIdx: i,
      val: d[metricKey],
      date: d.date,
      type: "actual"
    })).filter(p => p.val !== null && !isNaN(p.val));

    const totalSteps = evalDates.length + 3; // hist points + next + 30d
    const nextPt = {
      xIdx: evalDates.length,
      val: reg.next,
      date: "Next Check",
      type: "forecast"
    };
    const f30dPt = {
      xIdx: evalDates.length + 2,
      val: reg.forecast30d,
      date: "+30 Days",
      type: "forecast"
    };

    const allPts = [...histPoints, nextPt, f30dPt];
    const allVals = allPts.map(p => p.val);
    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);

    const yMin = Math.floor(minVal - (minVal * 0.02) - 0.5);
    const yMax = Math.ceil(maxVal + (maxVal * 0.02) + 0.5);
    const yRange = (yMax - yMin) || 1;

    const getX = (stepIdx) => pad.left + (stepIdx / (totalSteps - 1)) * (W - pad.left - pad.right);
    const getY = (val) => pad.top + (1 - (val - yMin) / yRange) * (H - pad.top - pad.bottom);

    // Grid lines
    let yLines = "";
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = yMin + (i / ySteps) * yRange;
      const y = getY(val);
      yLines += `
        <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />
        <text x="${pad.left - 10}" y="${y + 4}" font-size="11" fill="var(--text-secondary)" text-anchor="end">${val.toFixed(1)} ${metricDef.unit}</text>
      `;
    }

    // Historical solid line path
    const histPathD = histPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.xIdx).toFixed(1)} ${getY(p.val).toFixed(1)}`).join(" ");
    
    // Future forecast dashed line path starting from last historical point
    const lastHist = histPoints[histPoints.length - 1];
    const forePathD = `M ${getX(lastHist.xIdx).toFixed(1)} ${getY(lastHist.val).toFixed(1)} L ${getX(nextPt.xIdx).toFixed(1)} ${getY(nextPt.val).toFixed(1)} L ${getX(f30dPt.xIdx).toFixed(1)} ${getY(f30dPt.val).toFixed(1)}`;

    // Shaded area under actual history
    const bottomY = H - pad.bottom;
    const histAreaD = `${histPathD} L ${getX(lastHist.xIdx).toFixed(1)} ${bottomY} L ${getX(histPoints[0].xIdx).toFixed(1)} ${bottomY} Z`;

    // Historical circles
    const circles = histPoints.map(p => `
      <circle 
        cx="${getX(p.xIdx).toFixed(1)}" 
        cy="${getY(p.val).toFixed(1)}" 
        r="5" 
        fill="${metricDef.color}" 
        stroke="var(--bg-primary, #0d1117)" 
        stroke-width="2" 
        style="cursor: pointer; transition: r 0.15s ease;"
        class="pred-data-dot"
      >
        <title>Evaluated Date #${p.xIdx + 1} (${p.date}): ${p.val} ${metricDef.unit}</title>
      </circle>
    `).join("");

    // Forecast diamond points
    const forePointsHtml = [nextPt, f30dPt].map(p => {
      const cx = getX(p.xIdx);
      const cy = getY(p.val);
      return `
        <polygon 
          points="${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}" 
          fill="#f5af19" 
          stroke="var(--bg-primary, #0d1117)" 
          stroke-width="2" 
          style="cursor: pointer;"
        >
          <title>${p.date} Prediction: ${p.val} ${metricDef.unit} (Slope: ${reg.slope} ${metricDef.unit}/check)</title>
        </polygon>
        <text x="${cx}" y="${cy - 10}" font-size="10" font-weight="700" fill="#f5af19" text-anchor="middle">${p.val}</text>
      `;
    }).join("");

    // X Labels
    const histLabels = histPoints.map((p) => `
      <text x="${getX(p.xIdx).toFixed(1)}" y="${H - 12}" font-size="11" fill="var(--text-secondary)" text-anchor="middle">
        ${formatDateLabel(p.date)}
      </text>
    `).join("");

    const forecastLabels = `
      <text x="${getX(nextPt.xIdx).toFixed(1)}" y="${H - 12}" font-size="11" font-weight="600" fill="#f5af19" text-anchor="middle">Next Target</text>
      <text x="${getX(f30dPt.xIdx).toFixed(1)}" y="${H - 12}" font-size="11" font-weight="600" fill="#f5af19" text-anchor="middle">+30 Days</text>
    `;

    // Divider line between actual and forecast
    const divX = getX(lastHist.xIdx) + (getX(nextPt.xIdx) - getX(lastHist.xIdx)) / 2;
    const dividerLine = `
      <line x1="${divX}" y1="${pad.top}" x2="${divX}" y2="${H - pad.bottom}" stroke="rgba(245, 175, 25, 0.4)" stroke-dasharray="4 4" stroke-width="1.5" />
      <text x="${divX + 6}" y="${pad.top + 10}" font-size="10" font-weight="600" fill="#f5af19">AI Trajectory ➔</text>
    `;

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:12px; font-weight:600; color:var(--text-secondary);">
          Viewing Trajectory: <b style="color:${metricDef.color};">${metricDef.icon} ${metricDef.label}</b> (Evaluated across ${evalDates.length} logged dates)
        </span>
        <span style="font-size:11px; color:var(--text-secondary);">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${metricDef.color};margin-right:4px;"></span>Evaluated 7-Date History
          <span style="display:inline-block;width:12px;height:2px;border-top:2px dashed #f5af19;margin:0 4px 0 10px;"></span>Predicted Trajectory
        </span>
      </div>
      <svg class="prediction-svg" viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; overflow:visible;">
        <defs>
          <linearGradient id="predAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${metricDef.color}" stop-opacity="0.25" />
            <stop offset="100%" stop-color="${metricDef.color}" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        ${yLines}
        ${dividerLine}
        <path d="${histAreaD}" fill="url(#predAreaGrad)" />
        <path d="${histPathD}" fill="none" stroke="${metricDef.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <path d="${forePathD}" fill="none" stroke="#f5af19" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round" />
        ${circles}
        ${forePointsHtml}
        ${histLabels}
        ${forecastLabels}
      </svg>
    `;

    container.querySelectorAll(".pred-data-dot").forEach(dot => {
      dot.addEventListener("mouseenter", () => dot.setAttribute("r", "8"));
      dot.addEventListener("mouseleave", () => dot.setAttribute("r", "5"));
    });
  }

  function renderHomePredictionQuickCard(count, evaluations) {
    const card = $("homePredictionQuickCard");
    if (!card) return;

    if (!evaluations || count === 0) {
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px;">
          <div>
            <b style="font-size:13px;">7-Date Body Metric Predictor</b>
            <p class="muted small" style="margin:2px 0 0 0;">Save weekly check-ins to evaluate future trajectory for weight, body fat, chest, waist, biceps, and forearm size.</p>
          </div>
          <button class="btn small-btn primary" onclick="window.StatsDashboard?.openPredictionPanel()">View Predictor</button>
        </div>
      `;
      return;
    }

    const badgeLabel = count >= 7 ? "✓ 7 Dates Evaluated" : `${count}/7 Dates Evaluated`;
    const badgeClass = count >= 7 ? "calibrated" : "evaluating";

    const displayMetrics = PREDICTION_METRICS.filter(m => !m.isAlias);
    const pills = displayMetrics.map(m => {
      const reg = evaluations[m.key];
      const val = reg && reg.n > 0 ? `${reg.next} ${m.unit}` : "—";
      return `
        <div class="home-pred-pill" style="border-left:2px solid ${m.color};">
          <span class="home-pred-label">${m.icon} ${m.label.split(' ')[0]}</span>
          <b class="home-pred-val">${val}</b>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="home-pred-widget" style="padding:14px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <b style="font-size:13px;">7-Date AI Body Predictor</b>
            <span class="prediction-eval-badge-mini ${badgeClass}">${badgeLabel}</span>
          </div>
          <button class="btn small-btn" style="font-size:11px;" onclick="window.StatsDashboard?.openPredictionPanel()">View Full Predictor Dashboard →</button>
        </div>
        <div class="home-pred-pills-row">
          ${pills}
        </div>
      </div>
    `;
  }

  function setPredictionMetric(metricKey) {
    if (metricKey === "arm") metricKey = "biceps";
    selectedPredictionMetric = metricKey;
    document.querySelectorAll("[data-pred-metric]").forEach(b => {
      b.classList.toggle("active", b.dataset.predMetric === metricKey || (metricKey === "biceps" && b.dataset.predMetric === "arm"));
    });
    renderBodyPredictionPanel();
  }

  function openPredictionPanel() {
    // Switch to stats view and scroll to bodyPredictionPanel
    const navStats = document.querySelector("[data-action='nav'][data-target='statsView']");
    if (navStats) navStats.click();
    else if (window.UI?.showView) window.UI.showView("statsView");
    
    setTimeout(() => {
      $("bodyPredictionPanel")?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  }

  // Initialize and attach event listeners
  function init() {
    // Range buttons
    document.querySelectorAll("[data-stats-range]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-stats-range]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedRange = btn.dataset.statsRange;
        renderDtsChart();
      });
    });

    // Exercise picker
    $("statsExercisePicker")?.addEventListener("change", (e) => {
      selectedExerciseName = e.target.value;
      renderExerciseTrends();
    });

    // Prediction metric tabs
    document.querySelectorAll("[data-pred-metric]").forEach(btn => {
      btn.addEventListener("click", () => {
        setPredictionMetric(btn.dataset.predMetric);
      });
    });

    // Prediction demo data button
    $("btnPredictionDemoData")?.addEventListener("click", togglePredictionDemoData);

    // Modal close buttons
    $("btnCloseDtsModal")?.addEventListener("click", closeBreakdownModal);
    $("dtsBreakdownModal")?.addEventListener("click", (e) => {
      if (e.target === $("dtsBreakdownModal")) closeBreakdownModal();
    });

    // Refresh when store changes
    if (window.Store?.onChange) {
      window.Store.onChange(() => {
        renderHomePredictionQuickCard();
        if ($("statsView") && !$("statsView").hidden) {
          render();
        }
      });
    }
  }

  function render() {
    renderDtsChart();
    renderWeightTrendChart();
    renderBodyPredictionPanel();
    populateExercisePicker();
  }

  return {
    init,
    render,
    renderDtsChart,
    renderWeightTrendChart,
    renderBodyPredictionPanel,
    renderExerciseTrends,
    setPredictionMetric,
    openPredictionPanel,
    openBreakdownModal,
    closeBreakdownModal
  };
})();


