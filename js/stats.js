// js/stats.js — Statistics Dashboard controller and non-editable trend graphs.
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
  // 2. EXERCISE-SPECIFIC NON-EDITABLE TREND GRAPHS
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
          <p>Select an exercise above to view non-editable performance trends.</p>
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

    // Render 4 Non-editable sub-charts in a responsive 2x2 grid
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

  // Helper to generate a mini non-editable SVG chart
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

    // Modal close buttons
    $("btnCloseDtsModal")?.addEventListener("click", closeBreakdownModal);
    $("dtsBreakdownModal")?.addEventListener("click", (e) => {
      if (e.target === $("dtsBreakdownModal")) closeBreakdownModal();
    });

    // Refresh when store changes
    if (window.Store?.onChange) {
      window.Store.onChange(() => {
        if ($("statsView") && !$("statsView").hidden) {
          render();
        }
      });
    }
  }

  function render() {
    renderDtsChart();
    populateExercisePicker();
  }

  return {
    init,
    render,
    renderDtsChart,
    renderExerciseTrends,
    openBreakdownModal,
    closeBreakdownModal
  };
})();

