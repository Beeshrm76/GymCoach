// wearable.js — Amazfit / Zepp health data integration for GymCoach.
//
// How it works:
//  1. Manual entry: you type today's sleep and calorie numbers in the Progress
//     tab. Numbers are stored per calendar date in localStorage.
//  2. Zepp CSV import: Zepp's "Personal Data" export (Profile → Privacy →
//     Request Personal Data) produces a ZIP that contains SLEEP_DAILY.csv,
//     ACTIVITY_DAILY.csv, and HEART_DAILY.csv. Drop any file here and rows
//     merge into the same per-date store.
//  3. CSV Export: Click "Export CSV" to download the merged wearable dataset
//     anytime as a clean, standardized CSV file.
//  4. AI export: window.WearableStore.promptLines(dayISODate) provides detailed
//     recovery context (sleep stages, calories, steps, RHR) directly into the
//     AI Coach prompt.
//  5. Home dashboard: Shows recovery readiness badge and last night's stats.
//
// Storage key: "gymcoach_wearable_v1"
// Shape: { "<YYYY-MM-DD>": { sleepDurationMin, deepMin, shallowMin, remMin, wakeMin,
//                            sleepStart, sleepEnd, caloriesTotalKcal, stepsCount,
//                            restingHr, source, importedAt } }

