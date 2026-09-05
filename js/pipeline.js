// pipeline.js - the export pipeline: every recorded value in the app, flattened
// into CSV tables.
//
// WHAT "EVERY RECORDED VALUE" MEANS HERE
// ---------------------------------------------------------------------------
// The per-exercise data hierarchy this pipeline is built to capture:
//
//   Exercise
//   |- Weight (plates / stacks)      ex.weight              -> weight_target
//   |- Weight unit                   ex.weightUnit          -> weight_unit
//   |- Pulley system                 ex.pulleySystem        -> pulley_system + pulley_ratio
//   |- Effective weight (kg)         derived                -> *_effective_weight_kg
//   |- Sets                          ex.sets / ex.logs      -> target_sets, logged_sets, set_number
//   |- Reps                          ex.reps + per-set      -> target_reps*, set_reps
//   |- RIR                           log.rir                -> rir  (never a set column - see store.js)
//   |- Set completion                log.completed + date   -> set_completed, set_date
//   |- Total rest after balancing    ex.restStats           -> rest_total_after_balancing_sec
//   |- Workout time                  day.workTimes[date]    -> workout_start/end/duration_min
//   |- Body weight                   profile history        -> body_* (nearest check on or before the set)
//   \- Notes                         4 separate note fields -> project/day/exercise/set notes
//
// THREE OUTPUT SHAPES, ONE SOURCE OF TRUTH
// ---------------------------------------------------------------------------
//   1. sets.csv  - wide. One row per logged set, the hierarchy above as columns.
//                  This is the file to open in Excel or load with pandas.
//   2. all.csv   - long / tidy. One row per (table, record, field, value). Every
//                  table below melted into a single file, so nothing is lost even
//                  for user-defined set columns that no fixed schema can predict.
//   3. .zip      - every table as its own CSV plus a README. Written by the
//                  store-only ZIP writer at the bottom of this file, because the
//                  app has no dependencies and must work offline.
//
// MISSING VALUES ARE EMPTY, NOT "not counted". The older AI-Coach export writes
// the literal string "not counted", which is readable but turns a numeric column
// into text the moment one cell is blank. A pipeline feeding pandas and the models
// in js/ml.js needs real NaNs, so these files leave gaps empty and say so in the
// bundled README.

