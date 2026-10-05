// report.js - the AI Coach export. One payload that captures the whole project so a
// coach model never has to guess at missing context.
//
// Captured: project metadata; every day in order with its type and metadata; every
// exercise with targets, RIR/rest/tempo/equipment/notes/cues; each exercise's custom
// column definitions; EVERY set row with its values resolved against those column
// labels, its per-set note, completion flag and timestamp; whether an image/video is
// attached; per-day and per-project completion; and the body-measurement history.
//
//

window.ReportCoach = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => UI.esc(v);
  const dash = v => (String(v ?? "").trim() || "not counted");

  // The 0-5 intensity score as a word. This was called in three places below but
  // never defined anywhere in the project, so snapshot() threw a ReferenceError on
  // every path - which silently blanked the AI Coach view and killed all seven of
  // its export buttons. It now lives in store.js next to the score it describes.
  const intensityBand = score => Store.intensityBand(score);

  // ------------------------------------------------------------- snapshot

  function snapshot({ allProjects = false } = {}) {
    const projects = allProjects ? Store.all() : [Store.active()];
    return {
      app: "GymCoach",
      schema: 4,
      exportedAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activeProjectId: Store.active().id,
      body: Store.profile(),
      projects: projects.map(projectSnapshot)
    };
  }

  function projectSnapshot(p) {
    const prog = Store.projectProgress(p);
    return {
      id: p.id,
      name: p.name,
      goal: p.goal,
      description: p.description,
      notes: p.notes,
      cardioDays: p.days.filter(d => d.type === "workout" && d.cardio?.length).length,
      structure: {
        totalDays: p.days.length,
        workoutDays: p.days.filter(d => d.type === "workout").length,
        restDays: p.days.filter(d => d.type === "rest").length,
        totalExercises: p.days.reduce((n, d) => n + d.exercises.length, 0),
        totalSetRows: p.days.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.logs.length, 0), 0)
      },
      completion: prog,
      intensity: intensityBand(Store.projectIntensity ? Store.projectIntensity(p) : 0),
      days: p.days.map((d, i) => daySnapshot(d, i))
    };
  }

  // ------------------------------------------------------------- DTS Report Helper

  function computeDtsReportData(d) {
    if (!window.DTS) return null;

    const allProjects = Store.all ? Store.all() : [Store.active()];
    const today = Store.todayKey ? Store.todayKey() : new Date().toISOString().slice(0, 10);
    const userProfile = Store.profile ? Store.profile()?.current : {};
    const userWeight = Number(userProfile?.weight) || 75;

    // Aggregate all historical logs by date
    const historyByDate = {};
    allProjects.forEach(p => {
      (p.days || []).forEach(day => {
        (day.exercises || []).forEach(ex => {
          (ex.logs || []).forEach(log => {
            if (!log.date) return;
            const dk = log.date.slice(0, 10);
            if (!historyByDate[dk]) historyByDate[dk] = { exercises: [], cardio: [] };
            let exEntry = historyByDate[dk].exercises.find(e => e.name === ex.name);
            if (!exEntry) {
              exEntry = { name: ex.name, logs: [] };
              historyByDate[dk].exercises.push(exEntry);
            }
            exEntry.logs.push(log);
          });
        });
        (day.cardio || []).forEach(c => {
          const dk = c.date ? c.date.slice(0, 10) : "";
          if (!dk) return;
          if (!historyByDate[dk]) historyByDate[dk] = { exercises: [], cardio: [] };
          historyByDate[dk].cardio.push(c);
        });
      });
    });

    const dates = Object.keys(historyByDate).sort();
    const prevDates = dates.filter(k => k < today);
    const isFirstWeek = prevDates.length === 0;

    let currentScore = null;
    try {
      currentScore = window.DTS.calculateDailyScore({
        exercises: d ? d.exercises : [],
        cardio: d ? (d.cardio || []) : [],
        userBodyWeightKg: userWeight,
        getExerciseMetaFn: window.ExerciseMetadata?.get
      });
    } catch (e) {
      console.warn("DTS current score calculation failed:", e);
    }

    const last3Scores = [];
    const recentPrevDates = [...prevDates].reverse().slice(0, 3);
    recentPrevDates.forEach(dk => {
      try {
        const sc = window.DTS.calculateDailyScore({
          exercises: historyByDate[dk].exercises,
          cardio: historyByDate[dk].cardio,
          userBodyWeightKg: userWeight,
          getExerciseMetaFn: window.ExerciseMetadata?.get
        });
        last3Scores.push({
          date: dk,
          dts: sc.dts,
          band: sc.band,
          strengthComponent: sc.strengthComponent || 0,
          cardioContribution: sc.cardioContribution || 0,
          strengthWorkload: sc.strengthWorkload || 0,
          cardioWorkload: sc.cardioWorkload || 0
        });
      } catch (err) {
        console.warn("DTS historical score calculation failed for", dk, err);
      }
    });

    const ref = window.DTS.REFERENCE_CONFIG || {};
    const cfg = window.DTS.DTS_CONFIG || {};

    return {
      isFirstWeek,
      currentScore: currentScore ? {
        dts: currentScore.dts,
        band: currentScore.band,
        strengthComponent: currentScore.strengthComponent || 0,
        cardioContribution: currentScore.cardioContribution || 0,
        strengthWorkload: currentScore.strengthWorkload || 0,
        cardioWorkload: currentScore.cardioWorkload || 0,
        strengthNormalized: currentScore.strengthNormalized || 0,
        cardioNormalized: currentScore.cardioNormalized || 0
      } : null,
      last3Scores,
      scoringDetails: {
        version: ref.scoringVersion || "1.0",
        referenceVersion: ref.referenceVersion || 1,
        strengthReference: ref.strengthReference || 10000,
        cardioReference: ref.cardioReference || 150,
        kStrength: ref.k_strength || 2.0,
        kCardio: ref.k_cardio || 2.0,
        cardioMaxContribution: cfg.cardioMaxContribution || 25,
        formula: "Bounded Sigmoid Normalization: Score = 100 / (1 + exp(-2 * (Normalized_Load - 1)))",
        weights: "80% Resistance Training (max 80 pts) + 20% Cardio / Conditioning (max +25 pts)",
        ewmaInfo: "30-day EWMA (alpha=0.15) personal baseline blending begins after 5 qualifying workouts"
      }
    };
  }

  function daySnapshot(d, index) {
    const prog = Store.dayProgress(d);
    return {
      order: index + 1,
      id: d.id,
      name: d.name,
      type: d.type,
      title: d.title,
      subtitle: d.subtitle,
      focus: d.focus,
      muscles: d.muscles,
      restNotes: d.restNotes,
      intensity: intensityBand(Store.dayIntensity ? Store.dayIntensity(d) : 0),
      dts: d.type === "workout" ? computeDtsReportData(d) : null,
      cardio: (d.cardio || []).map(entry => ({
        type: dash(entry.type),
        duration: dash(entry.duration),
        calories: dash(entry.calories),
        incline: dash(entry.incline),
        speed: dash(entry.speed),
        gear: dash(entry.gear),
        notes: dash(entry.notes),
        loggedAt: entry.date || null
      })),
      completion: prog,
      exercises: d.type === "workout" ? d.exercises.map((ex, i) => exerciseSnapshot(ex, i, d)) : []
    };
  }

  function exerciseSnapshot(ex, index, d) {
    const unit = Store.normalizeWeightUnit(ex.weightUnit);
    const pulley = Store.pulleyKey(ex.pulleySystem);
    const col = (key, pattern) => (ex.setColumns || []).find(c => c.key === key)
      || (ex.setColumns || []).find(c => pattern.test(String(c.label || "")));
    const wCol = col("weight", /weight|load/i);
    const tCol = col("time", /time|dur|sec/i);
    const recordedTotal = ex.logs.reduce((s, l) =>
      s + (window.DataPipeline?.clockSeconds(tCol ? l.values?.[tCol.key] : "") || 0), 0);

    // Previous week / previous session performance
    const prevRows = Store.previousSessionRows ? Store.previousSessionRows(ex) : [];
    let previousWeekPerformance = "not counted";
    if (prevRows.length) {
      const prevDate = prevRows[0]?.date ? Store.dateKey(prevRows[0].date) : "";
      const setsData = prevRows.map((r, sIdx) => {
        const wtVal = r.values?.weight ?? r.weightRaw ?? "";
        const repsVal = r.values?.reps ?? "";
        const rirVal = r.rir ?? "";
        const timeVal = r.values?.time ?? "";
        const isDone = !!r.completed;
        const parts = [];
        if (wtVal) parts.push(`${wtVal} ${unit}`);
        if (repsVal) parts.push(`${repsVal} reps`);
        if (timeVal) parts.push(`time: ${timeVal}`);
        if (rirVal) parts.push(`RIR: ${rirVal}`);
        return `Set ${sIdx + 1}: ${parts.join(" × ") || "logged"}${isDone ? " [done]" : ""}`;
      });
      previousWeekPerformance = {
        date: prevDate,
        setsCompleted: prevRows.filter(r => r.completed).length,
        totalSets: prevRows.length,
        sets: setsData
      };
    }

    return {
      order: index + 1,
      id: ex.id,
      name: ex.name,
      phase: ex.phase || "main",
      previousWeekPerformance,
      target: {
        weight: dash(ex.weight),
        weightUnit: dash(ex.weightUnit),
        reps: dash(ex.reps),
        sets: ex.sets || ex.logs.length || 0,
        pulleySystem: dash(ex.pulleySystem),
        pulleyRatio: Store.pulleyRatio(pulley),
        // The standardised number to compare lifts on: kg after the pulley ratio.
        effectiveWeightKg: dash(Store.effectiveKg(ex.weight, unit, pulley))
      },
      rest: {
        plannedSec: Number(ex.restStats?.plannedSec || 0),
        extraSec: Number(ex.restStats?.extraSec || 0),
        balanceSec: Number(ex.restStats?.balanceSec || 0),
        defaultDelaySec: Number(ex.restStats?.defaultDelaySec || 0),
        // "Total after balancing": the timer total once the delay balance is applied.
        totalSec: Number(ex.restStats?.totalSec || 0) || recordedTotal
      },
      details: {
        targetRIR: dash(ex.details.targetRIR),
        rest: dash(ex.details.rest),
        tempo: dash(ex.details.tempo),
        equipment: dash(ex.details.equipment),
        notes: dash(ex.details.notes),
        cues: ex.details.cues || []
      },
      setColumns: ex.setColumns.map(c => ({ key: c.key, label: c.label })),
      completed: Store.isExerciseDone(ex),
      intensity: intensityBand(Store.exerciseIntensity ? Store.exerciseIntensity(ex) : 0),
      setsCompleted: Store.currentSessionRows ? Store.currentSessionRows(ex).filter(l => l.completed).length : ex.logs.filter(l => l.completed).length,
      media: { image: !!ex.image, video: !!ex.video, note: "uploaded media is stored locally and not included in this export" },
      // Values labelled, not raw-keyed, so a renamed column stays readable.
      // Each set also carries the workout's actual clock time for that date,
      // so a coach model can look for peak-performance-by-time-of-day patterns.
      sets: ex.logs.map((log, i) => {
        const wt = Store.getWorkTime ? Store.getWorkTime(d, Store.dateKey(log.date) || Store.todayKey()) : null;
        return {
          set: i + 1,
          completed: !!log.completed,
          loggedAt: log.date || null,
          workoutStart: dash(wt && wt.startTime ? `${wt.startTime} ${wt.startAmPm || ""}`.trim() : ""),
          workoutEnd: dash(wt && wt.endTime ? `${wt.endTime} ${wt.endAmPm || ""}`.trim() : ""),
          // RIR is stored per set and is deliberately not one of the set columns
          // (store.js strips it from values), so it has to be reported separately.
          rir: dash(log.rir),
          effectiveWeightKg: dash(Store.effectiveKg(wCol ? log.values?.[wCol.key] : "", unit, pulley)),
          values: ex.setColumns.reduce((o, c) => { o[c.label] = dash(log.values[c.key]); return o; }, {}),
          note: dash(log.notes)
        };
      })
    };
  }

  // -------------------------------------------------------------- prompt

  function secondsText(sec) { sec=Math.max(0,Math.round(Number(sec)||0)); return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`; }

  function buildPrompt(opts = {}) {
    const s = snapshot(opts);
    const L = [];

    L.push("You are my strength and hypertrophy coach. Below is a complete export of my training project.");
    L.push("");
    L.push("How to read it:");
    L.push("- Each day is either a workout day or a rest day. The plan is user-defined; there is no fixed split.");
    L.push("- 'Target' is what I planned. 'Sets' are what I actually logged.");
    L.push("- Set columns are user-defined per exercise. Column names are given, so read values by their label.");
    L.push("- 'effective' is the standardised load in kg: the entry converted to kg, then divided by the pulley ratio (single 1, double 2, four 4). Compare lifts on this, not on the raw stack number.");
    L.push("- RIR is reps in reserve, recorded per set, and is reported separately from the set columns.");
    L.push("- 'total after balancing' is the timer total once the delay balance has been applied.");
    L.push("- An empty value means not recorded. Do not invent numbers and do not average over missing data.");
    L.push("");
    L.push("What I want back:");
    L.push("1. What improved and what stalled, citing the logged sets you based it on.");
    L.push("2. Per exercise: increase load, hold, or decrease next session - and why.");
    L.push("3. Whether planned volume per muscle group looks too low, about right, or too high.");
    L.push("4. Any program-design or recovery concerns, including exercise selection and day ordering.");
    L.push("5. Recovery & readiness evaluation: how recent sleep duration/quality and calorie burn should adjust volume or intensity.");
    L.push("6. Anything I should start recording that I currently am not.");
    L.push("");
    L.push(`Exported: ${s.exportedAt} (${s.timezone})`);
    L.push("");

    // ── Wearable health data (Amazfit / Zepp) ────────────────────────────────
    // If the user has imported or entered sleep/calorie data from their watch,
    // append the last 7 days so the coach can factor in recovery quality.
    if (window.WearableStore) {
      const recent = WearableStore.recentDays(7);
      if (recent.length) {
        L.push("=".repeat(64));
        L.push("WEARABLE HEALTH DATA — Smartwatch / Fitness Tracker (Sleep & Recovery)");
        L.push("=".repeat(64));
        L.push("Use sleep and calorie data to assess recovery and readiness.");
        L.push("'—' means not recorded for that day.");
        L.push("");
        recent.forEach(r => {
          const wlines = WearableStore.promptLines(r.date);
          wlines.forEach(l => L.push(l));
          if (wlines.length) L.push("");
        });
      }
    }

    s.projects.forEach(p => {
      L.push("=".repeat(64));
      L.push(`PROJECT: ${p.name}`);
      L.push("=".repeat(64));
      L.push(`Goal: ${dash(p.goal)}`);
      L.push(`Description: ${dash(p.description)}`);
      L.push(`Notes: ${dash(p.notes)}`);
      L.push(`Structure: ${p.structure.totalDays} days (${p.structure.workoutDays} workout, ${p.structure.restDays} rest), `
        + `${p.structure.totalExercises} exercises, ${p.structure.totalSetRows} set rows`);
      L.push(`Completion: ${p.completion.done}/${p.completion.total} exercises (${p.completion.pct}%)`);
      L.push("");

      p.days.forEach(d => {
        L.push("-".repeat(64));
        L.push(`DAY ${d.order}: ${d.name} [${d.type.toUpperCase()}] - ${dash(d.title)}`);
        if (d.type === "rest") {
          L.push(`  Rest notes: ${dash(d.restNotes)}`);
          L.push("");
          return;
        }
        if (d.subtitle) L.push(`  Subtitle: ${d.subtitle}`);
        if (d.focus) L.push(`  Focus: ${d.focus}`);
        if (d.muscles) L.push(`  Muscles: ${d.muscles}`);
        L.push(`  Day completion: ${d.completion.done}/${d.completion.total} (${d.completion.pct}%)`);
        L.push(`  Day intensity: ${d.intensity}`);
        if (d.cardio.length) {
          L.push(`  Cardio entries: ${d.cardio.length}`);
          d.cardio.forEach((c, ci) => {
            L.push(`    Cardio ${ci + 1}: type=${c.type} | duration=${c.duration} | calories=${c.calories} | incline=${c.incline} | speed=${c.speed} | gear=${c.gear} | notes=${c.notes}`
              + `${c.loggedAt ? ` (${new Date(c.loggedAt).toLocaleString()})` : ""}`);
          });
        } else {
          L.push("  Cardio: not counted");
        }
        L.push("");

        // DTS score section
        if (d.dts) {
          L.push("  Daily Training Score (DTS):");
          if (d.dts.isFirstWeek) {
            L.push("    DTS History: not counted (first week of training)");
            L.push("    Previous DTS scores: not counted");
            if (d.dts.currentScore && d.dts.currentScore.dts > 0) {
              L.push(`    Current Day DTS: ${d.dts.currentScore.dts}/100 (${d.dts.currentScore.band}) [Strength: ${d.dts.currentScore.strengthComponent} + Cardio: ${d.dts.currentScore.cardioContribution}]`);
            } else {
              L.push("    Current Day DTS: not counted");
            }
            L.push("    DTS scoring details: Calibration baseline accumulating (first week)");
          } else {
            if (d.dts.currentScore) {
              L.push(`    Current Day DTS: ${d.dts.currentScore.dts}/100 (${d.dts.currentScore.band})`);
              L.push(`      - Strength Component: ${d.dts.currentScore.strengthComponent}/80 (Workload: ${Math.round(d.dts.currentScore.strengthWorkload).toLocaleString()} kg, ${d.dts.currentScore.strengthNormalized}x reference)`);
              L.push(`      - Cardio Contribution: +${d.dts.currentScore.cardioContribution}/25 (Workload: ${Math.round(d.dts.currentScore.cardioWorkload)} units, ${d.dts.currentScore.cardioNormalized}x reference)`);
            } else {
              L.push("    Current Day DTS: not counted");
            }
            if (d.dts.last3Scores && d.dts.last3Scores.length) {
              L.push("    Last 3 DTS Scores:");
              d.dts.last3Scores.forEach((s, sIdx) => {
                L.push(`      ${sIdx + 1}. Date ${s.date}: DTS ${s.dts}/100 (${s.band}) [Strength: ${s.strengthComponent}, Cardio: +${s.cardioContribution}]`);
              });
            } else {
              L.push("    Last 3 DTS Scores: none available yet");
            }
            L.push("    DTS Scoring Engine Details:");
            L.push(`      - Version: v${d.dts.scoringDetails.version} (Calibration Ref v${d.dts.scoringDetails.referenceVersion})`);
            L.push(`      - Active Strength Reference: ${d.dts.scoringDetails.strengthReference.toLocaleString()} kg weighted volume (4 exercises × 3 sets × 10 reps @ moderate load)`);
            L.push(`      - Active Cardio Reference: ${d.dts.scoringDetails.cardioReference} workload units (25 min @ 5 km/h on 2% incline)`);
            L.push(`      - Transfer Formula: ${d.dts.scoringDetails.formula}`);
            L.push(`      - Weights & Contribution: ${d.dts.scoringDetails.weights}`);
            L.push(`      - Baseline Calibration: ${d.dts.scoringDetails.ewmaInfo}`);
          }
          L.push("");
        }

        d.exercises.forEach(ex => {
          const phaseTag = ex.phase === "pre" ? " [PRE-WORKOUT]" : ex.phase === "post" ? " [POST-WORKOUT]" : "";
          L.push(`  ${ex.order}. ${ex.name}${phaseTag}${ex.completed ? "  [COMPLETED]" : ""}`);
          L.push(`     Exercise intensity: ${ex.intensity}`);
          L.push(`     Target: weight=${dash(ex.target.weight)} ${dash(ex.target.weightUnit)} | pulley=${dash(ex.target.pulleySystem)} (ratio ${ex.target.pulleyRatio}:1) | effective=${dash(ex.target.effectiveWeightKg)} kg | reps=${dash(ex.target.reps)} | sets=${ex.target.sets}`);
          L.push(`     Rest: planned=${secondsText(ex.rest.plannedSec)} | extra=${secondsText(ex.rest.extraSec)} | balance=${secondsText(ex.rest.balanceSec)} | default=${secondsText(ex.rest.defaultDelaySec)} | total after balancing=${secondsText(ex.rest.totalSec)}`);
          L.push(`     Target RIR=${dash(ex.details.targetRIR)} | rest=${dash(ex.details.rest)} | tempo=${dash(ex.details.tempo)} | equipment=${dash(ex.details.equipment)}`);
          if (ex.details.notes) L.push(`     Notes: ${ex.details.notes}`);
          if (ex.details.cues.length) L.push(`     Cues: ${ex.details.cues.join(" | ")}`);
          L.push(`     Set columns: ${ex.setColumns.map(c => c.label).join(" | ")}`);

          // Previous week performance
          if (!ex.previousWeekPerformance || ex.previousWeekPerformance === "not counted") {
            L.push("     Previous week performance: not counted");
          } else {
            L.push(`     Previous week performance (Session: ${ex.previousWeekPerformance.date}, ${ex.previousWeekPerformance.setsCompleted}/${ex.previousWeekPerformance.totalSets} completed):`);
            ex.previousWeekPerformance.sets.forEach(sRow => {
              L.push(`       ${sRow}`);
            });
          }

          L.push(`     Logged sets (${ex.setsCompleted}/${ex.target.sets || ex.sets.length} marked done):`);
          ex.sets.forEach(row => {
            const vals = Object.entries(row.values)
              .map(([label, v]) => `${label}=${String(v).trim() || "—"}`).join(", ");
            const wt = row.workoutStart !== "not counted"
              ? ` workout_time=${row.workoutStart}${row.workoutEnd !== "not counted" ? `-${row.workoutEnd}` : ""}`
              : "";
            L.push(`       Set ${row.set}: ${vals}, RIR=${row.rir}, effective=${row.effectiveWeightKg} kg`
              + `${row.completed ? " [done]" : ""}`
              + `${row.loggedAt ? ` (${new Date(row.loggedAt).toLocaleString()})` : ""}`
              + wt
              + `${row.note ? ` note: ${row.note}` : ""}`);
          });
          L.push("");
        });
      });
    });

    L.push("=".repeat(64));
    L.push("BODY MEASUREMENTS");
    L.push("=".repeat(64));
    const b = s.body;
    if (!b.current?.weight && !b.history?.length) {
      L.push("not counted");
    } else {
      L.push(`Latest: weight=${dash(b.current.weight)} kg | waist=${dash(b.current.waist)} cm | chest=${dash(b.current.chest)} cm | arm=${dash(b.current.arm)} cm`
        + `${b.current.date ? ` (${new Date(b.current.date).toLocaleDateString()})` : ""}`);
      if (b.history.length > 1) {
        L.push("History (newest first):");
        b.history.slice(0, 16).forEach(h => {
          L.push(`  ${h.date ? new Date(h.date).toLocaleDateString() : "?"}: `
            + `weight=${dash(h.weight)} waist=${dash(h.waist)} chest=${dash(h.chest)} arm=${dash(h.arm)}`);
        });
      }
    }
    L.push("");
    L.push("Each logged set includes the actual clock time the workout session started/ended (workout_time). Use this, alongside intensity and completion, to look for patterns in peak performance by time of day.");
    L.push("End your reply with a short, concrete plan for my next session of each workout day.");
    return L.join("\n");
  }

  // ------------------------------------------------------------ markdown

  function buildMarkdown(opts = {}) {
    const s = snapshot(opts);
    const M = [`# GymCoach export`, "", `Exported: ${s.exportedAt}`, ""];

    s.projects.forEach(p => {
      M.push(`## ${p.name}`, "");
      M.push(`- **Goal:** ${dash(p.goal)}`);
      M.push(`- **Description:** ${dash(p.description)}`);
      M.push(`- **Notes:** ${dash(p.notes)}`);
      M.push(`- **Structure:** ${p.structure.totalDays} days · ${p.structure.workoutDays} workout · ${p.structure.restDays} rest · ${p.structure.totalExercises} exercises`);
      M.push(`- **Completion:** ${p.completion.done}/${p.completion.total} (${p.completion.pct}%)`);
      M.push(`- **Project intensity:** ${p.intensity}`, "");

      p.days.forEach(d => {
        M.push(`### Day ${d.order} — ${d.name} (${d.type})`, "");
        if (d.type === "rest") { M.push(`_${dash(d.restNotes)}_`, ""); return; }
        M.push(`**${dash(d.title)}** — ${dash(d.focus)} · ${dash(d.muscles)} · ${d.completion.pct}% complete · intensity ${d.intensity}`, "");
        if (d.cardio.length) {
          M.push(`**Cardio**`);
          M.push(`| Type | Duration | Calories | Incline | Speed | Gear | Notes |`);
          M.push(`|---|---|---|---|---|---|---|`);
          d.cardio.forEach(c => M.push(`| ${dash(c.type)} | ${dash(c.duration)} | ${dash(c.calories)} | ${dash(c.incline)} | ${dash(c.speed)} | ${dash(c.gear)} | ${dash(c.notes)} |`));
          M.push("");
        } else {
          M.push(`**Cardio:** not counted`, "");
        }

        // DTS score in markdown
        if (d.dts) {
          M.push(`**Daily Training Score (DTS)**`, "");
          if (d.dts.isFirstWeek) {
            M.push(`- **DTS History:** not counted (first week of training)`);
            M.push(`- **Previous DTS scores:** not counted`);
            if (d.dts.currentScore && d.dts.currentScore.dts > 0) {
              M.push(`- **Current Day DTS:** ${d.dts.currentScore.dts}/100 (${d.dts.currentScore.band}) [Strength: ${d.dts.currentScore.strengthComponent} + Cardio: ${d.dts.currentScore.cardioContribution}]`);
            } else {
              M.push(`- **Current Day DTS:** not counted`);
            }
            M.push(`- **DTS Scoring details:** Baseline accumulating (first week)`);
          } else {
            if (d.dts.currentScore) {
              M.push(`- **Current Day DTS:** **${d.dts.currentScore.dts}/100** (${d.dts.currentScore.band}) · Strength: ${d.dts.currentScore.strengthComponent}/80 · Cardio: +${d.dts.currentScore.cardioContribution}/25`);
            } else {
              M.push(`- **Current Day DTS:** not counted`);
            }
            if (d.dts.last3Scores && d.dts.last3Scores.length) {
              M.push(`- **Last 3 DTS Scores:**`);
              d.dts.last3Scores.forEach(s => {
                M.push(`  - **${s.date}:** DTS ${s.dts}/100 (${s.band}) [Strength: ${s.strengthComponent}, Cardio: +${s.cardioContribution}]`);
              });
            }
            M.push(`- **DTS Scoring Engine Details:**`);
            M.push(`  - Version: v${d.dts.scoringDetails.version} (Calibration Ref v${d.dts.scoringDetails.referenceVersion})`);
            M.push(`  - Active References: Strength ${d.dts.scoringDetails.strengthReference.toLocaleString()} kg · Cardio ${d.dts.scoringDetails.cardioReference} units`);
            M.push(`  - Formula: ${d.dts.scoringDetails.formula}`);
            M.push(`  - Weights: ${d.dts.scoringDetails.weights}`);
          }
          M.push("");
        }

        d.exercises.forEach(ex => {
          const phaseTag = ex.phase === "pre" ? " 🔥 [PRE-WORKOUT]" : ex.phase === "post" ? " 🧊 [POST-WORKOUT]" : "";
          M.push(`#### ${ex.order}. ${ex.name}${phaseTag}${ex.completed ? " ✅" : ""}`, "");
          M.push(`Intensity: **${ex.intensity}** · Target: **${dash(ex.target.weight)}** × **${dash(ex.target.reps)}** × **${ex.target.sets} sets** · `
            + `RIR ${dash(ex.details.targetRIR)} · rest ${dash(ex.details.rest)} · tempo ${dash(ex.details.tempo)} · ${dash(ex.details.equipment)}`, "");
          if (ex.details.notes) M.push(`> ${ex.details.notes}`, "");
          if (ex.details.cues.length) M.push(`Cues: ${ex.details.cues.map(c => `\`${c}\``).join(" · ")}`, "");

          if (!ex.previousWeekPerformance || ex.previousWeekPerformance === "not counted") {
            M.push(`- **Previous week performance:** not counted`, "");
          } else {
            M.push(`- **Previous week performance (${ex.previousWeekPerformance.date} · ${ex.previousWeekPerformance.setsCompleted}/${ex.previousWeekPerformance.totalSets} completed):**`);
            ex.previousWeekPerformance.sets.forEach(sRow => {
              M.push(`  - ${sRow}`);
            });
            M.push("");
          }

          const labels = ex.setColumns.map(c => c.label);
          M.push(`| Set | ${labels.join(" | ")} | Note | Done | Workout time |`);
          M.push(`|---|${labels.map(() => "---").join("|")}|---|---|---|`);
          ex.sets.forEach(r => {
            const wtCell = r.workoutStart !== "not counted"
              ? `${r.workoutStart}${r.workoutEnd !== "not counted" ? `–${r.workoutEnd}` : ""}`
              : "not counted";
            M.push(`| ${r.set} | ${labels.map(l => dash(r.values[l])).join(" | ")} | ${dash(r.note)} | ${r.completed ? "✓" : "not counted"} | ${wtCell} |`);
          });
          M.push("");
        });
      });
    });

    const b = s.body;
    M.push(`## Body measurements`, "");
    if (b.history?.length) {
      M.push("| Date | Weight | Waist | Chest | Arm |", "|---|---|---|---|---|");
      b.history.slice(0, 20).forEach(h => M.push(`| ${h.date ? new Date(h.date).toLocaleDateString() : "—"} | ${dash(h.weight)} | ${dash(h.waist)} | ${dash(h.chest)} | ${dash(h.arm)} |`));
    } else {
      M.push("_not counted_");
    }
    return M.join("\n");
  }

  // ---------------------------------------------------------- pdf / word

  function buildPlainText(opts) { return buildPrompt(opts); }

  function exportPDF(opts = {}) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) { UI.toast("PDF library didn't load — use Markdown or JSON.", "error"); return; }
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40, width = 515, lineHeight = 12;
    let y = margin;
    doc.setFont("courier", "normal");
    doc.setFontSize(8);

    buildPlainText(opts).split("\n").forEach(raw => {
      doc.splitTextToSize(raw || " ", width).forEach(line => {
        if (y > 790) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += lineHeight;
      });
    });

    doc.save(fileName("pdf"));
    UI.toast("PDF downloaded");
  }

  function exportWord(opts = {}) {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>GymCoach export</title>
      <style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}
      table{border-collapse:collapse;width:100%;margin:6pt 0}
      th,td{border:1px solid #999;padding:4pt;font-size:9pt;text-align:left}
      th{background:#eee}h1{font-size:18pt}h2{font-size:15pt}h3{font-size:12pt}h4{font-size:11pt}
      pre{font-family:Consolas,monospace;font-size:8.5pt;white-space:pre-wrap}</style></head>
      <body>${markdownToHTML(buildMarkdown(opts))}</body></html>`;
    UI.download(fileName("doc"), new Blob(["﻿", html], { type: "application/msword" }));
    UI.toast("Word document downloaded");
  }

  // Enough Markdown to make the .doc readable: headings, tables, bold, quotes.
  function markdownToHTML(md) {
    const out = [];
    let inTable = false;
    md.split("\n").forEach(line => {
      const cells = line.trim().startsWith("|") && line.trim().endsWith("|");
      if (cells && /^\|[\s\-|]+\|$/.test(line.trim())) return;   // separator row
      if (cells) {
        const tds = line.trim().slice(1, -1).split("|").map(c => c.trim());
        if (!inTable) { out.push("<table>"); inTable = true; out.push(`<tr>${tds.map(c => `<th>${inline(c)}</th>`).join("")}</tr>`); return; }
        out.push(`<tr>${tds.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`);
        return;
      }
      if (inTable) { out.push("</table>"); inTable = false; }

      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); return; }
      if (line.startsWith("> ")) { out.push(`<p style="margin-left:18pt;color:#444">${inline(line.slice(2))}</p>`); return; }
      if (line.startsWith("- ")) { out.push(`<p style="margin:2pt 0 2pt 14pt">• ${inline(line.slice(2))}</p>`); return; }
      out.push(line.trim() ? `<p>${inline(line)}</p>` : "<p>&nbsp;</p>");
    });
    if (inTable) out.push("</table>");
    return out.join("\n");

    function inline(t) {
      return esc(t)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/_(.+?)_/g, "<i>$1</i>");
    }
  }

  const fileName = ext => {
    const slug = Store.active().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    return `gymcoach-${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  };


  // CSV is delegated to js/pipeline.js. This file used to carry its own writer that
  // emitted a 19-column long-format table built from the snapshot - which meant it
  // could only ever see what the snapshot happened to include, and silently dropped
  // RIR, effective load, rest totals and body measurements. The pipeline reads the
  // store directly and covers all of them, so there is one CSV schema, not two.
  function buildCSV(opts = {}) {
    return DataPipeline.toCSV(DataPipeline.setsTable(opts));
  }

  function downloadCSV(opts = {}) {
    return DataPipeline.downloadMaster(opts);
  }

  // ------------------------------------------------------------- live AI

  async function sendToAI() {
    const s = window.Settings?.get() || {};
    if (!s.provider || (s.provider !== "custom" && !s.apiKey)) {
      UI.toast("Add your API key in Settings first.", "error");
      window.Settings?.open();
      return;
    }
    const box = $("aiResult"), body = $("aiResultBody");
    box.hidden = false;
    body.textContent = "Sending your full project to the coach…";
    $("sendAiButton").disabled = true;

    try {
      body.textContent = await window.Settings.callModel(currentPrompt());
    } catch (err) {
      body.innerHTML = `<span class="ai-error">Request failed: ${esc(err.message)}<br><br>
        Browsers often block direct API calls (CORS). Use <b>Copy Prompt</b> and paste it into your
        AI chat, or point Settings at your own proxy endpoint.</span>`;
    } finally {
      $("sendAiButton").disabled = false;
    }
  }

  // --------------------------------------------------------------- render

  const opts = () => ({ allProjects: $("aiAllProjects")?.checked });
  const currentPrompt = () => buildPrompt(opts());

  function render() {
    const box = $("aiPrompt");
    if (!box) return;
    const text = currentPrompt();
    box.value = text;
    const s = snapshot(opts());
    const totals = s.projects.reduce((a, p) => ({
      days: a.days + p.structure.totalDays,
      ex: a.ex + p.structure.totalExercises,
      sets: a.sets + p.structure.totalSetRows
    }), { days: 0, ex: 0, sets: 0 });
    $("aiStats").textContent =
      `${s.projects.length} project${s.projects.length === 1 ? "" : "s"} · ${totals.days} days · `
      + `${totals.ex} exercises · ${totals.sets} set rows · ${text.length.toLocaleString()} characters`;
  }

  function init() {
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-action]");
      if (!a) return;
      switch (a.dataset.action) {
        case "copy-ai-prompt":
          UI.copy(currentPrompt()).then(ok =>
            UI.toast(ok ? "Prompt copied — paste it into your AI chat" : "Copy failed; select the text manually", ok ? "ok" : "error"));
          break;
        case "download-ai-json": UI.download(fileName("json"), JSON.stringify(snapshot(opts()), null, 2), "application/json"); UI.toast("JSON downloaded"); break;
        case "download-ai-md":   UI.download(fileName("md"), buildMarkdown(opts()), "text/markdown;charset=utf-8"); UI.toast("Markdown downloaded"); break;
        case "download-ai-txt":  UI.download(fileName("txt"), currentPrompt(), "text/plain;charset=utf-8"); UI.toast("Text downloaded"); break;
        case "download-ai-pdf":  exportPDF(opts()); break;
        case "download-ai-doc":  exportWord(opts()); break;
        // Handled here rather than in app.js's ACTIONS map so that it picks up the
        // All-projects checkbox like every other export on this view does.
        case "download-ai-csv":  downloadCSV(opts()); break;
        case "send-ai":          sendToAI(); break;
      }
    });
    $("aiAllProjects")?.addEventListener("change", render);
    Store.onChange(() => { if (!$("aiView")?.hidden) render(); });
    // A throw here used to take the whole module's first paint with it, leaving the
    // prompt box blank with nothing in the console pointing at the cause.
    try { render(); } catch (err) { console.error("ReportCoach: first render failed", err); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { snapshot, buildPrompt, buildMarkdown, buildCSV, downloadCSV, exportPDF, exportWord, render };
})();