window.WearableStore = (() => {
  const KEY = "gymcoach_wearable_v1";

  // ── persistence ──────────────────────────────────────────────────────────

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  }

  function writeAll(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function getDay(isoDate) {
    return readAll()[isoDate] || {};
  }

  function setDay(isoDate, fields) {
    if (!isoDate) return;
    const all = readAll();
    all[isoDate] = Object.assign(all[isoDate] || {}, fields);
    writeAll(all);
  }

  function clearDay(isoDate) {
    const all = readAll();
    delete all[isoDate];
    writeAll(all);
  }

  function clearAll() {
    localStorage.removeItem(KEY);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function toISO(raw) {
    if (!raw) return null;
    const s = String(raw).trim().replace(/["']/g, "").replace(/\//g, "-").replace(/\./g, "-");
    // Standard YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // DD-MM-YYYY or MM-DD-YYYY
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (dmy) {
      const p1 = parseInt(dmy[1], 10);
      const p2 = parseInt(dmy[2], 10);
      const yr = dmy[3];
      // Assume DD-MM-YYYY if p1 > 12
      if (p1 > 12) {
        return `${yr}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
      }
      return `${yr}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    }
    // Unix timestamp in seconds or ms
    const n = Number(s);
    if (Number.isFinite(n) && n > 100000000) {
      const ms = n < 10000000000 ? n * 1000 : n;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return null;
  }

  function safeInt(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  function safeFloat(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  // Normalizes sleep duration numbers: Zepp often reports seconds (e.g. 5400) or minutes (90)
  function toMinutes(val) {
    const num = safeInt(val);
    if (num === null || num < 0) return null;
    // If value is greater than 1440 (24 hours in min), it's definitely in seconds
    if (num > 1440) return Math.round(num / 60);
    return num;
  }

  // Robust CSV parser handling BOM, quotes, and newlines
  function parseCSV(text) {
    if (!text) return [];
    // Strip UTF-8 BOM
    const clean = text.replace(/^\uFEFF/, "").trim();
    const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    function splitRow(row) {
      const cells = [];
      let inQuotes = false;
      let cur = "";
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') {
          if (inQuotes && row[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === ',' && !inQuotes) {
          cells.push(cur.trim().replace(/^"|"$/g, ""));
          cur = "";
        } else {
          cur += c;
        }
      }
      cells.push(cur.trim().replace(/^"|"$/g, ""));
      return cells;
    }

    const headers = splitRow(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitRow(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
      return row;
    });
  }

  // ── Zepp CSV parsers ──────────────────────────────────────────────────────

  function importSleepCSV(text) {
    const rows = parseCSV(text);
    let imported = 0;
    rows.forEach(r => {
      const date = toISO(r.date || r.Date || r.DATE || r.timestamp || r.day || r.start_time);
      if (!date) return;

      const deepVal    = r.deepSleepTime    || r.deep_sleep_time    || r.deepTime    || r.deepSleep    || r.deep;
      const shallowVal = r.shallowSleepTime || r.shallow_sleep_time || r.shallowTime || r.lightSleepTime || r.lightSleep || r.shallow;
      const remVal     = r.remSleepTime     || r.rem_sleep_time     || r.remTime     || r.remSleep     || r.REM || r.rem;
      const wakeVal    = r.wakeTime         || r.wake_time          || r.wakeUpTime  || r.awakeTime    || r.awake || r.wake;
      const totalVal   = r.totalSleepTime   || r.sleepDuration      || r.duration    || r.totalTime;

      const deepMin    = toMinutes(deepVal);
      const shallowMin = toMinutes(shallowVal);
      const remMin     = toMinutes(remVal);
      const wakeMin    = toMinutes(wakeVal) ?? 0;

      let totalMin = toMinutes(totalVal);
      if (totalMin == null && (deepMin != null || shallowMin != null || remMin != null)) {
        totalMin = (deepMin || 0) + (shallowMin || 0) + (remMin || 0);
      }

      const startRaw = r.start || r.sleepStart || r.Start || r.bedtime || "";
      const stopRaw  = r.stop  || r.sleepEnd   || r.Stop  || r.wakeTime || r.wake_time_str || "";

      setDay(date, {
        ...(totalMin   != null && { sleepDurationMin: totalMin }),
        ...(deepMin    != null && { deepMin }),
        ...(shallowMin != null && { shallowMin }),
        ...(remMin     != null && { remMin }),
        ...(wakeMin    != null && { wakeMin }),
        ...(startRaw   && { sleepStart: startRaw }),
        ...(stopRaw    && { sleepEnd:   stopRaw }),
        source: "zepp-csv", importedAt: new Date().toISOString()
      });
      imported++;
    });
    return imported;
  }

  function importActivityCSV(text) {
    const rows = parseCSV(text);
    let imported = 0;
    rows.forEach(r => {
      const date = toISO(r.date || r.Date || r.DATE || r.timestamp || r.day);
      if (!date) return;
      const cal   = safeFloat(r.calories || r.Calories || r.CALORIES || r.kcal || r.totalCalories || r.activeCalories || r.burnedCalories);
      const steps = safeInt  (r.steps    || r.Steps    || r.STEPS    || r.stepCount || r.step_count);
      const hr    = safeInt  (r.restingHeartRate || r.restingHr || r.rhr || r.avgHeartRate || r.heartRate);

      setDay(date, {
        ...(cal   != null && { caloriesTotalKcal: Math.round(cal) }),
        ...(steps != null && { stepsCount: steps }),
        ...(hr    != null && { restingHr: hr }),
        source: "zepp-csv", importedAt: new Date().toISOString()
      });
      imported++;
    });
    return imported;
  }

  function importHeartCSV(text) {
    const rows = parseCSV(text);
    let imported = 0;
    rows.forEach(r => {
      const date = toISO(r.date || r.Date || r.DATE || r.timestamp);
      if (!date) return;
      const rhr = safeInt(r.restingHeartRate || r.resting_heart_rate || r.rhr || r.restingHr || r.rate || r.heartRate);
      if (rhr != null) {
        setDay(date, { restingHr: rhr, source: "zepp-csv", importedAt: new Date().toISOString() });
        imported++;
      }
    });
    return imported;
  }

  // Auto-detect dropped file type
  function importCSVAuto(text) {
    const firstLine = text.split(/\r?\n/)[0].toLowerCase();
    if (firstLine.includes("sleep") || firstLine.includes("deepsleep") || firstLine.includes("shallow")) {
      return { type: "sleep", count: importSleepCSV(text) };
    }
    if (firstLine.includes("calori") || firstLine.includes("steps") || firstLine.includes("distance") || firstLine.includes("activity")) {
      return { type: "activity", count: importActivityCSV(text) };
    }
    if (firstLine.includes("heart") || firstLine.includes("pulse") || firstLine.includes("rhr") || firstLine.includes("bpm")) {
      return { type: "heart", count: importHeartCSV(text) };
    }
    // Fallback: try sleep, then activity, then heart
    const a = importSleepCSV(text);
    if (a > 0) return { type: "sleep", count: a };
    const b = importActivityCSV(text);
    if (b > 0) return { type: "activity", count: b };
    const c = importHeartCSV(text);
    return { type: "generic", count: c };
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────

  function exportCSV() {
    const all = readAll();
    const dates = Object.keys(all).sort((a, b) => b.localeCompare(a));
    const header = [
      "date",
      "sleep_total_min",
      "deep_sleep_min",
      "light_sleep_min",
      "rem_sleep_min",
      "awake_min",
      "calories_kcal",
      "steps",
      "sleep_start",
      "sleep_end",
      "resting_hr_bpm",
      "source",
      "imported_at"
    ];

    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = dates.map(d => {
      const v = all[d] || {};
      return [
        v.date || d,
        v.sleepDurationMin ?? "",
        v.deepMin ?? "",
        v.shallowMin ?? "",
        v.remMin ?? "",
        v.wakeMin ?? "",
        v.caloriesTotalKcal ?? "",
        v.stepsCount ?? "",
        v.sleepStart || "",
        v.sleepEnd || "",
        v.restingHr ?? "",
        v.source || "manual",
        v.importedAt || ""
      ].map(q).join(",");
    });

    const csvContent = "\uFEFF" + [header.map(q).join(","), ...rows].join("\r\n");
    const filename = `gymcoach-wearable-data-${new Date().toISOString().slice(0, 10)}.csv`;
    if (window.UI?.download) {
      UI.download(filename, csvContent, "text/csv;charset=utf-8");
      UI.toast(`Exported ${dates.length} wearable record(s)`);
    }
    return csvContent;
  }

  // Table representation for DataPipeline (.zip bundle and long-format export)
  function exportTable() {
    const all = readAll();
    const dates = Object.keys(all).sort((a, b) => b.localeCompare(a));
    const header = [
      "date",
      "sleep_duration_min",
      "deep_sleep_min",
      "light_sleep_min",
      "rem_sleep_min",
      "awake_min",
      "calories_burned_kcal",
      "steps_count",
      "sleep_start",
      "sleep_end",
      "resting_hr_bpm",
      "source",
      "imported_at"
    ];
    const rows = dates.map(d => {
      const v = all[d] || {};
      return [
        d,
        v.sleepDurationMin ?? "",
        v.deepMin ?? "",
        v.shallowMin ?? "",
        v.remMin ?? "",
        v.wakeMin ?? "",
        v.caloriesTotalKcal ?? "",
        v.stepsCount ?? "",
        v.sleepStart || "",
        v.sleepEnd || "",
        v.restingHr ?? "",
        v.source || "manual",
        v.importedAt || ""
      ];
    });
    return { name: "wearable_health", header, rows, idCols: ["date"] };
  }

  // ── Recovery Assessment ───────────────────────────────────────────────────

  function getRecovery(isoDate) {
    const d = getDay(isoDate);
    if (!d || (!d.sleepDurationMin && !d.stepsCount && !d.caloriesTotalKcal)) {
      return null;
    }

    const totalMin = d.sleepDurationMin || 0;
    const deepMin  = d.deepMin || 0;
    const remMin   = d.remMin || 0;
    const deepRem  = deepMin + remMin;

    let score = 70; // baseline
    let label = "Moderate";
    let tone  = "warn";

    if (totalMin >= 450) { // >= 7.5 hrs
      score = 90;
      label = "Optimal";
      tone = "ok";
    } else if (totalMin >= 390) { // 6.5 - 7.5 hrs
      score = 80;
      label = "Good";
      tone = "ok";
    } else if (totalMin >= 330) { // 5.5 - 6.5 hrs
      score = 65;
      label = "Moderate";
      tone = "warn";
    } else if (totalMin > 0) {
      score = 50;
      label = "Recovery Deficit";
      tone = "danger";
    }

    // High restorative sleep bonus
    if (totalMin > 0 && deepRem > 0) {
      const deepRemPct = Math.round((deepRem / totalMin) * 100);
      if (deepRemPct >= 35 && score >= 70) score = Math.min(100, score + 5);
      if (deepRemPct < 15 && score > 60) score -= 10;
    }

    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const sleepStr = totalMin > 0 ? `${hours}h ${mins > 0 ? mins + "m" : ""}` : "Not logged";

    return {
      score,
      label,
      tone,
      sleepStr,
      totalMin,
      deepMin,
      shallowMin: d.shallowMin || 0,
      remMin,
      calories: d.caloriesTotalKcal,
      steps: d.stepsCount,
      restingHr: d.restingHr
    };
  }

  // ── AI prompt lines ────────────────────────────────────────────────────────
  // Called by report.js with the ISO date of the day being exported.

  function promptLines(isoDate) {
    const d = getDay(isoDate);
    if (!Object.keys(d).length) return [];
    const lines = [];
    const dev = d.source && d.source !== "manual" && d.source !== "Manual" ? ` (${d.source})` : "";
    lines.push(`Wearable data (${isoDate}${dev}):`);
    if (d.sleepDurationMin != null) {
      const h = Math.floor(d.sleepDurationMin / 60);
      const m = d.sleepDurationMin % 60;
      lines.push(`  Sleep total:   ${d.sleepDurationMin} min (${h}h ${m}m)`
        + (d.deepMin    != null ? `  |  deep ${d.deepMin} min`    : "")
        + (d.shallowMin != null ? `  |  light ${d.shallowMin} min` : "")
        + (d.remMin     != null ? `  |  REM ${d.remMin} min`      : "")
        + (d.wakeMin    != null ? `  |  awake ${d.wakeMin} min`    : ""));
    }
    if (d.sleepStart) lines.push(`  Sleep window: ${d.sleepStart} → ${d.sleepEnd || "?"}`);
    if (d.caloriesTotalKcal != null)
      lines.push(`  Calories burned (total day): ${d.caloriesTotalKcal} kcal`);
    if (d.stepsCount != null)
      lines.push(`  Steps: ${d.stepsCount.toLocaleString()}`);
    if (d.restingHr != null)
      lines.push(`  Resting Heart Rate: ${d.restingHr} bpm`);

    const rec = getRecovery(isoDate);
    if (rec) {
      lines.push(`  Readiness indicator: ${rec.label} (Score: ${rec.score}/100)`);
    }
    return lines;
  }

  // ── recent rows & stats for UI ─────────────────────────────────────────────

  function recentDays(n = 30) {
    const all = readAll();
    return Object.entries(all)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, n)
      .map(([date, v]) => ({ date, ...v }));
  }

  function stats(days = 7) {
    const rows = recentDays(days);
    if (!rows.length) return null;
    const sleepRows = rows.filter(r => r.sleepDurationMin != null);
    const calRows   = rows.filter(r => r.caloriesTotalKcal != null);
    const stepRows  = rows.filter(r => r.stepsCount != null);

    const avgSleep = sleepRows.length
      ? Math.round(sleepRows.reduce((s, r) => s + r.sleepDurationMin, 0) / sleepRows.length)
      : null;
    const avgCal = calRows.length
      ? Math.round(calRows.reduce((s, r) => s + r.caloriesTotalKcal, 0) / calRows.length)
      : null;
    const avgSteps = stepRows.length
      ? Math.round(stepRows.reduce((s, r) => s + r.stepsCount, 0) / stepRows.length)
      : null;

    return { count: rows.length, avgSleep, avgCal, avgSteps };
  }

  return {
    getDay,
    setDay,
    clearDay,
    clearAll,
    importCSVAuto,
    importSleepCSV,
    importActivityCSV,
    importHeartCSV,
    exportCSV,
    exportTable,
    getRecovery,
    promptLines,
    recentDays,
    stats,
    readAll
  };
})();


// ── UI ────────────────────────────────────────────────────────────────────────
// Renders the Wearable panel inside #progressView and wires all controls.

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  // Inject the panel right after the "Recent sets" panel
  const anchor = $("historyList")?.closest(".panel");
  if (!anchor) return;

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "wearablePanel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Wearable & Smartwatch Health</h2>
        <p class="muted small">Sleep, recovery and calorie expenditure from any watch or app (Apple Watch, Garmin, Zepp/Amazfit, Fitbit, Samsung, WHOOP, or manual entry).
          <a class="zepp-help-link" href="#zepp-how">Sync & Export guide</a></p>
      </div>
      <div class="panel-head-actions">
        <button class="btn small" id="wExportCsvBtn" title="Export recorded wearable data as CSV">Export CSV</button>
      </div>
    </div>

    <!-- how-to, hidden until the link is clicked -->
    <div class="zepp-howto" id="zepp-how" hidden>
      <ol>
        <li><b>Manual Entry from App:</b> Check your watch companion app (Apple Health, Garmin Connect, Zepp, Fitbit, WHOOP, Samsung Health, etc.) and enter today's metrics in the form below.</li>
        <li><b>Zepp / Amazfit CSV:</b> Open Zepp app → Profile → Privacy → Request Personal Data → Tap Export. Extract the ZIP and drop <b>SLEEP_DAILY.csv</b> or <b>ACTIVITY_DAILY.csv</b> below.</li>
        <li><b>Other Wearable CSV:</b> Standard daily sleep/activity CSV files from other brands can also be dropped here — fields are auto-detected and merged.</li>
        <li><b>Export Anytime:</b> Click <b>Export CSV</b> to save a clean, standardized backup of all your recorded wearable metrics.</li>
      </ol>
      <p class="muted small">100% offline & private — all health data stays securely on your device.</p>
    </div>

    <!-- Quick Stats Header -->
    <div class="wearable-stats-banner" id="wearableStatsBanner"></div>

    <!-- CSV import drop-zone -->
    <div class="wearable-import">
      <div class="zepp-dropzone" id="zeppDropzone">
        <span class="zepp-drop-icon">⌚</span>
        <b>Drop Wearable CSV here (SLEEP_DAILY.csv or ACTIVITY_DAILY.csv)</b>
        <span class="muted small">Or click to browse from device</span>
        <input type="file" accept=".csv,text/csv" id="zeppFileInput" hidden>
      </div>
      <div class="zepp-import-status" id="zeppImportStatus"></div>
    </div>

    <!-- manual entry form -->
    <div class="wearable-manual">
      <div class="wearable-manual-head">
        <h3>Manual entry / Daily check</h3>
        <label class="wearable-date-label">Date
          <input type="date" id="wearableDate">
        </label>
      </div>
      <div class="form-grid compact wearable-form">
        <label>Device / App
          <select id="wBrand">
            <option value="Manual Entry">Manual / Other</option>
            <option value="Apple Watch">Apple Watch</option>
            <option value="Garmin">Garmin</option>
            <option value="Amazfit">Amazfit / Zepp</option>
            <option value="Fitbit">Fitbit</option>
            <option value="Samsung">Samsung Galaxy</option>
            <option value="WHOOP">WHOOP</option>
            <option value="Pixel Watch">Pixel Watch</option>
            <option value="Oura">Oura Ring</option>
          </select>
        </label>
        <label>Sleep total (min)<input id="wSleepTotal" type="number" min="0" max="1440" placeholder="e.g. 450"></label>
        <label>Deep sleep (min)<input id="wDeepMin" type="number" min="0" max="1440" placeholder="e.g. 90"></label>
        <label>Light sleep (min)<input id="wShallowMin" type="number" min="0" max="1440" placeholder="e.g. 300"></label>
        <label>REM sleep (min)<input id="wRemMin" type="number" min="0" max="1440" placeholder="e.g. 60"></label>
        <label>Awake (min)<input id="wWakeMin" type="number" min="0" max="180" placeholder="e.g. 15"></label>
        <label>Calories burned (kcal)<input id="wCalories" type="number" min="0" max="9999" placeholder="e.g. 2200"></label>
        <label>Steps<input id="wSteps" type="number" min="0" max="99999" placeholder="e.g. 8500"></label>
        <label>Resting HR (bpm)<input id="wRestingHr" type="number" min="30" max="220" placeholder="e.g. 58"></label>
        <label>Sleep start<input id="wSleepStart" type="time" placeholder="22:30"></label>
        <label>Sleep end<input id="wSleepEnd" type="time" placeholder="06:45"></label>
      </div>
      <div class="wearable-manual-actions">
        <button class="btn primary" id="wSaveBtn">Save entry</button>
        <button class="btn danger" id="wClearBtn">Clear this date</button>
      </div>
    </div>

    <!-- recent data table -->
    <div class="wearable-table-wrap">
      <div class="wearable-table-head">
        <h3>Recorded Wearable Data <span class="wearable-row-count" id="wearableRowCount"></span></h3>
      </div>
      <div id="wearableTable" class="wearable-table"></div>
    </div>
  `;
  anchor.insertAdjacentElement("afterend", panel);

  // ---- helpers ---------------------------------------------------------------

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatMin(min) {
    if (min == null) return "—";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderWearableStats() {
    const banner = $("wearableStatsBanner");
    if (!banner) return;
    const st = WearableStore.stats(7);
    if (!st || !st.count) {
      banner.innerHTML = "";
      banner.style.display = "none";
      return;
    }
    banner.style.display = "flex";
    banner.innerHTML = `
      <div class="w-stat-pill">
        <span class="w-stat-label">7-Day Avg Sleep</span>
        <b class="w-stat-val">${st.avgSleep ? formatMin(st.avgSleep) : "—"}</b>
      </div>
      <div class="w-stat-pill">
        <span class="w-stat-label">7-Day Avg Burn</span>
        <b class="w-stat-val">${st.avgCal ? st.avgCal + " kcal" : "—"}</b>
      </div>
      <div class="w-stat-pill">
        <span class="w-stat-label">7-Day Avg Steps</span>
        <b class="w-stat-val">${st.avgSteps ? st.avgSteps.toLocaleString() : "—"}</b>
      </div>
      <div class="w-stat-pill">
        <span class="w-stat-label">Total Days</span>
        <b class="w-stat-val">${Object.keys(WearableStore.readAll()).length}</b>
      </div>
    `;
  }

  function renderWearableTable() {
    const rows = WearableStore.recentDays(30);
    const box = $("wearableTable");
    const count = $("wearableRowCount");
    renderWearableStats();

    if (!rows.length) {
      box.innerHTML = `<div class="empty">No wearable data yet. Import a Zepp CSV or log today's metrics above.</div>`;
      if (count) count.textContent = "";
      return;
    }
    if (count) count.textContent = `(${rows.length} days showing)`;

    box.innerHTML = `<table class="set-table">
      <thead><tr>
        <th>Date</th>
        <th>Sleep Total</th>
        <th>Deep</th>
        <th>Light</th>
        <th>REM</th>
        <th>Awake</th>
        <th>Calories</th>
        <th>Steps</th>
        <th>Resting HR</th>
        <th>Readiness</th>
        <th>Source</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const rec = WearableStore.getRecovery(r.date);
          const badge = rec
            ? `<span class="tag ${rec.tone === 'ok' ? 'ok' : rec.tone === 'danger' ? 'danger' : ''}">${rec.label}</span>`
            : "—";
          return `<tr>
            <td><b>${r.date}</b></td>
            <td>${r.sleepDurationMin != null ? formatMin(r.sleepDurationMin) : "—"}</td>
            <td>${r.deepMin != null ? r.deepMin + "m" : "—"}</td>
            <td>${r.shallowMin != null ? r.shallowMin + "m" : "—"}</td>
            <td>${r.remMin != null ? r.remMin + "m" : "—"}</td>
            <td>${r.wakeMin != null ? r.wakeMin + "m" : "—"}</td>
            <td>${r.caloriesTotalKcal != null ? r.caloriesTotalKcal.toLocaleString() + " kcal" : "—"}</td>
            <td>${r.stepsCount != null ? r.stepsCount.toLocaleString() : "—"}</td>
            <td>${r.restingHr != null ? r.restingHr + " bpm" : "—"}</td>
            <td>${badge}</td>
            <td class="muted small">${r.source || "manual"}</td>
            <td><button class="table-action danger" data-w-delete="${r.date}" title="Delete">×</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

    box.querySelectorAll("[data-w-delete]").forEach(btn => {
      btn.onclick = () => {
        WearableStore.clearDay(btn.dataset.wDelete);
        renderWearableTable();
        if ($("wearableDate").value === btn.dataset.wDelete) loadDateIntoForm(btn.dataset.wDelete);
        if (window.Home?.render) window.Home.render();
      };
    });
  }

  function loadDateIntoForm(isoDate) {
    const d = WearableStore.getDay(isoDate);
    $("wSleepTotal").value = d.sleepDurationMin ?? "";
    $("wDeepMin").value    = d.deepMin    ?? "";
    $("wShallowMin").value = d.shallowMin ?? "";
    $("wRemMin").value     = d.remMin     ?? "";
    $("wWakeMin").value    = d.wakeMin    ?? "";
    $("wCalories").value   = d.caloriesTotalKcal ?? "";
    $("wSteps").value      = d.stepsCount ?? "";
    $("wRestingHr").value  = d.restingHr  ?? "";
    $("wSleepStart").value = d.sleepStart ?? "";
    $("wSleepEnd").value   = d.sleepEnd   ?? "";
    if ($("wBrand")) {
      const src = d.source || "Manual Entry";
      // If the saved source matches an option, select it; otherwise default to Manual Entry
      const match = Array.from($("wBrand").options).find(o => o.value.toLowerCase() === src.toLowerCase());
      $("wBrand").value = match ? match.value : "Manual Entry";
    }
  }

  function setStatus(msg, ok = true) {
    const el = $("zeppImportStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "zepp-import-status " + (ok ? "ok" : "err");
    if (ok) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4500);
  }

  // ---- date picker -----------------------------------------------------------
  const dateInput = $("wearableDate");
  dateInput.value = todayISO();
  loadDateIntoForm(todayISO());
  dateInput.addEventListener("change", () => loadDateIntoForm(dateInput.value));

  // ---- save / clear ----------------------------------------------------------
  $("wSaveBtn").addEventListener("click", () => {
    const date = dateInput.value || todayISO();
    const si = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const brand = $("wBrand")?.value || "Manual Entry";

    WearableStore.setDay(date, {
      ...(si($("wSleepTotal").value) != null && { sleepDurationMin: si($("wSleepTotal").value) }),
      ...(si($("wDeepMin").value)    != null && { deepMin:          si($("wDeepMin").value) }),
      ...(si($("wShallowMin").value) != null && { shallowMin:       si($("wShallowMin").value) }),
      ...(si($("wRemMin").value)     != null && { remMin:           si($("wRemMin").value) }),
      ...(si($("wWakeMin").value)    != null && { wakeMin:          si($("wWakeMin").value) }),
      ...(si($("wCalories").value)   != null && { caloriesTotalKcal: si($("wCalories").value) }),
      ...(si($("wSteps").value)      != null && { stepsCount:       si($("wSteps").value) }),
      ...(si($("wRestingHr").value)  != null && { restingHr:        si($("wRestingHr").value) }),
      ...($("wSleepStart").value && { sleepStart: $("wSleepStart").value }),
      ...($("wSleepEnd").value   && { sleepEnd:   $("wSleepEnd").value }),
      source: brand, importedAt: new Date().toISOString()
    });
    setStatus(`Saved wearable entry for ${date} (${brand})`, true);
    renderWearableTable();
    if (window.Home?.render) window.Home.render();
  });

  $("wClearBtn").addEventListener("click", () => {
    const date = dateInput.value || todayISO();
    WearableStore.clearDay(date);
    loadDateIntoForm(date);
    renderWearableTable();
    setStatus(`Cleared ${date}`, true);
    if (window.Home?.render) window.Home.render();
  });

  // ---- CSV export button -----------------------------------------------------
  $("wExportCsvBtn")?.addEventListener("click", () => {
    WearableStore.exportCSV();
  });

  // ---- how-to toggle ---------------------------------------------------------
  panel.querySelector(".zepp-help-link").addEventListener("click", e => {
    e.preventDefault();
    const hw = $("zepp-how");
    hw.hidden = !hw.hidden;
  });

  // ---- CSV drop-zone ---------------------------------------------------------
  const dz = $("zeppDropzone");
  const fi = $("zeppFileInput");

  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", e => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) readAndImport(file);
  });
  fi.addEventListener("change", e => {
    const file = e.target.files[0];
    fi.value = "";
    if (file) readAndImport(file);
  });

  function readAndImport(file) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setStatus("Not a CSV file. Please export SLEEP_DAILY.csv or ACTIVITY_DAILY.csv from Zepp.", false);
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const { type, count } = WearableStore.importCSVAuto(ev.target.result);
        if (count === 0) {
          setStatus("No records imported — check that the file is from Zepp (SLEEP_DAILY.csv or ACTIVITY_DAILY.csv).", false);
        } else {
          setStatus(`Imported ${count} ${type} record${count !== 1 ? "s" : ""} from ${file.name}`, true);
          renderWearableTable();
          if (window.Home?.render) window.Home.render();
        }
      } catch (err) {
        setStatus(`Import failed: ${err.message}`, false);
      }
    };
    reader.readAsText(file);
  }

  renderWearableTable();
});