window.DataPipeline = (() => {

  const KG_DP = 1000;
  const round = (v, f = 100) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)))
    ? "" : Math.round(Number(v) * f) / f;

  // =====================================================================
  // CSV primitives
  // =====================================================================

  // Every cell is quoted. Excel and pandas both accept it, and it removes any
  // need to reason about which values happen to contain a comma or a newline.
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  function toCSV(table) {
    return [table.header, ...table.rows]
      .map(row => row.map(cell).join(","))
      .join("\r\n");
  }

  // =====================================================================
  // value parsing
  // =====================================================================

  const findCol = (ex, key, pattern) =>
    (ex.setColumns || []).find(c => c.key === key) ||
    (ex.setColumns || []).find(c => pattern.test(String(c.label || "")));

  const weightCol = ex => findCol(ex, "weight", /weight|load/i);
  const repsCol = ex => findCol(ex, "reps", /rep/i);
  const timeCol = ex => findCol(ex, "time", /time|dur|sec/i);

  const numberIn = text => {
    const m = String(text ?? "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };

  // "1:30" -> 90, "1:02:03" -> 3723, "45" -> 45.
  function clockSeconds(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return null;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(raw)) {
      const p = raw.split(":").map(Number);
      return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
    }
    return numberIn(raw);
  }

  const clockText = sec => {
    if (!Number.isFinite(Number(sec))) return "";
    const s = Math.max(0, Math.round(Number(sec)));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // "6:30" + "PM" -> minutes since midnight. 12 AM is 0, 12 PM is 720.
  function ampmMinutes(time, ampm) {
    const m = String(time ?? "").trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = String(ampm || "").toUpperCase() === "PM";
    if (h === 12) h = 0;
    return (h + (pm ? 12 : 0)) * 60 + min;
  }

  function workoutTime(day, key) {
    const wt = Store.getWorkTime(day, key || Store.todayKey());
    const start = wt.startTime ? `${wt.startTime} ${wt.startAmPm || ""}`.trim() : "";
    const end = wt.endTime ? `${wt.endTime} ${wt.endAmPm || ""}`.trim() : "";
    const a = ampmMinutes(wt.startTime, wt.startAmPm);
    const b = ampmMinutes(wt.endTime, wt.endAmPm);
    let duration = "";
    if (a !== null && b !== null) duration = b >= a ? b - a : b + 1440 - a;  // session past midnight
    return { start, end, duration, startMinutes: a, endMinutes: b };
  }

  // =====================================================================
  // body measurements, aligned to the date of the set
  // =====================================================================

  // The measurement in force when a set was logged is the most recent check on or
  // before that date - not today's, which would back-date a body weight the user
  // did not have yet.
  function bodyIndex() {
    const prof = Store.profile();
    const entries = (prof.history || [])
      .map(h => ({ ...h, key: Store.dateKey(h.date) }))
      .filter(h => h.key)
      .sort((a, b) => b.key.localeCompare(a.key));
    const current = prof.current || {};
    return {
      entries,
      current,
      at(dateKey) {
        if (!dateKey) return entries[0] || current;
        return entries.find(h => h.key <= dateKey) || entries[entries.length - 1] || current;
      }
    };
  }

  // =====================================================================
  // scope
  // =====================================================================

  function scopeProjects(opts = {}) {
    if (opts.projects) return opts.projects;
    return opts.allProjects ? Store.all() : [Store.active()];
  }

  const stamp = () => new Date().toISOString();
  const slug = s => String(s || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

  // =====================================================================
  // table 1 - sets (wide). The master table.
  // =====================================================================

  const SETS_HEADER = [
    "project_id", "project_name", "project_goal", "project_intensity_band",
    "day_number", "day_id", "day_name", "day_type", "day_title", "day_subtitle",
    "day_focus", "day_muscles", "day_completion_pct", "day_intensity_band",
    "exercise_number", "exercise_id", "exercise_name", "exercise_intensity_band",
    "weight_target", "weight_unit", "pulley_system", "pulley_ratio",
    "target_weight_kg", "target_effective_weight_kg",
    "target_reps", "target_reps_min", "target_reps_max", "target_rir",
    "target_sets", "logged_sets",
    "set_number", "set_id", "set_date",
    "set_weight_raw", "set_weight_kg", "set_effective_weight_kg",
    "set_reps", "set_volume_kg",
    "rir", "set_completed",
    "set_recorded_time", "set_recorded_seconds", "set_time_recorded_at",
    "custom_fields",
    "rest_planned_sec", "rest_extra_sec", "rest_balance_sec", "rest_default_delay_sec",
    "rest_total_after_balancing_sec", "exercise_recorded_total_sec",
    "workout_start", "workout_end", "workout_duration_min",
    "body_weight", "body_waist", "body_chest", "body_arm", "body_measured_on",
    "equipment", "tempo", "planned_rest",
    "exercise_notes", "exercise_cues", "set_note", "day_rest_notes", "project_notes"
  ];

  function setsTable(opts = {}) {
    const body = bodyIndex();
    const rows = [];

    scopeProjects(opts).forEach(p => {
      const pBand = Store.intensityBand(Store.projectIntensity(p));

      (p.days || []).forEach((d, di) => {
        const dayBand = d.type === "workout" ? Store.intensityBand(Store.dayIntensity(d)) : "";
        const dayPct = d.type === "workout" ? Store.dayProgress(d).pct : "";

        // A rest day, or a workout day with nothing in it, still carries recorded
        // data (its notes, its clock). Emit a row so the master file is complete.
        if (d.type !== "workout" || !(d.exercises || []).length) {
          const wt = workoutTime(d, "");
          const b = body.at("");
          const row = new Array(SETS_HEADER.length).fill("");
          const set = (k, v) => { row[SETS_HEADER.indexOf(k)] = v ?? ""; };
          set("project_id", p.id); set("project_name", p.name); set("project_goal", p.goal);
          set("project_intensity_band", pBand);
          set("day_number", di + 1); set("day_id", d.id); set("day_name", d.name);
          set("day_type", d.type); set("day_title", d.title); set("day_subtitle", d.subtitle);
          set("day_focus", d.focus); set("day_muscles", d.muscles);
          set("day_completion_pct", dayPct); set("day_intensity_band", dayBand);
          set("logged_sets", 0);
          set("workout_start", wt.start); set("workout_end", wt.end);
          set("workout_duration_min", wt.duration);
          set("body_weight", b.weight); set("body_waist", b.waist);
          set("body_chest", b.chest); set("body_arm", b.arm);
          set("body_measured_on", b.key || Store.dateKey(b.date));
          set("day_rest_notes", d.restNotes); set("project_notes", p.notes);
          rows.push(row);
          return;
        }

        (d.exercises || []).forEach((ex, ei) => {
          const unit = Store.normalizeWeightUnit(ex.weightUnit);
          const pulley = Store.pulleyKey(ex.pulleySystem);
          const ratio = Store.pulleyRatio(pulley);
          const exBand = Store.intensityBand(Store.exerciseIntensity(ex));

          const wCol = weightCol(ex), rCol = repsCol(ex), tCol = timeCol(ex);
          const repRange = String(ex.reps || "").match(/(\d+(?:\.\d+)?)(?:\s*[-–to]+\s*(\d+(?:\.\d+)?))?/i);

          const rest = ex.restStats || {};
          // Total rest after balancing: the timer writes each stopped set as
          // gross elapsed + delay balance, so summing the recorded set times is
          // the same quantity from the other direction. Prefer the tracked total
          // and fall back to the sum for logs recorded before that was stored.
          const recordedTotal = (ex.logs || [])
            .reduce((s, l) => s + (clockSeconds(tCol ? l.values?.[tCol.key] : "") || 0), 0);
          const restTotal = Number(rest.totalSec) || recordedTotal || "";

          const known = new Set([wCol?.key, rCol?.key, tCol?.key].filter(Boolean));

          (ex.logs || []).forEach((log, li) => {
            const dk = Store.dateKey(log.date);
            const wt = workoutTime(d, dk || Store.todayKey());
            const b = body.at(dk);

            const rawW = wCol ? String(log.values?.[wCol.key] ?? "").trim() : "";
            const setKg = Store.weightToKg(rawW, unit);
            const setEff = Store.effectiveKg(rawW, unit, pulley);
            const setReps = rCol ? numberIn(log.values?.[rCol.key]) : null;
            const secs = tCol ? clockSeconds(log.values?.[tCol.key]) : null;

            // Any set column the user added themselves. Keeps the wide file
            // lossless without letting the schema depend on user input.
            const custom = Object.entries(log.values || {})
              .filter(([k, v]) => !known.has(k) && String(v ?? "").trim())
              .map(([k, v]) => {
                const label = (ex.setColumns || []).find(c => c.key === k)?.label || k;
                return `${label}=${String(v).trim()}`;
              }).join("; ");

            const row = new Array(SETS_HEADER.length).fill("");
            const set = (k, v) => { row[SETS_HEADER.indexOf(k)] = v ?? ""; };

            set("project_id", p.id); set("project_name", p.name); set("project_goal", p.goal);
            set("project_intensity_band", pBand);

            set("day_number", di + 1); set("day_id", d.id); set("day_name", d.name);
            set("day_type", d.type); set("day_title", d.title); set("day_subtitle", d.subtitle);
            set("day_focus", d.focus); set("day_muscles", d.muscles);
            set("day_completion_pct", dayPct); set("day_intensity_band", dayBand);

            set("exercise_number", ei + 1); set("exercise_id", ex.id);
            set("exercise_name", ex.name); set("exercise_intensity_band", exBand);

            set("weight_target", ex.weight); set("weight_unit", unit);
            set("pulley_system", pulley); set("pulley_ratio", ratio);
            set("target_weight_kg", round(Store.weightToKg(ex.weight, unit), KG_DP));
            set("target_effective_weight_kg", round(Store.effectiveKg(ex.weight, unit, pulley), KG_DP));

            set("target_reps", ex.reps);
            set("target_reps_min", repRange?.[1] ?? "");
            set("target_reps_max", repRange?.[2] ?? repRange?.[1] ?? "");
            set("target_rir", ex.details?.targetRIR);
            set("target_sets", ex.sets); set("logged_sets", (ex.logs || []).length);

            set("set_number", li + 1); set("set_id", log.id); set("set_date", dk);
            set("set_weight_raw", rawW);
            set("set_weight_kg", round(setKg, KG_DP));
            set("set_effective_weight_kg", round(setEff, KG_DP));
            set("set_reps", setReps === null ? "" : setReps);
            set("set_volume_kg", setEff !== null && setReps !== null ? round(setEff * setReps, KG_DP) : "");

            set("rir", log.rir);
            set("set_completed", log.completed ? "1" : "0");
            set("set_recorded_time", tCol ? String(log.values?.[tCol.key] ?? "").trim() : "");
            set("set_recorded_seconds", secs === null ? "" : secs);
            set("set_time_recorded_at", log.timeRecordedAt || "");
            set("custom_fields", custom);

            set("rest_planned_sec", rest.plannedSec || "");
            set("rest_extra_sec", rest.extraSec || "");
            set("rest_balance_sec", rest.balanceSec || "");
            set("rest_default_delay_sec", rest.defaultDelaySec || "");
            set("rest_total_after_balancing_sec", restTotal);
            set("exercise_recorded_total_sec", recordedTotal || "");

            set("workout_start", wt.start); set("workout_end", wt.end);
            set("workout_duration_min", wt.duration);

            set("body_weight", b.weight); set("body_waist", b.waist);
            set("body_chest", b.chest); set("body_arm", b.arm);
            set("body_measured_on", b.key || Store.dateKey(b.date));

            set("equipment", ex.details?.equipment); set("tempo", ex.details?.tempo);
            set("planned_rest", ex.details?.rest);
            set("exercise_notes", ex.details?.notes);
            set("exercise_cues", (ex.details?.cues || []).join(" | "));
            set("set_note", log.notes);
            set("day_rest_notes", d.restNotes); set("project_notes", p.notes);

            rows.push(row);
          });
        });
      });
    });

    return { name: "sets", header: SETS_HEADER, rows, idCols: ["project_name", "day_name", "exercise_name", "set_number"] };
  }

  // =====================================================================
  // table 2 - exercises (one row per exercise, targets and totals)
  // =====================================================================

  function exercisesTable(opts = {}) {
    const header = [
      "project_name", "day_number", "day_name", "exercise_number", "exercise_id", "exercise_name",
      "weight_target", "weight_unit", "pulley_system", "pulley_ratio",
      "target_weight_kg", "target_effective_weight_kg",
      "target_reps", "target_sets", "target_rir", "logged_sets", "completed_sets",
      "mean_rir", "total_volume_kg", "top_effective_kg", "recorded_total_sec",
      "rest_total_after_balancing_sec", "rest_intervals_logged",
      "intensity_band", "set_columns", "equipment", "tempo", "planned_rest", "notes", "cues",
      "first_logged", "last_logged", "has_image", "has_video"
    ];
    const rows = [];

    scopeProjects(opts).forEach(p => {
      (p.days || []).forEach((d, di) => {
        (d.exercises || []).forEach((ex, ei) => {
          const unit = Store.normalizeWeightUnit(ex.weightUnit);
          const pulley = Store.pulleyKey(ex.pulleySystem);
          const wCol = weightCol(ex), rCol = repsCol(ex), tCol = timeCol(ex);

          let volume = 0, top = 0, secs = 0, done = 0;
          const rirs = [];
          const dates = [];
          (ex.logs || []).forEach(log => {
            const eff = Store.effectiveKg(wCol ? log.values?.[wCol.key] : "", unit, pulley);
            const reps = rCol ? numberIn(log.values?.[rCol.key]) : null;
            if (eff !== null) top = Math.max(top, eff);
            if (eff !== null && reps !== null) volume += eff * reps;
            secs += clockSeconds(tCol ? log.values?.[tCol.key] : "") || 0;
            if (log.completed) done++;
            const r = Store.parseWeightNumber(log.rir);
            if (r !== null) rirs.push(r);
            const dk = Store.dateKey(log.date);
            if (dk) dates.push(dk);
          });
          dates.sort();

          rows.push([
            p.name, di + 1, d.name, ei + 1, ex.id, ex.name,
            ex.weight, unit, pulley, Store.pulleyRatio(pulley),
            round(Store.weightToKg(ex.weight, unit), KG_DP),
            round(Store.effectiveKg(ex.weight, unit, pulley), KG_DP),
            ex.reps, ex.sets, ex.details?.targetRIR, (ex.logs || []).length, done,
            rirs.length ? round(rirs.reduce((a, b) => a + b, 0) / rirs.length) : "",
            volume ? round(volume, KG_DP) : "", top ? round(top, KG_DP) : "", secs || "",
            Number(ex.restStats?.totalSec) || secs || "", (ex.restStats?.intervals || []).length,
            Store.intensityBand(Store.exerciseIntensity(ex)),
            (ex.setColumns || []).map(c => c.label).join(" | "),
            ex.details?.equipment, ex.details?.tempo, ex.details?.rest,
            ex.details?.notes, (ex.details?.cues || []).join(" | "),
            dates[0] || "", dates[dates.length - 1] || "",
            ex.image ? "1" : "0", ex.video ? "1" : "0"
          ]);
        });
      });
    });

    return { name: "exercises", header, rows, idCols: ["project_name", "day_name", "exercise_name"] };
  }

  // =====================================================================
  // table 3 - days, including rest days and every recorded clock entry
  // =====================================================================

  function daysTable(opts = {}) {
    const header = [
      "project_name", "day_number", "day_id", "day_name", "day_type", "day_title", "day_subtitle",
      "day_focus", "day_muscles", "weekday", "exercise_count", "completed_exercises",
      "completion_pct", "intensity_band", "cardio_entries",
      "clock_date", "workout_start", "workout_end", "workout_duration_min", "rest_notes"
    ];
    const rows = [];
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    scopeProjects(opts).forEach(p => {
      (p.days || []).forEach((d, di) => {
        const prog = Store.dayProgress(d);
        const base = [
          p.name, di + 1, d.id, d.name, d.type, d.title, d.subtitle,
          d.focus, d.muscles, Number.isInteger(d.weekday) ? WEEKDAYS[d.weekday] : "",
          (d.exercises || []).length, prog.done,
          d.type === "workout" ? prog.pct : "",
          d.type === "workout" ? Store.intensityBand(Store.dayIntensity(d)) : "",
          (d.cardio || []).length
        ];

        // workTimes is keyed by calendar date, so one day template can hold many
        // recorded clock entries. Emit every one of them.
        const clockKeys = Object.keys(d.workTimes || {}).sort();
        if (!clockKeys.length) {
          rows.push([...base, "", "", "", "", d.restNotes]);
          return;
        }
        clockKeys.forEach(k => {
          const wt = workoutTime(d, k);
          rows.push([...base, k, wt.start, wt.end, wt.duration, d.restNotes]);
        });
      });
    });

    return { name: "days", header, rows, idCols: ["project_name", "day_name", "clock_date"] };
  }

  // =====================================================================
  // table 4 - cardio
  // =====================================================================

  function cardioTable(opts = {}) {
    const header = ["project_name", "day_number", "day_name", "entry_id", "date",
      "type", "duration", "duration_min", "calories", "incline", "speed", "gear", "notes"];
    const rows = [];

    scopeProjects(opts).forEach(p => {
      (p.days || []).forEach((d, di) => {
        (d.cardio || []).forEach(c => rows.push([
          p.name, di + 1, d.name, c.id, Store.dateKey(c.date) || c.date || "",
          c.type, c.duration, numberIn(c.duration) ?? "", c.calories,
          c.incline, c.speed, c.gear, c.notes
        ]));
      });
    });

    return { name: "cardio", header, rows, idCols: ["project_name", "day_name", "entry_id"] };
  }

  // =====================================================================
  // table 5 - body measurements
  // =====================================================================

  function bodyTable() {
    const prof = Store.profile();
    const header = ["measured_on", "recorded_at", "is_current", "weight", "waist", "chest", "arm"];
    const rows = [];
    const currentDate = prof.current?.date || "";

    (prof.history || []).forEach(h => rows.push([
      Store.dateKey(h.date), h.date || "", h.date === currentDate ? "1" : "0",
      h.weight, h.waist, h.chest, h.arm
    ]));

    // A profile saved before history existed lives only in `current`.
    if (!rows.length && prof.current && Object.keys(prof.current).length) {
      const c = prof.current;
      rows.push([Store.dateKey(c.date), c.date || "", "1", c.weight, c.waist, c.chest, c.arm]);
    }

    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    return { name: "body_measurements", header, rows, idCols: ["measured_on"] };
  }

  // =====================================================================
  // table 6 - per-session rollup (the feature table the ML models train on)
  // =====================================================================

  function sessionsTable(opts = {}) {
    const header = ["project_name", "session_date", "days_trained", "sets", "completed_sets",
      "completion_rate", "reps", "volume_kg", "top_effective_kg", "recorded_seconds",
      "recorded_minutes", "mean_rir"];
    const rows = [];

    scopeProjects(opts).forEach(p => {
      (window.MLModels?.sessionSeries(p) || []).forEach(s => rows.push([
        p.name, s.date, s.label, s.sets, s.completedSets, round(s.completion, 1000),
        s.reps, s.volumeKg, s.topLoadKg, s.seconds, s.minutes, s.meanRir ?? ""
      ]));
    });

    return { name: "sessions", header, rows, idCols: ["project_name", "session_date"] };
  }

  // =====================================================================
  // table 7 - rest / timer intervals
  // =====================================================================

  function restIntervalsTable(opts = {}) {
    const header = ["project_name", "day_name", "exercise_name", "set_id", "recorded_at",
      "planned_sec", "gross_sec", "balance_sec", "recorded_sec", "recorded_text"];
    const rows = [];

    scopeProjects(opts).forEach(p => {
      (p.days || []).forEach(d => {
        (d.exercises || []).forEach(ex => {
          (ex.restStats?.intervals || []).forEach(iv => rows.push([
            p.name, d.name, ex.name, iv.setId || "", iv.at || "",
            iv.plannedSec ?? "", iv.grossSec ?? "", iv.balanceSec ?? "",
            iv.recordedSec ?? "", clockText(iv.recordedSec)
          ]));
        });
      });
    });

    return { name: "rest_intervals", header, rows, idCols: ["project_name", "exercise_name", "recorded_at"] };
  }

  // =====================================================================
  // table 8 - model output, so a forecast can be audited later
  // =====================================================================

  function modelTable(opts = {}) {
    const header = ["project_name", "metric", "model", "detail", "r2", "rmse",
      "trend_per_session", "point_type", "index", "session_date", "actual", "fitted", "band"];
    const rows = [];
    if (!window.MLModels) return { name: "model_forecast", header, rows, idCols: ["project_name", "metric", "index"] };

    scopeProjects(opts).forEach(p => {
      MLModels.METRICS.forEach(m => {
        const r = MLModels.performance(p, m.key);
        if (!r.series.length) return;
        r.series.forEach((s, i) => rows.push([
          p.name, m.key, r.model, r.modelDetail, r.r2 ?? "", r.rmse ?? "",
          r.trendPerSession, "actual", i, s.date, r.y[i], r.fitted[i] ?? "", r.band
        ]));
        r.forecast.forEach((v, h) => rows.push([
          p.name, m.key, r.model, r.modelDetail, r.r2 ?? "", r.rmse ?? "",
          r.trendPerSession, "forecast", r.series.length + h, "", "", v, r.band
        ]));
      });
    });

    return { name: "model_forecast", header, rows, idCols: ["project_name", "metric", "point_type", "index"] };
  }

  // =====================================================================
  // table 9 - the rolling weekly archives already in localStorage
  // =====================================================================

  function archivesTable() {
    const header = ["archive_key", "project_name", "day_name", "week_start", "updated_at", "csv_rows"];
    const rows = (Store.allArchivedCSVs() || [])
      .filter(a => a.csv)
      .map(a => [a.key, a.projectName, a.dayName, a.weekStart, a.updatedAt,
        String(a.csv).split(/\r?\n/).length - 1]);
    return { name: "weekly_archives", header, rows, idCols: ["archive_key"] };
  }

  // =====================================================================
  // long / tidy shape - every table melted into one file
  // =====================================================================

  function melt(tables) {
    const header = ["table", "record", "field", "value"];
    const rows = [];
    tables.forEach(t => {
      const idIdx = t.idCols.map(c => t.header.indexOf(c)).filter(i => i >= 0);
      t.rows.forEach(r => {
        const record = idIdx.map(i => r[i]).filter(v => String(v ?? "").trim()).join(" / ");
        t.header.forEach((h, i) => {
          const v = r[i];
          if (String(v ?? "").trim() === "") return;   // long form omits blanks by definition
          rows.push([t.name, record, h, v]);
        });
      });
    });
    return { name: "all_values", header, rows, idCols: ["table", "record"] };
  }

  // =====================================================================
  // assembling the full set of tables
  // =====================================================================

  function tables(opts = {}) {
    const t = [
      setsTable(opts),
      exercisesTable(opts),
      daysTable(opts),
      sessionsTable(opts),
      cardioTable(opts),
      restIntervalsTable(opts),
      bodyTable(),
      modelTable(opts),
      archivesTable()
    ];
    // Wearable health data from Amazfit / Zepp (if any has been imported or entered)
    if (window.WearableStore) {
      const wt = WearableStore.exportTable();
      if (wt.rows.length) t.push(wt);
    }
    return t;
  }

  function stats(opts = {}) {
    const t = tables(opts);
    const byName = Object.fromEntries(t.map(x => [x.name, x]));
    const fields = t.reduce((n, x) => n + x.rows.length * x.header.length, 0);
    return {
      projects: scopeProjects(opts).length,
      sets: byName.sets.rows.length,
      exercises: byName.exercises.rows.length,
      days: byName.days.rows.length,
      sessions: byName.sessions.rows.length,
      cardio: byName.cardio.rows.length,
      body: byName.body_measurements.rows.length,
      intervals: byName.rest_intervals.rows.length,
      archives: byName.weekly_archives.rows.length,
      tables: t.length,
      cells: fields,
      columns: byName.sets.header.length
    };
  }

  // =====================================================================
  // ZIP writer - store method (no compression), written by hand
  // =====================================================================
  // A store-only ZIP is a handful of little-endian structs, which is far less
  // code than pulling in a compression library, and CSV inside a ZIP is still
  // perfectly readable by every unzip tool, Excel and pandas.

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosStamp(date = new Date()) {
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      date: (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
  }

  function zipBlob(files) {
    const enc = new TextEncoder();
    const { time, date } = dosStamp();
    const parts = [], central = [];
    let offset = 0;

    files.forEach(f => {
      const name = enc.encode(f.name);
      // A BOM makes Excel open UTF-8 CSV correctly on Windows without an import wizard.
      const data = enc.encode((f.bom ? "﻿" : "") + f.text);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);      // bit 11: file name is UTF-8
      lv.setUint16(8, 0, true);           // method 0 = stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);

      const cd = new Uint8Array(46 + name.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);     // offset of this entry's local header
      cd.set(name, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  // =====================================================================
  // downloads
  // =====================================================================

  function baseName(opts = {}) {
    const list = scopeProjects(opts);
    const tag = list.length > 1 ? "all-projects" : slug(list[0]?.name);
    return `gymcoach-${tag}-${Store.todayKey()}`;
  }

  function readme(opts, t) {
    const s = stats(opts);
    return [
      "GymCoach data export",
      "====================",
      `Generated: ${stamp()}`,
      `Projects:  ${scopeProjects(opts).map(p => p.name).join(", ")}`,
      "",
      "Files",
      "-----",
      ...t.map(x => `  ${x.name}.csv  -  ${x.rows.length} rows x ${x.header.length} columns`),
      "  all_values.csv  -  every table melted to (table, record, field, value)",
      "",
      "Conventions",
      "-----------",
      "  * Every cell is quoted; separator is a comma; line ending is CRLF.",
      "  * Missing values are EMPTY, not the string \"not counted\", so numeric",
      "    columns stay numeric and load as NaN in pandas.",
      "  * *_effective_weight_kg is the standardised load: value converted to kg,",
      "    then divided by the pulley ratio (single 1, double 2, four 4). Compare",
      "    lifts on this column, never on weight_target.",
      "  * set_volume_kg = set_effective_weight_kg x set_reps.",
      "  * rir is stored per set and is never one of the set columns.",
      "  * rest_total_after_balancing_sec is the timer total after the delay",
      "    balance has been applied (gross elapsed + balance).",
      "  * workout_duration_min is derived from the AM/PM start and end clock and",
      "    wraps correctly past midnight.",
      "  * body_* columns are the most recent weekly check ON OR BEFORE that set's",
      "    date, so body weight is never back-dated.",
      "  * model_forecast.csv records what js/ml.js fitted: point_type is",
      "    'actual' or 'forecast', and r2 / rmse describe the fit.",
      "",
      "Quick start",
      "-----------",
      "  import pandas as pd",
      "  sets = pd.read_csv('sets.csv')",
      `  sets.groupby('session_date' if 'session_date' in sets else 'set_date')['set_volume_kg'].sum()`,
      "",
      `Row counts: ${s.sets} sets, ${s.exercises} exercises, ${s.days} day records,`,
      `${s.sessions} sessions, ${s.body} body checks, ${s.cardio} cardio entries.`
    ].join("\r\n");
  }

  function downloadMaster(opts = {}) {
    const t = setsTable(opts);
    if (!t.rows.length) { UI.toast("Nothing recorded to export yet.", "error"); return null; }
    UI.download(`${baseName(opts)}-sets.csv`, "﻿" + toCSV(t), "text/csv;charset=utf-8");
    UI.toast(`Exported ${t.rows.length} set rows x ${t.header.length} columns`);
    return t;
  }

  function downloadLong(opts = {}) {
    const t = melt(tables(opts));
    if (!t.rows.length) { UI.toast("Nothing recorded to export yet.", "error"); return null; }
    UI.download(`${baseName(opts)}-all-values.csv`, "﻿" + toCSV(t), "text/csv;charset=utf-8");
    UI.toast(`Exported ${t.rows.length} recorded values`);
    return t;
  }

  function downloadBundle(opts = {}) {
    const t = tables(opts);
    const long = melt(t);
    if (!long.rows.length) { UI.toast("Nothing recorded to export yet.", "error"); return null; }

    const files = [
      { name: "README.txt", text: readme(opts, t) },
      ...t.map(x => ({ name: `${x.name}.csv`, text: toCSV(x), bom: true })),
      { name: "all_values.csv", text: toCSV(long), bom: true }
    ];

    // The weekly archives are already CSV text; ship them as-is alongside the index.
    (Store.allArchivedCSVs() || []).forEach(a => {
      if (a.csv) files.push({ name: `weekly_archives/${slug(a.dayName)}-${a.weekStart || "week"}.csv`, text: a.csv, bom: true });
    });

    UI.download(`${baseName(opts)}.zip`, zipBlob(files), "application/zip");
    UI.toast(`Exported ${files.length} files (${long.rows.length} values)`);
    return files;
  }

  // Park a snapshot in localStorage so it survives a reload and appears in the
  // archived-CSV list next to the automatic weekly ones.
  function saveSnapshot(opts = {}) {
    const t = setsTable(opts);
    if (!t.rows.length) { UI.toast("Nothing recorded to snapshot yet.", "error"); return false; }
    const p = scopeProjects(opts)[0] || Store.active();
    const ok = Store.saveArchivedCSV(`snapshot:${p.id}:${Store.todayKey()}`, {
      projectId: p.id,
      projectName: p.name,
      dayId: "",
      dayName: `Full export · ${t.rows.length} sets`,
      weekStart: Store.todayKey(),
      csv: toCSV(t)
    });
    if (ok) {
      window.GymCoach?.renderArchivedCSVs?.();
      UI.toast("Snapshot saved on this device");
    }
    return ok;
  }

  return {
    // primitives
    toCSV, cell, zipBlob, crc32, clockSeconds, clockText, ampmMinutes, workoutTime,
    // tables
    setsTable, exercisesTable, daysTable, cardioTable, bodyTable, sessionsTable,
    restIntervalsTable, modelTable, archivesTable, tables, melt, stats,
    // outputs
    downloadMaster, downloadLong, downloadBundle, saveSnapshot, readme, baseName
  };
})();
