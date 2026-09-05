// app.js - Today view, the sidebar, the exercise-details panel and the custom set table.
//Front list contract: an exercise row shows a MEDIA THUMBNAIL, the name, and target chips. Demo, RIR, rest, tempo, equipment, cues and the set table all live inside the details panel.

(() => {
  const $ = id => document.getElementById(id);
  const esc = v => UI.esc(v);

  let currentDayId = null;
  let currentExerciseId = null;
  let cardioDraft = [];
  let timerSeconds = 0, timerRunning = false, timerId = null, timerStartedAt = null, timerSetIndex = 0, timerSetId = null, timerMode = "idle", timerElapsedGross = 0, timerTargetSeconds = 30, timerBalanceSeconds = 5;

  const project = () => Store.active();


  function intensityPercent(score) {
    return Math.max(0, Math.min(100, Math.round((Number(score) || 0) / 5 * 100)));
  }

  function intensityLevel(score) {
    // Scale direction: green = rest/light, red = heaviest workout — Score runs 0 (rest) to 5 (heaviest)
    if (score >= 4) return { label: "Red", cls: "red" };
    if (score >= 3) return { label: "Orange", cls: "orange" };
    if (score >= 2) return { label: "Yellow", cls: "yellow" };
    if (score >= 1) return { label: "Light green", cls: "lightgreen" };
    return { label: "Green", cls: "green" };
  }

  function intensityMarkup(score, title = "Intensity") {
    const value = Math.max(0, Math.min(5, Number(score) || 0));
    const level = intensityLevel(value);
    return `<div class="intensity-card level-${level.cls}">
      <div class="intensity-head"><span class="intensity-title">${esc(title)}</span></div>
      <div class="intensity-bar" style="--intensity-position:${intensityPercent(value)}%" aria-label="Workout intensity scale"><span class="intensity-indicator" aria-hidden="true"></span></div>
    </div>`;
  }

  function parseTimeSeconds(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
      const parts = text.split(":").map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  }

  function formatTime(total) {
    const sec = Math.max(0, Math.round(Number(total) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function timeColumn(ex) {
    return (ex?.setColumns || []).find(c => c.key === "time" || /time/i.test(c.label || "")) || null;
  }

  function nextRecordableRow(ex) {
    const rows = Store.currentSessionRows(ex);
    if (!rows.length) return null;
    const index = rows.findIndex(r => !r.completed);
    return index >= 0 ? { row: rows[index], index } : null;
  }

  function renderSetTimer(ex) {
    if (!ex) return;
    const rows = Store.currentSessionRows(ex);
    if (!rows.length) return;
    const current = timerSetId ? rows.find(r => r.id === timerSetId) : null;
    let rowIndex = current && !current.completed ? rows.findIndex(r => r.id === current.id) : -1;
    if (rowIndex < 0) {
      const next = nextRecordableRow(ex);
      rowIndex = next ? next.index : Math.max(0, rows.length - 1);
    }
    timerSetIndex = rowIndex;
    timerSetId = rows[rowIndex]?.id || null;
    const label = $("timerRecordingSet");
    if (label) label.textContent = `Set ${rowIndex + 1}`;
    renderTimer();
  }

  function updateSelectedSetTime(ex, value = timerSeconds, recordedAt = new Date().toISOString()) {
    const col = timeColumn(ex), rows = Store.currentSessionRows(ex);
    const rowIndex = ex.logs.findIndex(x => x.id === timerSetId);
    const row = rowIndex >= 0 ? ex.logs[rowIndex] : rows[timerSetIndex];
    if (!col || !row) return false;
    const resolvedIndex = ex.logs.findIndex(x => x.id === row.id);
    if (resolvedIndex < 0) return false;

    // The timestamp is written only after the final calculated time is known.
    ex.logs[resolvedIndex].values[col.key] = formatTime(value);
    ex.logs[resolvedIndex].timeRecordedAt = recordedAt;
    ex.logs[resolvedIndex].date = recordedAt;
    save({ silent: true });
    renderSetTable();
    renderSetTimer(ex);
    return true;
  }

  function renderTopIntensity(d) {
    const score = d?.type === "workout" ? Store.dayIntensity(d) : 0;
    const wrap = $("topIntensity");
    if (wrap) wrap.style.setProperty("--intensity-position", `${intensityPercent(score)}%`);
  }

  function renderIntensity(d) {
    const score = d?.type === "workout" ? Store.dayIntensity(d) : 0;
    renderTopIntensity(d);
    const detail = $("detailIntensity");
    if (detail && d?.type === "workout" && currentExerciseId) {
      const ex = exercise();
      if (ex) {
        const prevRows = Store.previousSessionRows(ex);
        const currRows = Store.currentSessionRows(ex);
        const prevData = summariseSessionRows(ex, prevRows);
        const currData = summariseSessionRows(ex, currRows);
        detail.innerHTML = `<div class="detail-prev-current">
          <div class="pc-card">
            <div class="pc-card-title">Previous</div>
            <div class="pc-vals">
              <div class="pc-val"><span class="pc-val-label">Weight</span><span class="pc-val-data">${esc(prevData.weight || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">Reps</span><span class="pc-val-data">${esc(prevData.reps || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">Sets</span><span class="pc-val-data">${esc(prevData.sets || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">RIR</span><span class="pc-val-data">${esc(prevData.rir || "—")}</span></div>
            </div>
          </div>
          <div class="pc-card is-current">
            <div class="pc-card-title">Current</div>
            <div class="pc-vals">
              <div class="pc-val"><span class="pc-val-label">Weight</span><span class="pc-val-data">${esc(currData.weight || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">Reps</span><span class="pc-val-data">${esc(currData.reps || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">Sets</span><span class="pc-val-data">${esc(currData.sets || "—")}</span></div>
              <div class="pc-val"><span class="pc-val-label">RIR</span><span class="pc-val-data">${esc(currData.rir || "—")}</span></div>
            </div>
          </div>
        </div>`;
      } else {
        detail.innerHTML = "";
      }
    } else if (detail) {
      detail.innerHTML = "";
    }
    if ($("projectIntensityProgress")) $("projectIntensityProgress").innerHTML = intensityMarkup(Store.projectIntensity(project()), "Workout Intensity");
  }

  function summariseSessionRows(ex, rows) {
    if (!rows.length) return { weight: "", reps: "", sets: "", rir: "" };
    const wCol = (ex.setColumns || []).find(c => c.key === "weight" || /weight/i.test(c.label || ""));
    const rCol = (ex.setColumns || []).find(c => c.key === "reps" || /rep/i.test(c.label || ""));
    const weights = rows.map(r => r.values?.[wCol?.key] ?? "").filter(Boolean);
    const reps = rows.map(r => r.values?.[rCol?.key] ?? "").filter(Boolean);
    const rirs = rows.map(r => r.rir ?? r.values?.rir ?? "").filter(v => v !== "" && v !== undefined && v !== null);
    const completedSets = rows.filter(r => r.completed).length;
    return {
      weight: weights.length ? weights.join(", ") : "",
      reps: reps.length ? reps.join(", ") : "",
      sets: `${completedSets}/${rows.length}`,
      rir: rirs.length ? rirs.join(", ") : ""
    };
  }

  function day() {
    const p = project();
    if (!p.days.length) return null;
    return p.days.find(d => d.id === currentDayId)
      || p.days.find(d => d.type === "workout")
      || p.days[0];
  }

  const exercise = () => day()?.exercises.find(e => e.id === currentExerciseId) || null;
  const save = (opts) => Store.save(opts);

  // views

  const VIEWS = ["homeView", "todayView", "manageView", "aiView"];
  function showView(id) {
    VIEWS.forEach(v => { const el = $(v); if (el) el.hidden = v !== id; });
    document.querySelectorAll("[data-view-btn]").forEach(b =>
      b.classList.toggle("active", b.dataset.viewBtn === id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const showHome = () => {
    history.replaceState(null, "", "#home");
    showView("homeView");
    renderProgress();
    window.Home?.render?.();
  };
  const showToday = () => {
    const scheduled = Store.dayForWeekday
      ? Store.dayForWeekday(Store.active(), new Date().getDay())
      : Store.active().days.find(d => Number.isInteger(d.weekday) && d.weekday === new Date().getDay());
    if (scheduled) currentDayId = scheduled.id;
    showView("todayView");
    renderToday();
  };
  const showManage = () => { showView("manageView"); window.Manage?.render(); };
  // Kept as an alias so any older link, bookmark or data-action still lands
  const showProgress = showHome;
  const showAI = () => { showView("aiView"); window.ReportCoach?.render(); };

  // sidebar

  function renderProjectNav() {
    const box = $("projectNav");
    if (!box) return;
    box.innerHTML = "";
    const activeProject = project();
    Store.all().forEach(p => {
      const prog = Store.projectProgress(p);
      const b = document.createElement("button");
      b.className = "nav-btn" + (p.id === activeProject.id ? " active" : "");
      b.title = p.name;
      b.innerHTML = `<span class="nav-icon">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="nav-text"><b>${esc(p.name)}</b><small>${p.days.length} days · ${prog.pct}%</small></span>`;
      b.onclick = () => {
        Store.setActive(p.id);
        currentDayId = null;
        currentExerciseId = null;
        renderAll();
        UI.toggleDrawer(false);
      };
      box.appendChild(b);
    });
  }

  function getDayPicture(d) {
    if (!d) return "";
    const id = (d.id || Math.random().toString(36).slice(2, 7)).replace(/[^a-zA-Z0-9]/g, "_");
    const cat = (d.category || "").toLowerCase();
    const type = (d.type || "").toLowerCase();
    const title = (d.title || "").toLowerCase();
    const name = (d.name || "").toLowerCase();
    const focus = (d.focus || "").toLowerCase();
    const muscles = (d.muscles || "").toLowerCase();
    const exNames = Array.isArray(d.exercises) ? d.exercises.map(e => e.name || "").join(" ").toLowerCase() : "";
    const text = `${cat} ${type} ${title} ${name} ${focus} ${muscles} ${exNames}`;

    if (type === "rest" || cat === "rest" || /rest|recovery|off|sleep|break/.test(text)) {
      // Rest Day: Crescent moon + stars on vanta night badge
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#121212" stroke="#262626" stroke-width="1"/>
        <path d="M17 13a5 5 0 01-6-6 5.5 5.5 0 106 6z" fill="#38bdf8"/>
        <circle cx="18" cy="7" r="1.2" fill="#7dd3fc"/>
        <circle cx="21" cy="12" r=".8" fill="#7dd3fc" opacity=".7"/>
        <circle cx="12" cy="18" r=".7" fill="#7dd3fc" opacity=".5"/>
      </svg>`;
    }

    // Determine Day Type:
    // 1. Explicit d.category ("push", "pull", "leg", "other")
    // 2. Name matching: Wednesday & Friday -> PULL; Thursday & Sunday -> LEG; Tuesday -> PUSH
    // 3. Keyword matching in title / focus / exercises
    let dayType = cat;
    if (!dayType) {
      if (name.includes("wednesday") || name.includes("friday")) {
        dayType = "pull";
      } else if (name.includes("thursday") || name.includes("sunday")) {
        dayType = "leg";
      } else if (name.includes("tuesday")) {
        dayType = "push";
      } else if (/pull|row|lat|back|chin|deadlift/.test(title)) {
        dayType = "pull";
      } else if (/leg|squat|quad|hamstring|lower|lunge|calves/.test(title)) {
        dayType = "leg";
      } else if (/push|chest|bench|press|shoulder|tricep/.test(title)) {
        dayType = "push";
      } else if (/cardio|run|hiit/.test(text)) {
        dayType = "cardio";
      } else if (/arm|bicep|tricep/.test(text)) {
        dayType = "arms";
      } else {
        dayType = "other";
      }
    }

    // PULL DAY (Wednesday & Friday, or any Pull day):
    // Bent-over barbell row / pull athlete pulling bar up to torso (clearly different from Push)
    if (dayType === "pull") {
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#0369a1"/>
        <circle cx="18.5" cy="7.5" r="2.2" fill="#ffffff"/>
        <line x1="18" y1="9.5" x2="11.5" y2="15.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="15" y1="12" x2="9" y2="18" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="5" y1="18" x2="15" y2="18" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <rect x="4" y="15.5" width="2" height="5" rx=".8" fill="#ffffff"/>
        <rect x="14" y="15.5" width="2" height="5" rx=".8" fill="#ffffff"/>
        <line x1="11.5" y1="15.5" x2="13.5" y2="20.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="13.5" y1="20.5" x2="15" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="11.5" y1="15.5" x2="8.5" y2="20.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="8.5" y1="20.5" x2="8" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    // PUSH DAY (Tuesday, or any Push day):
    // Athlete in upright power stance pressing loaded barbell overhead
    if (dayType === "push") {
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#2563eb"/>
        <line x1="6" y1="5" x2="22" y2="5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <rect x="4.5" y="3" width="2" height="4.5" rx=".8" fill="#ffffff"/>
        <rect x="21.5" y="3" width="2" height="4.5" rx=".8" fill="#ffffff"/>
        <circle cx="14" cy="10" r="2.3" fill="#ffffff"/>
        <line x1="14" y1="12.5" x2="8.5" y2="5" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="14" y1="12.5" x2="19.5" y2="5" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="14" y1="12" x2="14" y2="18.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="14" y1="18.5" x2="10" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="14" y1="18.5" x2="18" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    // LEG DAY (Thursday & Sunday, or any Leg day):
    // Athlete in deep barbell back squat
    if (dayType === "leg") {
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#6b21a8"/>
        <circle cx="14" cy="5.2" r="2.3" fill="#ffffff"/>
        <line x1="5" y1="9" x2="23" y2="9" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <rect x="3.5" y="7" width="2" height="4.5" rx=".8" fill="#ffffff"/>
        <rect x="22.5" y="7" width="2" height="4.5" rx=".8" fill="#ffffff"/>
        <line x1="14" y1="9" x2="14" y2="15" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="14" y1="15" x2="9" y2="19" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="14" y1="15" x2="19" y2="19" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="9" y1="19" x2="7" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="19" y1="19" x2="21" y2="25" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    if (dayType === "cardio") {
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#b91c4a"/>
        <circle cx="16" cy="6" r="2.2" fill="#fff"/>
        <line x1="14" y1="8.5" x2="12" y2="15" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="15" x2="8" y2="12" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="14" y1="10" x2="19" y2="12" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="12" y1="15" x2="16" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="20" x2="20" y2="25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="15" x2="8" y2="25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }

    if (dayType === "arms") {
      return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#b45309"/>
        <path d="M8 20c0-3 2-6 5-7l2-5c1-2 3-2 4-1l-1 5c3 1 4 4 3 7H8z" fill="#fff" fill-opacity=".9"/>
      </svg>`;
    }

    // Default / General Workout: Dumbbell
    return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#181818" stroke="#282828" stroke-width="1"/>
      <line x1="7" y1="10" x2="7" y2="18" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>
      <line x1="10.5" y1="11" x2="10.5" y2="17" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>
      <line x1="17.5" y1="11" x2="17.5" y2="17" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>
      <line x1="21" y1="10" x2="21" y2="18" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>
      <line x1="10.5" y1="14" x2="17.5" y2="14" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  function renderDayNav() {
    const box = $("dayNav");
    if (!box) return;
    box.innerHTML = "";
    const p = project();
    const active = day();

    if (!p.days.length) {
      box.innerHTML = `<div class="nav-empty">No days yet.<br>Open Manage to add one.</div>`;
      return;
    }

    p.days.forEach(d => {
      const prog = Store.dayProgress(d);
      const b = document.createElement("button");
      b.className = "nav-btn day-btn" + (d.id === active?.id ? " active" : "") + (d.type === "rest" ? " is-rest" : "");
      b.title = `${d.name} — ${d.type === "rest" ? "Rest" : d.title}`;
      b.innerHTML = `<span class="nav-icon has-picture">${getDayPicture(d)}</span>
        <span class="nav-text"><b>${esc(d.name)}</b><small>${d.type === "rest" ? "Rest" : `${esc(d.title || "Workout")} · ${prog.done}/${prog.total}`}</small></span>`;
      b.onclick = () => {
        currentDayId = d.id;
        showView("todayView");
        renderToday();
        UI.toggleDrawer(false);
      };
      box.appendChild(b);
    });
  }

  // --------------------------------------------------------------- today

  function renderToday() {
    const p = project();
    const d = day();

    $("sessionProject").textContent = p.name;
    const now = new Date();
    $("dateLabel").textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    $("currentDateTime") && ($("currentDateTime").textContent = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));

    // A project with no days used to leave the whole view showing stale data.
    if (!d) {
      currentDayId = null;
      $("pageTitle").textContent = p.name;
      $("pageSubtitle").textContent = "This project has no days yet.";
      $("sessionDay").textContent = "—";
      $("exerciseCount").textContent = "0";
      $("completion").textContent = "0%";
      $("focus").textContent = "No days";
      $("muscles").textContent = "";
      $("dayFocusShort").textContent = "—";
      $("progressBar").style.width = "0%";
      $("exerciseList").innerHTML = `<div class="empty-state">
          <b>Nothing scheduled yet</b>
          <p>Add your first day, then choose whether it's a workout or a rest day.</p>
          <button class="btn primary" data-action="create-day">+ Add a day</button>
        </div>`;
      renderProjectNav(); renderDayNav();
      return;
    }

    currentDayId = d.id;
    const isRest = d.type === "rest";
    const prog = Store.dayProgress(d);

    $("sessionDay").textContent = d.name;
    // "+ Exercise" / "Clear log" make no sense on a rest day.
    $("heroActions").hidden = isRest;
    $("exerciseCount").textContent = isRest ? "—" : d.exercises.length;
    $("completion").textContent = isRest ? "Rest" : `${prog.pct}%`;
    $("pageTitle").textContent = isRest ? (d.title || d.name) : (d.title || "Workout");
    $("pageSubtitle").textContent = isRest ? (d.restNotes || "Recovery day") : (d.subtitle || "");
    $("focus").textContent = isRest ? "Recovery / Rest" : (d.focus || d.title || "Workout");
    $("muscles").textContent = isRest ? (d.restNotes || "No training scheduled") : (d.muscles || "");
    $("dayFocusShort").textContent = (isRest ? d.restNotes : d.focus) || d.title || "—";
    $("progressBar").style.width = `${isRest ? 0 : prog.pct}%`;
    $("dayProgressLabel").textContent = isRest ? "Rest day" : `${prog.done} of ${prog.total} done`;
    renderWorkTime(d);
    renderIntensity(d);
    renderCardioSummary(d);

    renderExercises(d);
    renderProjectNav();
    renderDayNav();
    window.WorkoutPlayer?.render?.();
  }


  function renderWorkTime(d) {
    const row = $("workTimeRow");
    if (!row) return;
    row.hidden = d.type === "rest";
    if (row.hidden) return;
    const wt = Store.getWorkTime(d);
    $("workStartTime").value = wt.startTime || "";
    $("workStartAmPm").value = wt.startAmPm || "AM";
    $("workEndTime").value = wt.endTime || "";
    $("workEndAmPm").value = wt.endAmPm || "AM";
  }

  function saveWorkTime(patch) {
    const d = day();
    if (!d) return;
    Store.setWorkTime(d, patch);
    save({ silent: true });
  }

  function renderExercises(d) {
    const box = $("exerciseList");
    box.innerHTML = "";

    if (d.type === "rest") {
      box.innerHTML = `<div class="rest-day-body">
          <div class="rest-icon">◍</div>
          <h3>${esc(d.title || "Rest Day")}</h3>
          <p>${esc(d.restNotes || "Use this day for recovery.")}</p>
          <div class="rest-actions">
            <button class="btn" data-action="manage-project">Edit this day</button>
            <button class="btn" data-action="show-progress">Log weekly check</button>
          </div>
        </div>`;
      return;
    }

    if (!d.exercises.length) {
      box.innerHTML = `<div class="empty-state">
          <b>No exercises on ${esc(d.name)}</b>
          <p>Add one here, or switch this day to Rest in Manage.</p>
          <button class="btn primary" data-action="add-exercise">+ Add exercise</button>
        </div>`;
      return;
    }

    d.exercises.forEach(ex => {
      const done = Store.isExerciseDone(ex);
      const started = !done && Store.isExerciseStarted(ex);
      const loggedSets = ex.logs.filter(l => l.completed).length;

      const row = document.createElement("div");
      row.className = "exercise-row" + (done ? " completed" : "") + (started ? " started" : "");
      row.dataset.exId = ex.id;
      row.innerHTML = `
        <div class="exercise-thumb" data-thumb="${ex.id}">
          <div class="thumb-fallback">▦</div>
        </div>
        <div class="exercise-main">
          <div class="exercise-name">${esc(ex.name)}</div>
        </div>
        <div class="row-status">
          <button class="check-btn ${done ? "checked" : ""}" data-complete="${ex.id}"
                  title="${done ? "Mark not done" : "Mark all sets done"}"
                  aria-label="${done ? "Mark not done" : "Mark all sets done"}">${done ? "✓" : "○"}</button>
        </div>`;

      row.addEventListener("click", ev => {
        if (ev.target.closest("[data-complete]")) return;
        openDetails(ex.id);
      });
      box.appendChild(row);
      paintThumb(ex);
    });
  }

  async function paintThumb(ex) {
    const holder = document.querySelector(`[data-thumb="${ex.id}"]`);
    if (!holder) return;
    const src = await mediaSrc(ex, "image");
    if (!src || !holder.isConnected) return;
    const img = document.createElement("img");
    img.alt = "";
    img.onload = () => {
      if (holder.isConnected) {
        holder.innerHTML = "";
        holder.appendChild(img);
      }
    };
    img.onerror = () => {
      // image doesn't exist on disk, keep the fallback icon
    };
    img.src = src;
  }

  // Derives a slug from any name: "Shoulder Press Machine" → "shoulder_press_machine"
  function slugFromName(name) {
    if (!name) return "";
    return name.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")   // non-alphanum → underscore
      .replace(/^_|_$/g, "");         // trim leading/trailing _
  }

  // Derives a default video path from exercise name:
  //   "Seated Chest Press" → "videos/seated_chest_press.mp4"
  function videoPathFromName(name) {
    const slug = slugFromName(name);
    return slug ? `videos/${slug}.mp4` : "";
  }

  // Derives a default image path from exercise name:
  //   "Seated Chest Press" → "images/seated_chest_press.jpg"
  function imagePathFromName(name) {
    const slug = slugFromName(name);
    return slug ? `images/${slug}.jpg` : "";
  }

  // Checks whether a path is empty or matches the auto-generated pattern for
  // *any* exercise name (i.e. "videos/<slug>.mp4" or "images/<slug>.jpg").
  // Returns true if the path should be auto-updated when the name changes.
  function isAutoGeneratedPath(path, kind) {
    if (!path) return true;
    const p = path.replace(/\\/g, "/").trim();
    if (!p) return true;
    if (kind === "video") return /^videos\/[a-z0-9_]+(\.mp4)?$/i.test(p);
    if (kind === "image") return /^images\/[a-z0-9_]+(\.(?:jpg|jpeg|png|webp))?$/i.test(p);
    return false;
  }

  // Live-updates the video/image path fields and placeholders when the exercise
  // name input changes, but only if the current path is empty or matches the
  // auto-generated format (so manually typed custom paths are never overwritten).
  function updatePathFieldsFromName(name) {
    const vInput = $("detailVideoPath"), iInput = $("detailImagePath");
    if (!vInput || !iInput) return;
    const vPath = videoPathFromName(name), iPath = imagePathFromName(name);
    // Update placeholder always
    vInput.placeholder = vPath || "e.g. videos/bench_press.mp4";
    iInput.placeholder = iPath || "e.g. images/bench_press.jpg";
    // Update value only if it's auto-generated or empty
    if (isAutoGeneratedPath(vInput.value, "video")) vInput.value = vPath;
    if (isAutoGeneratedPath(iInput.value, "image")) iInput.value = iPath;
  }

  // Strips day/project subfolders, handles Windows backslashes, and replaces hyphens with underscores:
  //   "videos\Tuesday_Push_A\seated-chest-press.mp4" → "videos/seated_chest_press.mp4"
  function normalizeVideoPath(p) {
    if (!p) return "";
    const clean = p.replace(/\\/g, "/").trim();
    let filename = clean.split("/").pop();
    if (!filename) return "";
    filename = filename.replace(/-/g, "_");
    if (!/\.[a-z0-9]+$/i.test(filename)) filename += ".mp4";
    return `videos/${filename}`;
  }

  // Strips day/project subfolders, handles Windows backslashes, and replaces hyphens with underscores:
  //   "images\Tuesday_Push_A\seated-chest-press.jpg" → "images/seated_chest_press.jpg"
  function normalizeImagePath(p) {
    if (!p) return "";
    const clean = p.replace(/\\/g, "/").trim();
    let filename = clean.split("/").pop();
    if (!filename) return "";
    filename = filename.replace(/-/g, "_");
    if (!/\.[a-z0-9]+$/i.test(filename)) filename += ".jpg";
    return `images/${filename}`;
  }

  async function mediaSrc(ex, kind) {
    const pid = project().id;
    try {
      // 1. Check media explicitly saved for this project + exercise
      const stored = kind === "video"
        ? await MediaStore.getVideoURL(pid, ex.id)
        : await MediaStore.getImageURL(pid, ex.id);
      if (stored) return stored;

      // 2. Check media stored globally by exercise name slug (allows cross-project reuse without re-uploading)
      const nameSlug = slugFromName(ex.name);
      if (nameSlug && window.MediaStore?.getMediaBySlugURL) {
        const shared = await MediaStore.getMediaBySlugURL(nameSlug, kind);
        if (shared) return shared;
      }
      // 3. Also check slug derived from the assigned path (e.g. videos/shoulder_press_machine.mp4)
      const pathVal = kind === "video" ? ex.video : ex.image;
      if (pathVal && window.MediaStore?.getMediaBySlugURL) {
        const clean = pathVal.replace(/\\/g, "/").trim();
        const fileBase = (clean.split("/").pop() || "").replace(/\.[^.]+$/, "");
        const pathSlug = slugFromName(fileBase);
        if (pathSlug && pathSlug !== nameSlug) {
          const sharedPath = await MediaStore.getMediaBySlugURL(pathSlug, kind);
          if (sharedPath) return sharedPath;
        }
      }
    } catch { /* IndexedDB unavailable (private mode) - fall back to the static path */ }
    if (kind === "video") return normalizeVideoPath(ex.video) || videoPathFromName(ex.name) || null;
    if (kind === "image") return normalizeImagePath(ex.image) || imagePathFromName(ex.name) || null;
    return null;
  }

  function toggleComplete(exId) {
    const ex = day()?.exercises.find(e => e.id === exId);
    if (!ex) return;
    Store.setExerciseDone(ex, !Store.isExerciseDone(ex));
    save();
    renderToday();
  }


  function numericWeightText(value) {
    const n = Store.parseWeightNumber(value);
    return n === null ? "" : String(n);
  }
  function currentWeightColumn(ex) {
    return ex.setColumns.find(c => c.key === "weight" || /weight/i.test(c.label || "")) || null;
  }
  function convertExerciseWeight(ex, newUnit) {
    const oldUnit = Store.normalizeWeightUnit(ex.weightUnit || "kg");
    if (oldUnit === newUnit) return;
    if (Store.parseWeightNumber(ex.weight) !== null) ex.weight = Store.convertWeightValue(ex.weight, oldUnit, newUnit);
    const wc = currentWeightColumn(ex);
    if (wc) ex.logs.forEach(log => {
      if (Store.parseWeightNumber(log.values?.[wc.key]) !== null)
        log.values[wc.key] = Store.convertWeightValue(log.values[wc.key], oldUnit, newUnit);
    });
    ex.weightUnit = newUnit;
  }
  function convertExercisePulley(ex, newPulley) {
    const old = Store.pulleyKey(ex.pulleySystem || "single"), next = Store.pulleyKey(newPulley);
    if (old === next) return;
    const unit = Store.normalizeWeightUnit(ex.weightUnit || "kg");
    if (Store.parseWeightNumber(ex.weight) !== null) ex.weight = Store.convertPulleyWeight(ex.weight, unit, old, next);
    const wc = currentWeightColumn(ex);
    if (wc) ex.logs.forEach(log => {
      if (Store.parseWeightNumber(log.values?.[wc.key]) !== null)
        log.values[wc.key] = Store.convertPulleyWeight(log.values[wc.key], unit, old, next);
    });
    ex.pulleySystem = next;
  }

  // details panel

  function renderExerciseMeta(ex) { /* no-op */ }

  function repsRangeParts(reps) {
    const m = String(reps || "").match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (m) return [m[1], m[2]];
    const single = String(reps || "").match(/\d+(?:\.\d+)?/);
    return single ? [single[0], ""] : ["", ""];
  }

  function repsRangeValue() {
    const min = $("detailRepsMin").value.trim();
    const max = $("detailRepsMax").value.trim();
    if (min && max) return `${min}-${max}`;
    return min || max || "";
  }

  async function openDetails(exId) {
    currentExerciseId = exId;
    const ex = exercise();
    if (!ex) return;

    $("modalExerciseTitle").textContent = ex.name;
    renderExerciseMeta(ex);

    $("detailName").value = ex.name;
    $("detailWeight").value = numericWeightText(ex.weight);
    $("detailWeightUnit").value = Store.normalizeWeightUnit(ex.weightUnit || "kg");
    $("detailPulleySystem").value = Store.pulleyKey(ex.pulleySystem || "single");
    const [repsMin, repsMax] = repsRangeParts(ex.reps);
    $("detailRepsMin").value = repsMin;
    $("detailRepsMax").value = repsMax;
    $("detailTempo").value = ex.details.tempo || "";
    $("detailEquipment").value = ex.details.equipment || "";
    $("detailNotes").value = ex.details.notes || "";
    $("detailCues").value = (ex.details.cues || []).join("\n");
    // Auto-fill image/video paths from exercise name if they're empty
    const currentImage = normalizeImagePath(ex.image);
    const currentVideo = normalizeVideoPath(ex.video);
    $("detailImagePath").value = currentImage || imagePathFromName(ex.name);
    $("detailImagePath").placeholder = imagePathFromName(ex.name) || "e.g. images/bench_press.jpg";
    $("detailVideoPath").value = currentVideo || videoPathFromName(ex.name);
    $("detailVideoPath").placeholder = videoPathFromName(ex.name) || "e.g. videos/bench_press.mp4";

    const firstTimerSet = nextRecordableRow(ex);
    timerSetIndex = firstTimerSet?.index || 0;
    timerSetId = firstTimerSet?.row?.id || ex.logs?.[0]?.id || null;
    timerSeconds = 0;
    timerElapsedGross = 0;
    timerMode = "idle";
    timerRunning = false;
    timerStartedAt = null;
    clearInterval(timerId);
    renderSetTable();
    renderSetTimer(ex);
    renderTimer();
    await renderDetailMedia(ex);
    renderIntensity(day());
    UI.openModal("exerciseModal");
  }

  function closeDetails() {
    clearInterval(timerId);
    timerRunning = false;
    timerStartedAt = null;
    const vid = $("detailVideo");
    if (vid) { vid.pause(); }
    UI.closeModal("exerciseModal");
    currentExerciseId = null;
  }

  async function renderDetailMedia(ex) {
    const img = $("detailImage"), vid = $("detailVideo"), fall = $("detailMediaFallback");
    img.hidden = true; vid.hidden = true; fall.hidden = false;
    img.removeAttribute("src");
    vid.removeAttribute("src");

    const [iSrc, vSrc] = await Promise.all([mediaSrc(ex, "image"), mediaSrc(ex, "video")]);
    if (vSrc) {
      vid.src = vSrc;
      vid.muted = true;              // demo clips are always silent, by design
      vid.hidden = false;
      fall.hidden = true;
      vid.onvolumechange = () => { if (!vid.muted) vid.muted = true; };
      img.hidden = true;
      img.classList.remove("as-secondary");
    } else if (iSrc) {
      img.src = iSrc;
      img.hidden = false;
      fall.hidden = true;
      img.onerror = () => {
        img.hidden = true;
        if (vid.hidden) fall.hidden = false;
      };
      img.classList.remove("as-secondary");
    }
  }

  // --- the custom set table: rows AND columns are both user-defined --------




  function renderSetTable() {
    const ex = exercise();
    const wrap = $("detailSetTable");
    if (!ex || !wrap) return;

    const cols = ex.setColumns;
    const todayRows = Store.currentSessionRows(ex);
    const rows = todayRows.length ? todayRows : ex.logs.slice(0, 1);
    const timeCol = timeColumn(ex);

    // Build RIR previous data from previous session
    const prevRows = Store.previousSessionRows(ex);

    wrap.innerHTML = `
      <div class="set-table-wrap-inner">
        <table class="set-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-done"></th>
              ${cols.map(c => `<th>${esc(c.label)}</th>`).join("")}
              <th>RIR</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => {
      const rowIndex = ex.logs.findIndex(x => x.id === row.id);
      const prevRir = prevRows[i]?.rir ?? prevRows[i]?.values?.rir ?? "";
      return `<tr class="${row.completed ? "completed" : ""}">
                <td class="col-num">${i + 1}</td>
                <td class="col-done">
                  <button class="mini-check ${row.completed ? "checked" : ""}" data-row-done="${rowIndex}" aria-label="Set ${i + 1} done">${row.completed ? "✓" : ""}</button>
                </td>
                ${cols.map(c => {
        const isTime = c.key === timeCol?.key;
        const type = /weight/i.test(c.label || "") ? 'type="number" step="0.01" inputmode="decimal"' : /rep/i.test(c.label || "") ? 'type="number" step="1" inputmode="numeric"' : '';
        return `<td><input ${type} class="${isTime ? "time-cell" : ""}" value="${esc(row.values?.[c.key] ?? "")}" data-cell-row="${rowIndex}" data-cell-key="${esc(c.key)}" ${isTime ? `data-time-row="${rowIndex}"` : ""} placeholder="${esc(c.label)}" aria-label="${esc(c.label)} set ${i + 1}"></td>`;
      }).join("")}
                <td><input type="number" step="0.5" min="0" inputmode="decimal" value="${esc(row.rir ?? "")}" data-rir-row="${rowIndex}" placeholder="RIR" aria-label="RIR set ${i + 1}"></td>
                <td class="col-actions">
                  <button class="table-action" data-row-dup="${rowIndex}" title="Duplicate set">⧉</button>
                  <button class="table-action danger" data-row-remove="${rowIndex}" title="Remove set" ${rows.length <= 1 ? "disabled" : ""}>×</button>
                </td>
              </tr>`;
    }).join("")}
          </tbody>
        </table>
      </div>`;

    wrap.querySelectorAll("[data-cell-row]").forEach(inp => {
      // Editing the Time column never selects a timer set. The timer always targets
      // the first incomplete set, so there is no hidden/manual set-selection mode.
      inp.oninput = () => {
        const r = +inp.dataset.cellRow;
        if (!ex.logs[r]) return;
        ex.logs[r].values[inp.dataset.cellKey] = inp.value;
        // A row can still carry an older date (from a previous session, or from
        // Fill Down/duplication). currentSessionRows() — and therefore both the
        // editable "Current" section and the Recorded total — only include rows
        // dated today, so an edit that doesn't restamp the date silently lands
        // on a row that's invisible to both.
        if (Store.dateKey(ex.logs[r].date) !== Store.todayKey()) {
          ex.logs[r].date = new Date().toISOString();
        }
        save({ silent: true });
        renderIntensity(day());
        renderSetTimer(ex);
      };
      inp.onchange = () => save({ silent: true });
    });

    wrap.querySelectorAll("[data-rir-row]").forEach(inp => {
      inp.oninput = () => {
        const r = +inp.dataset.rirRow;
        if (!ex.logs[r]) return;
        ex.logs[r].rir = inp.value;
        if (Store.dateKey(ex.logs[r].date) !== Store.todayKey()) {
          ex.logs[r].date = new Date().toISOString();
        }
        save({ silent: true });
        renderIntensity(day());
      };
      inp.onchange = () => save({ silent: true });
    });

    wrap.querySelectorAll("[data-row-done]").forEach(btn => {
      btn.onclick = () => {
        const row = ex.logs[+btn.dataset.rowDone];
        if (!row) return;
        row.completed = !row.completed;
        row.date = row.completed ? new Date().toISOString() : "";
        if (row.completed) {
          clearInterval(timerId);
          timerRunning = false;
          timerStartedAt = null;
          setTimerToNextIncomplete(ex);
        } else {
          timerSetId = row.id;
          timerSetIndex = ex.logs.findIndex(x => x.id === row.id);
          timerElapsedGross = 0;
          timerSeconds = 0;
          timerMode = "idle";
        }
        save();
        renderSetTable();
        renderSetTimer(ex);
        renderToday();
        renderIntensity(day());
      };
    });

    wrap.querySelectorAll("[data-row-dup]").forEach(btn => {
      btn.onclick = () => {
        if (Store.duplicateRow(ex, +btn.dataset.rowDup)) {
          syncSets(ex); save(); renderSetTable(); renderSetTimer(ex); renderToday(); renderIntensity(day());
        }
      };
    });

    wrap.querySelectorAll("[data-row-remove]").forEach(btn => {
      btn.onclick = () => {
        if (Store.removeRow(ex, +btn.dataset.rowRemove)) {
          syncSets(ex); timerSetIndex = Math.max(0, Math.min(timerSetIndex, ex.logs.length - 1)); save(); renderSetTable(); renderSetTimer(ex); renderToday(); renderIntensity(day());
        }
      };
    });

    wrap.querySelectorAll("[data-col-label]").forEach(inp => {
      inp.onchange = () => {
        const i = +inp.dataset.colLabel;
        if (ex.setColumns[i]) {
          const oldKey = ex.setColumns[i].key;
          const newLabel = inp.value.trim() || ex.setColumns[i].label;
          if (/^rir$/i.test(newLabel)) {
            ex.setColumns[i].key = "time";
            ex.setColumns[i].label = "Time";
            ex.logs.forEach(log => { const legacy = log.values?.[oldKey]; delete log.values[oldKey]; log.values.time ??= /^\d{1,3}:\d{2}(?::\d{2})?$/.test(String(legacy || "")) ? legacy : ""; });
          } else {
            ex.setColumns[i].label = newLabel;
          }
          save(); renderSetTable(); renderSetTimer(ex); renderIntensity(day());
        }
      };
    });

    wrap.querySelectorAll("[data-col-left]").forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.colLeft;
        if (i > 0) { [ex.setColumns[i - 1], ex.setColumns[i]] = [ex.setColumns[i], ex.setColumns[i - 1]]; save(); renderSetTable(); renderSetTimer(ex); }
      };
    });
    wrap.querySelectorAll("[data-col-right]").forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.colRight;
        if (i < ex.setColumns.length - 1) { [ex.setColumns[i + 1], ex.setColumns[i]] = [ex.setColumns[i], ex.setColumns[i + 1]]; save(); renderSetTable(); renderSetTimer(ex); }
      };
    });
    wrap.querySelectorAll("[data-col-remove]").forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.colRemove;
        if (ex.setColumns.length <= 1) return UI.toast("Keep at least one column.", "error");
        if (ex.setColumns[i]?.key === "time") return UI.toast("Time is required for the set timer.", "error");
        ex.setColumns.splice(i, 1);
        ex.logs.forEach(log => { if (log.values) delete log.values[cols[i]?.key]; });
        save(); renderSetTable(); renderSetTimer(ex);
      };
    });

    $("setCountLabel").textContent = `${rows.length} sets · ${cols.length} columns`;
    renderSetTimer(ex);
  }

  // `sets` is derived from the row count.
  function syncSets(ex) { ex.sets = ex.logs.length; }

  function addSetRow() {
    const ex = exercise(); if (!ex) return;
    Store.addRow(ex); syncSets(ex); save(); renderSetTable(); renderToday();
  }

  async function addSetColumn() {
    const ex = exercise(); if (!ex) return;
    const presets = (window.COLUMN_PRESETS || []).filter(p => !ex.setColumns.some(c => c.key === p.key));
    const res = await UI.dialog({
      title: "Add set column",
      body: "Pick a common one or type your own name.",
      confirmLabel: "Add column",
      fields: [
        {
          name: "preset", label: "Preset", type: "select",
          options: [{ value: "", label: "— custom name —" }, ...presets.map(p => ({ value: p.label, label: p.label }))]
        },
        { name: "custom", label: "Custom name", placeholder: "e.g. Band tension" }
      ]
    });
    if (!res) return;
    const label = (res.custom || res.preset || "").trim();
    if (!label) { UI.toast("Give the column a name.", "error"); return; }
    Store.addColumn(ex, label);
    save();
    renderSetTable();
    UI.toast(`Added "${label}"`);
  }

  async function fillDownSets() {
    const ex = exercise(); if (!ex || ex.logs.length < 2) return;
    if (!await UI.confirm("Copy set 1 to every set?", "Overwrites the other rows' values.", { confirmLabel: "Copy", danger: false })) return;
    Store.fillDown(ex, 0); save(); renderSetTable(); UI.toast("Copied down");
  }

  async function applyColumnsToDay() {
    const ex = exercise(), d = day();
    if (!ex || !d) return;
    if (!await UI.confirm(`Use these ${ex.setColumns.length} columns for all of ${d.name}?`,
      "Other exercises keep values whose column names match.", { confirmLabel: "Apply", danger: false })) return;
    Store.applyColumnsToDay(d, ex.setColumns);
    save();
    UI.toast("Columns applied to the whole day");
  }

  function saveDetails() {
    const ex = exercise(); if (!ex) return;
    ex.name = $("detailName").value.trim() || "Exercise";
    ex.weight = $("detailWeight").value.trim();
    ex.weightUnit = Store.normalizeWeightUnit($("detailWeightUnit").value);
    ex.pulleySystem = Store.pulleyKey($("detailPulleySystem").value);
    ex.reps = repsRangeValue();
    ex.details.tempo = $("detailTempo").value.trim();
    ex.details.equipment = $("detailEquipment").value.trim();
    ex.details.notes = $("detailNotes").value.trim();
    ex.details.cues = $("detailCues").value.split("\n").map(s => s.trim()).filter(Boolean);
    // Auto-fill empty paths from the exercise name before saving
    let imgPath = $("detailImagePath").value.trim();
    let vidPath = $("detailVideoPath").value.trim();
    if (!imgPath) imgPath = imagePathFromName(ex.name);
    if (!vidPath) vidPath = videoPathFromName(ex.name);
    ex.image = normalizeImagePath(imgPath);
    ex.video = normalizeVideoPath(vidPath);
    syncSets(ex);
    save();
    $("modalExerciseTitle").textContent = ex.name;
    renderExerciseMeta(ex);
    renderToday();
    window.Manage?.render();
    UI.toast("Details saved");
  }

  async function deleteCurrentExercise() {
    const ex = exercise(), d = day();
    if (!ex || !d) return;
    if (!await UI.confirm(`Delete "${ex.name}"?`, "Its set log and uploaded media go too.")) return;
    MediaStore.deleteImage(project().id, ex.id);
    MediaStore.deleteVideo(project().id, ex.id);
    d.exercises.splice(d.exercises.findIndex(e => e.id === ex.id), 1);
    save();
    closeDetails();
    renderToday();
    window.Manage?.render();
    UI.toast("Exercise deleted");
  }

  function addExercise() {
    const d = day();
    if (!d) { UI.toast("Add a day first.", "error"); return; }
    if (d.type !== "workout") { UI.toast("This is a rest day — switch it to Workout in Manage.", "error"); return; }
    const ex = Store.newExercise();
    d.exercises.push(ex);
    save();
    renderToday();
    window.Manage?.render();
    openDetails(ex.id);
  }

  async function createDay() {
    const res = await UI.dialog({
      title: "Add a day",
      body: "Days are just an ordered list — name them anything.",
      confirmLabel: "Add day",
      fields: [
        { name: "name", label: "Day name", placeholder: "e.g. Monday, Upper A, Day 1" },
        {
          name: "type", label: "Type", type: "select", value: "workout",
          options: [{ value: "workout", label: "Workout day" }, { value: "rest", label: "Rest day" }]
        },
        {
          name: "category", label: "Split / Icon", type: "select", value: "push",
          options: [
            { value: "push", label: "Push Day" },
            { value: "pull", label: "Pull Day" },
            { value: "leg", label: "Leg Day" },
            { value: "other", label: "Other / Cardio / Arms" }
          ]
        },
        { name: "title", label: "Title", placeholder: "e.g. Push A / Pull A / Legs A" }
      ]
    });
    if (!res) return;
    if (!res.name) { UI.toast("Give the day a name.", "error"); return; }
    const p = project();
    const cat = res.type === "rest" ? "rest" : (res.category || "push");
    const fallbackTitle = res.type === "rest" ? "Rest Day" : (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "Workout");
    const d = Store.newDay({
      name: res.name,
      type: res.type,
      category: cat,
      title: res.title || fallbackTitle
    });
    if (d.type === "workout") d.exercises.push(Store.newExercise({ name: "Exercise 1" }));
    p.days.push(d);
    currentDayId = d.id;
    save();
    renderAll();
    UI.toast(`Added ${d.name}`);
  }

  // media uploads

  // Checks whether a static file exists on disk at the given relative path.
  // Used to detect pre-existing videos/images before uploading a replacement.
  async function fileExistsOnDisk(relativePath) {
    try {
      const resp = await fetch(relativePath, { method: "HEAD" });
      return resp.ok;
    } catch { return false; }
  }

  function wireUpload(inputId, kind) {
    $(inputId)?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      const ex = exercise();
      e.target.value = "";
      if (!file || !ex) return;
      if (!file.type.startsWith(kind === "video" ? "video/" : "image/")) {
        UI.toast(`That's not a ${kind} file.`, "error");
        return;
      }

      // Derive the expected filename from the exercise name
      const exName = $("detailName")?.value.trim() || ex.name;
      const slug = slugFromName(exName);
      const ext = kind === "video" ? ".mp4" : ("." + (file.name.split(".").pop() || "jpg"));
      const autoFileName = slug ? `${slug}${ext}` : file.name;
      const autoPath = kind === "video" ? `videos/${autoFileName}` : `images/${autoFileName}`;

      // Check for existing file on disk
      const existsOnDisk = await fileExistsOnDisk(autoPath);
      // Check for existing blob in IndexedDB (per-exercise or shared by slug)
      let existsInDB = false;
      try {
        const hasProjMedia = kind === "video"
          ? await MediaStore.hasMedia(project().id, ex.id, "video")
          : await MediaStore.hasMedia(project().id, ex.id, "image");
        const hasSlugMedia = slug && MediaStore.hasMediaBySlug
          ? await MediaStore.hasMediaBySlug(slug, kind)
          : false;
        existsInDB = hasProjMedia || hasSlugMedia;
      } catch { /* IndexedDB unavailable */ }

      if (existsOnDisk || existsInDB) {
        const where = existsOnDisk ? "on disk" : "in storage";
        const ok = await UI.confirm(
          `${kind === "video" ? "Video" : "Image"} already exists`,
          `A file for "${autoFileName}" already exists ${where}. Do you want to replace it?`,
          { confirmLabel: "Replace", danger: true }
        );
        if (!ok) return;
      }

      try {
        // Rename the uploaded file to match the exercise name slug
        const renamedFile = new File([file], autoFileName, { type: file.type });
        if (kind === "video") {
          await MediaStore.saveVideo(project().id, ex.id, renamedFile);
          if (slug && MediaStore.saveMediaBySlug) await MediaStore.saveMediaBySlug(slug, "video", renamedFile);
        } else {
          await MediaStore.saveImage(project().id, ex.id, renamedFile);
          if (slug && MediaStore.saveMediaBySlug) await MediaStore.saveMediaBySlug(slug, "image", renamedFile);
        }

        // Auto-update the path field and the exercise data
        const pathInput = kind === "video" ? $("detailVideoPath") : $("detailImagePath");
        if (pathInput) pathInput.value = autoPath;
        if (kind === "video") ex.video = autoPath;
        else ex.image = autoPath;
        save({ silent: true });

        await renderDetailMedia(ex);
        renderIntensity(day());
        renderToday();
        window.Manage?.render();
        UI.toast(`${kind === "video" ? "Video" : "Image"} saved as "${autoFileName}"`);
      } catch (err) {
        console.error(err);
        UI.toast("Could not store that file.", "error");
      }
    });
  }

  async function removeMedia() {
    const ex = exercise(); if (!ex) return;
    if (!await UI.confirm("Remove media for this exercise?", "Deletes the uploaded image and video.")) return;
    const slug = slugFromName(ex.name);
    await Promise.all([
      MediaStore.deleteImage(project().id, ex.id),
      MediaStore.deleteVideo(project().id, ex.id),
      slug && MediaStore.deleteMediaBySlug ? MediaStore.deleteMediaBySlug(slug, "image") : Promise.resolve(),
      slug && MediaStore.deleteMediaBySlug ? MediaStore.deleteMediaBySlug(slug, "video") : Promise.resolve()
    ]);
    ex.image = ""; ex.video = "";
    save();
    await renderDetailMedia(ex);
    renderToday();
    UI.toast("Media removed");
  }


  function renderCardioSummary(d) {
    const el = $("cardioSummary");
    if (!el) return;
    const entries = d?.cardio || [];
    if (!entries.length) {
      el.textContent = "Not counted";
      return;
    }
    const meaningful = entries.map(e => {
      const parts = [];
      if (e.type) parts.push(e.type);
      if (e.duration) parts.push(`${e.duration}`);
      if (e.calories) parts.push(`${e.calories} kcal`);
      if (e.incline) parts.push(`incline ${e.incline}`);
      if (e.speed) parts.push(`speed ${e.speed}`);
      if (e.gear) parts.push(`gear ${e.gear}`);
      return parts.join(" · ");
    }).filter(Boolean);
    el.textContent = meaningful.length ? meaningful.join(" | ") : "Not counted";
  }

  function cardioFields(entry) {
    const type = (entry.type || "").toLowerCase();
    const treadmill = type.includes("treadmill") || type.includes("walk") || type.includes("run");
    const cycling = type.includes("cycle") || type.includes("bike");
    return `
      <div class="cardio-entry-head">
        <input data-cardio="type" value="${esc(entry.type || "")}" placeholder="Treadmill / Cycling / Other">
        <button class="table-action danger" data-cardio-remove>×</button>
      </div>
      <div class="cardio-entry-grid">
        <label>Duration<input data-cardio="duration" value="${esc(entry.duration || "")}" placeholder="e.g. 20 min"></label>
        <label>Calories burned<input data-cardio="calories" value="${esc(entry.calories || "")}" placeholder="e.g. 180 kcal"></label>
        ${treadmill ? `<label>Incline<input data-cardio="incline" value="${esc(entry.incline || "")}" placeholder="e.g. 8%"></label>` : `<label>Incline<input data-cardio="incline" value="${esc(entry.incline || "")}" placeholder="optional"></label>`}
        ${treadmill ? `<label>Speed<input data-cardio="speed" value="${esc(entry.speed || "")}" placeholder="e.g. 5.5 km/h"></label>` : `<label>Speed<input data-cardio="speed" value="${esc(entry.speed || "")}" placeholder="optional"></label>`}
        ${cycling ? `<label>Gear<input data-cardio="gear" value="${esc(entry.gear || "")}" placeholder="e.g. 7"></label>` : `<label>Gear<input data-cardio="gear" value="${esc(entry.gear || "")}" placeholder="optional"></label>`}
        <label class="span-2">Notes<input data-cardio="notes" value="${esc(entry.notes || "")}" placeholder="Optional notes"></label>
      </div>`;
  }

  function openCardio() {
    const d = day(); if (!d || d.type !== "workout") return;
    cardioDraft = JSON.parse(JSON.stringify(d.cardio || []));
    $("cardioDayTitle").textContent = `${d.name} · Cardio`;
    renderCardioEntries();
    UI.openModal("cardioModal");
  }

  function renderCardioEntries() {
    const box = $("cardioEntries");
    if (!cardioDraft.length) {
      box.innerHTML = `<div class="empty-state">No cardio recorded. Add an entry if you performed conditioning.</div>`;
      return;
    }
    box.innerHTML = cardioDraft.map((entry, i) => `<article class="cardio-entry" data-cardio-index="${i}">${cardioFields(entry)}</article>`).join("");
    box.querySelectorAll(".cardio-entry").forEach(card => {
      const i = +card.dataset.cardioIndex, entry = cardioDraft[i];
      card.querySelectorAll("[data-cardio]").forEach(inp => {
        inp.oninput = () => { entry[inp.dataset.cardio] = inp.value; };
        inp.onchange = () => { entry.date ||= new Date().toISOString(); };
      });
      card.querySelector("[data-cardio-remove]").onclick = () => {
        cardioDraft.splice(i, 1); renderCardioEntries();
      };
    });
  }

  function addCardioEntry() {
    cardioDraft.push(Store.newCardioEntry({ date: new Date().toISOString() }));
    renderCardioEntries();
  }

  function saveCardio() {
    const d = day(); if (!d) return;
    d.cardio = JSON.parse(JSON.stringify(cardioDraft)).map(e => ({ ...e, date: e.date || new Date().toISOString() }));
    save();
    renderCardioSummary(d);
    UI.closeModal("cardioModal");
    UI.toast("Cardio saved");
  }



  // The Home export card scopes every pipeline download the same way the AI view
  // does: one checkbox, honoured by all four buttons.
  const exportOptions = () => ({ allProjects: $("homeExportAll")?.checked === true });

  function renderArchivedCSVs() {
    const box = $("archivedCsvList");
    if (!box || !Store.allArchivedCSVs) return;

    // Reads through Store instead of hard-coding the localStorage key, so the
    // storage layer stays the only place that knows the key's name.
    const all = Store.allArchivedCSVs();
    const files = all
      .filter(f => f.projectId === project().id)
      .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));

    if (!files.length) {
      box.innerHTML = `<div class="empty">-</div>`;
      return;
    }

    box.innerHTML = files.map(f => `
      <div class="archive-row">
        <span><b>${esc(f.dayName)}</b><small>${esc(f.weekStart)}</small></span>
        <button class="btn" data-archive-key="${esc(f.key)}">CSV</button>
      </div>`).join("");

    const byKey = Object.fromEntries(files.map(f => [f.key, f]));
    box.querySelectorAll("[data-archive-key]").forEach(btn => {
      btn.onclick = () => {
        const obj = byKey[btn.dataset.archiveKey];
        if (!obj) return;
        const projectSlug = project().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
        const daySlug = String(obj.dayName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "day";
        UI.download(
          `gymcoach-${projectSlug}-${daySlug}-${obj.weekStart}.csv`,
          obj.csv,
          "text/csv;charset=utf-8"
        );
      };
    });
  }

  // timer

  function timerCountdownValue() {
    const n = Number($("timerCountdown")?.value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 30;
  }
  function timerBalanceValue() {
    const n = Number($("timerBalance")?.value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 5;
  }
  function calculatedRecordedSeconds() {
    // The recorded time is the FULL time on the clock (countdown phase +
    // any extra time), plus the delay balance on top — e.g. a 30s countdown
    // + 10s extra + a 5s balance must record 45s.
    return Math.max(0, timerElapsedGross + timerBalanceSeconds);
  }

  function renderTimer() {
    const display = $("timer"), phase = $("timerPhase"), preview = $("timerRecordedPreview");
    if (!display) return;

    display.classList.remove("timer-countdown-green", "timer-countdown-yellow", "timer-countdown-red", "timer-extra-white");
    if (timerRunning && timerElapsedGross < timerTargetSeconds) {
      timerMode = "countdown";
      const remaining = timerTargetSeconds - timerElapsedGross;
      if (display) display.textContent = formatTime(remaining);
      if (phase) phase.textContent = "Countdown";
      display.classList.add(
        remaining <= 5 ? "timer-countdown-red" :
          remaining <= 15 ? "timer-countdown-yellow" : "timer-countdown-green"
      );
    } else if (timerRunning) {
      timerMode = "extra";
      timerSeconds = Math.max(0, timerElapsedGross - timerTargetSeconds);
      display.textContent = `+${formatTime(timerSeconds)}`;
      if (phase) phase.textContent = "Extra time";
      display.classList.add("timer-extra-white");
    } else if (timerMode === "extra") {
      display.textContent = `+${formatTime(timerSeconds)}`;
      if (phase) phase.textContent = "Extra time";
      display.classList.add("timer-extra-white");
    } else if (timerMode === "countdown" && timerElapsedGross > 0) {
      const remaining = Math.max(0, timerTargetSeconds - timerElapsedGross);
      display.textContent = formatTime(remaining);
      if (phase) phase.textContent = "Paused";
      display.classList.add(
        remaining <= 5 ? "timer-countdown-red" :
          remaining <= 15 ? "timer-countdown-yellow" : "timer-countdown-green"
      );
    } else {
      // Ready state shows the configured countdown so the user can see what will start.
      timerTargetSeconds = timerCountdownValue();
      timerBalanceSeconds = timerBalanceValue();
      display.textContent = formatTime(timerTargetSeconds);
      if (phase) phase.textContent = "Ready";
      display.classList.add(
        timerTargetSeconds <= 5 ? "timer-countdown-red" :
          timerTargetSeconds <= 15 ? "timer-countdown-yellow" :
            "timer-countdown-green"
      );
    }

    if (preview) preview.textContent = formatTime(calculatedRecordedSeconds());
    const button = $("timerButton");
    if (button) button.textContent = timerRunning ? "Pause" : (timerElapsedGross > 0 ? "Resume" : "Start");

    const ex = exercise(), rows = ex ? Store.currentSessionRows(ex) : [];
    const row = timerSetId ? rows.find(r => r.id === timerSetId) : rows[timerSetIndex];
    const label = $("timerRecordingSet");
    if (row && label) {
      const index = rows.findIndex(r => r.id === row.id);
      label.textContent = `Set ${index + 1}`;
    }
  }

  function tickSetTimer() {
    if (!timerStartedAt || !timerRunning) return;
    timerElapsedGross = Math.max(0, Math.floor((Date.now() - timerStartedAt) / 1000));
    renderTimer();
  }

  function setTimerToNextIncomplete(ex) {
    const next = nextRecordableRow(ex);
    if (!next) {
      timerSetId = null;
      timerSetIndex = 0;
      return false;
    }
    timerSetIndex = next.index;
    timerSetId = next.row.id;
    timerElapsedGross = 0;
    timerSeconds = 0;
    timerMode = "idle";
    return true;
  }

  function toggleTimer() {
    const ex = exercise();
    if (!ex) return;
    if (timerRunning) {
      clearInterval(timerId);
      timerRunning = false;
      timerStartedAt = null;
      renderTimer();
      return;
    }

    // Never ask the user to choose a set. The timer always targets the next incomplete set.
    const next = nextRecordableRow(ex);
    if (!next) {
      UI.toast("All sets are already completed.", "info");
      return;
    }
    timerSetIndex = next.index;
    timerSetId = next.row.id;
    timerTargetSeconds = timerCountdownValue();
    timerBalanceSeconds = timerBalanceValue();
    timerStartedAt = Date.now() - timerElapsedGross * 1000;
    timerRunning = true;
    clearInterval(timerId);
    timerId = setInterval(tickSetTimer, 200);
    tickSetTimer();
  }

  // Writes the timer run into ex.restStats.
  //   plannedSec  - the countdown the user configured for this run
  //   extraSec    - time on the clock past the countdown
  //   balanceSec  - the delay balance added on top
  //   totalSec    - the sum actually recorded against the sets
  function recordRestInterval(ex, { setId, plannedSec, grossSec, balanceSec, recordedSec, at }) {
    ex.restStats ||= { plannedSec: 0, extraSec: 0, balanceSec: 0, defaultDelaySec: 0, totalSec: 0, intervals: [] };
    const extra = Math.max(0, grossSec - plannedSec);
    ex.restStats.plannedSec = (Number(ex.restStats.plannedSec) || 0) + plannedSec;
    ex.restStats.extraSec = (Number(ex.restStats.extraSec) || 0) + extra;
    ex.restStats.balanceSec = (Number(ex.restStats.balanceSec) || 0) + balanceSec;
    ex.restStats.defaultDelaySec = balanceSec;
    ex.restStats.totalSec = (Number(ex.restStats.totalSec) || 0) + recordedSec;
    ex.restStats.intervals.push({ setId, plannedSec, grossSec, extraSec: extra, balanceSec, recordedSec, at });
    if (ex.restStats.intervals.length > 200) ex.restStats.intervals = ex.restStats.intervals.slice(-200);
  }

  function stopTimer() {
    const ex = exercise();
    if (!ex || timerElapsedGross <= 0) return;
    if (timerRunning) tickSetTimer();
    clearInterval(timerId);
    timerRunning = false;
    timerStartedAt = null;
    // Keep the exact countdown and balance values used for this run. Editing the
    // inputs after starting must not change the calculation for the set being recorded.
    const recordedSeconds = calculatedRecordedSeconds();
    const recordedAt = new Date().toISOString();
    const grossSeconds = timerElapsedGross;
    const plannedSeconds = timerTargetSeconds;
    const balanceSeconds = timerBalanceSeconds;
    const recordedSetId = timerSetId;
    updateSelectedSetTime(ex, recordedSeconds, recordedAt);

    // Stop & record must mark the set as done, otherwise "next incomplete set"
    // keeps finding this same set and the timer never advances.
    const rowIndex = ex.logs.findIndex(x => x.id === recordedSetId);
    if (rowIndex >= 0) {
      ex.logs[rowIndex].completed = true;
      ex.logs[rowIndex].date = recordedAt;
      recordRestInterval(ex, {
        setId: recordedSetId,
        plannedSec: plannedSeconds,
        grossSec: grossSeconds,
        balanceSec: balanceSeconds,
        recordedSec: recordedSeconds,
        at: recordedAt
      });
      save({ silent: true });
      renderSetTable();
      renderToday();
      renderIntensity(day());
    }

    // Recording a set advances directly to the next incomplete set.
    const advanced = setTimerToNextIncomplete(ex);
    timerMode = "idle";
    timerSeconds = 0;
    timerElapsedGross = 0;
    timerTargetSeconds = timerCountdownValue();
    timerBalanceSeconds = timerBalanceValue();
    renderSetTimer(ex);
    renderTimer();
    if (!advanced) UI.toast("All sets recorded for this exercise.", "info");
  }

  function resetTimer() {
    clearInterval(timerId);
    timerRunning = false;
    timerStartedAt = null;
    timerElapsedGross = 0;
    timerSeconds = 0;
    timerMode = "idle";
    const ex = exercise();
    if (ex) setTimerToNextIncomplete(ex);
    renderTimer();
  }

  // progress
  // These ids live inside #homeView.

  function renderProgress() {
    const p = project();
    const prog = Store.projectProgress(p);
    if ($("weekPercent")) $("weekPercent").textContent = `${prog.pct}%`;
    if ($("progressSub")) $("progressSub").textContent = `${prog.done} of ${prog.total} exercises completed`;

    const bars = $("barChart");
    if (bars) {
      bars.innerHTML = "";
      const workoutDays = p.days.filter(d => d.type === "workout");
      if (!workoutDays.length) {
        bars.innerHTML = `<div class="empty">No workout days in this project.</div>`;
      } else {
        workoutDays.forEach(d => {
          const dp = Store.dayProgress(d);
          const item = document.createElement("div");
          item.className = "bar-day";
          item.title = `${d.name}: ${dp.done}/${dp.total}`;
          item.innerHTML = `<div class="bar ${dp.pct === 100 ? "complete" : ""}" style="height:${Math.max(4, Math.round(dp.pct * 0.9))}%"></div>
            <div class="bar-label">${esc(d.name.slice(0, 3))}</div>`;
          bars.appendChild(item);
        });
        bars.style.gridTemplateColumns = `repeat(${workoutDays.length}, 1fr)`;
      }
    }

    const prof = Store.profile();
    if ($("pWeight")) $("pWeight").value = prof.current.weight || "";
    if ($("pWaist")) $("pWaist").value = prof.current.waist || "";
    if ($("pChest")) $("pChest").value = prof.current.chest || "";
    if ($("pArm")) $("pArm").value = prof.current.arm || "";
    if ($("profileStamp")) $("profileStamp").textContent = prof.current.date ? `Last saved ${UI.fmtDate(prof.current.date, { month: "short", day: "numeric", year: "numeric" })}` : "Not recorded yet";

    const previous = prof.history?.[1] || null;
    if ($("previousProfileDate")) $("previousProfileDate").textContent = previous?.date ? UI.fmtDate(previous.date, { month: "short", day: "numeric", year: "numeric" }) : "- record";
    if ($("previousProfileValues")) $("previousProfileValues").innerHTML = previous
      ? `<span>Weight ${esc(previous.weight || "—")} kg</span><span>Waist ${esc(previous.waist || "—")} cm</span><span>Chest ${esc(previous.chest || "—")} cm</span><span>Arm ${esc(previous.arm || "—")} cm</span>`
      : `<span>Weight —</span><span>Waist —</span><span>Chest —</span><span>Arm —</span>`;
    if ($("projectIntensityProgress")) $("projectIntensityProgress").innerHTML = intensityMarkup(Store.projectIntensity(p), "Workout Intensity");

    // Recent set-level history, newest first.
    const rows = [];
    p.days.forEach(d => d.exercises.forEach(ex => ex.logs.forEach((log, i) => {
      const values = ex.setColumns
        .map(c => (log.values[c.key] ?? "").toString().trim() ? `${c.label} ${log.values[c.key]}` : null)
        .filter(Boolean).join(" · ");
      if (!values && !log.completed) return;
      rows.push({ day: d.name, ex: ex.name, set: i + 1, date: log.date, values, notes: log.notes, completed: log.completed, rir: log.rir });
    })));
    rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    if ($("historyList")) $("historyList").innerHTML = rows.length
      ? rows.slice(0, 40).map(h => `<div class="history-row">
            <span class="history-main">
              <b>${esc(h.ex)}</b> <small>set ${h.set}</small>
              <small class="history-meta">${esc(h.day)}${h.date ? ` · ${UI.fmtDate(h.date)}` : ""}</small>
            </span>
            <span class="history-values">${esc(h.values || "no values")}${h.rir !== "" && h.rir !== undefined && h.rir !== null ? ` · RIR ${esc(h.rir)}` : ""}${h.completed ? ' <span class="tick">✓</span>' : ""}</span>
          </div>`).join("")
      : `<div class="empty">No sets logged yet. Open an exercise and fill in the set table.</div>`;
  }

  function saveProfile() {
    Store.saveProfile({
      weight: $("pWeight")?.value.trim() || "",
      waist: $("pWaist")?.value.trim() || "",
      chest: $("pChest")?.value.trim() || "",
      arm: $("pArm")?.value.trim() || ""
    });
    renderProgress();
    // The body-weight forecast and the "Body-weight trend" signal both read the
    // profile, so Home has to repaint or it shows the pre-save numbers.
    window.Home?.render?.();
    UI.toast("Weekly check saved");
  }

  async function resetDay() {
    const d = day();
    if (!d || d.type !== "workout") return;
    if (!await UI.confirm(`Clear all logged sets on ${d.name}?`, "Targets and columns stay; logged values and ticks are cleared.")) return;
    Store.resetDayLogs(d);
    save();
    renderToday();
    window.ReportCoach?.render();
    UI.toast("Day cleared");
  }

  // wiring

  function renderAll() {
    renderProjectNav();
    renderDayNav();
    renderToday();
    window.Manage?.render();
    renderProgress();
    window.Home?.render?.();
    window.ReportCoach?.render();
    renderArchivedCSVs();
  }

  const ACTIONS = {
    "toggle-drawer": () => UI.toggleDrawer(),
    // The brand icon+wordmark: a hard reload that lands on Home, so it doubles
    // as the app's refresh control.
    "go-home": () => { location.hash = "home"; location.reload(); },
    // The tabs and the sidebar entry switch views without throwing away state.
    "show-home": showHome,
    "toggle-sidebar-collapse": () => UI.toggleSidebarCollapse(),
    "toggle-rail": () => UI.toggleRail(),
    "show-today": showToday,
    "manage-project": showManage,
    "show-progress": showProgress,
    "show-ai": showAI,
    "add-exercise": addExercise,
    "create-day": createDay,
    "reset-day": resetDay,
    "add-set": addSetRow,
    "add-set-column": addSetColumn,
    "fill-down": fillDownSets,
    "apply-columns-day": applyColumnsToDay,
    "save-exercise-detail": saveDetails,
    "delete-exercise": deleteCurrentExercise,
    "close-exercise": closeDetails,
    "remove-media": removeMedia,
    "open-cardio": openCardio,
    "add-cardio-entry": addCardioEntry,
    "save-cardio": saveCardio,
    "save-and-update": () => {
      save();
      window.ReportCoach?.render();
      UI.toast("Saved and AI details updated");
    },
    "update-ai-details": () => {
      save({ silent: true });
      window.ReportCoach?.render();
      UI.toast("AI coach details updated");
    },
    // download-ai-csv is handled in report.js, next to the other AI exports, so
    // that it honours the All-projects checkbox on that view.

    // ---- data pipeline (Home). exportOptions() honours the All-projects box.
    "export-zip-bundle": () => window.DataPipeline?.downloadBundle?.(exportOptions()),
    "export-master-csv": () => window.DataPipeline?.downloadMaster?.(exportOptions()),
    "export-long-csv": () => window.DataPipeline?.downloadLong?.(exportOptions()),
    "save-csv-snapshot": () => window.DataPipeline?.saveSnapshot?.(exportOptions()),
    "toggle-timer": toggleTimer,
    "stop-timer": stopTimer,
    "reset-timer": resetTimer,
    "save-profile": saveProfile
  };

  document.addEventListener("click", e => {
    const completeBtn = e.target.closest("[data-complete]");
    if (completeBtn) { toggleComplete(completeBtn.dataset.complete); return; }

    const actionEl = e.target.closest("[data-action]");
    if (actionEl && ACTIONS[actionEl.dataset.action]) {
      ACTIONS[actionEl.dataset.action]();
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("exerciseModal").classList.contains("open")) closeDetails();
  });

  function init() {
    document.querySelectorAll("[data-close-modal]").forEach(b => b.onclick = closeDetails);
    document.querySelectorAll("[data-close-cardio]").forEach(b => b.onclick = () => UI.closeModal("cardioModal"));
    document.querySelector(".drawer-scrim")?.addEventListener("click", () => UI.toggleDrawer(false));

    // Live-update video/image path fields as the exercise name is typed
    $("detailName")?.addEventListener("input", () => {
      updatePathFieldsFromName($("detailName").value.trim());
      // Also update the modal header title live
      $("modalExerciseTitle").textContent = $("detailName").value.trim() || "Exercise";
    });

    // Attach exercise name autocomplete to the detail modal input
    if (window.ExerciseAutocomplete && $("detailName")) {
      ExerciseAutocomplete.attach($("detailName"), {
        onSelect(name) {
          updatePathFieldsFromName(name);
          $("modalExerciseTitle").textContent = name || "Exercise";
        }
      });
    }

    $("detailWeightUnit")?.addEventListener("change", e => {
      const ex = exercise(); if (!ex) return;
      convertExerciseWeight(ex, e.target.value);
      $("detailWeight").value = numericWeightText(ex.weight);
      renderSetTable(); save({ silent: true }); renderToday();
    });
    $("detailPulleySystem")?.addEventListener("change", e => {
      const ex = exercise(); if (!ex) return;
      convertExercisePulley(ex, e.target.value);
      $("detailWeight").value = numericWeightText(ex.weight);
      renderSetTable(); save({ silent: true }); renderToday();
    });

    wireUpload("detailImageUpload", "image");
    wireUpload("detailVideoUpload", "video");

    [$("timerCountdown"), $("timerBalance")].forEach(input => {
      input?.addEventListener("input", () => {
        if (!timerRunning && timerElapsedGross === 0) renderTimer();
      });
    });

    // Actual workout clock time, kept per calendar date so history/CSV/AI
    // export can be used to look for peak-performance-by-time-of-day.
    $("workStartTime")?.addEventListener("change", e => saveWorkTime({ startTime: e.target.value.trim() }));
    $("workStartAmPm")?.addEventListener("change", e => saveWorkTime({ startAmPm: e.target.value }));
    $("workEndTime")?.addEventListener("change", e => saveWorkTime({ endTime: e.target.value.trim() }));
    $("workEndAmPm")?.addEventListener("change", e => saveWorkTime({ endAmPm: e.target.value }));

    const p = project();
    const todayDay = p.days.find(d => Number.isInteger(d.weekday) && d.weekday === new Date().getDay());
    currentDayId = todayDay?.id || p.days[0]?.id || null;

    UI.applyLayout();
    renderAll();
    renderTimer();
    window.WorkoutPlayer?.init?.();
    MediaStore.applyLogo();
    routeFromHash();
  }

  // Hash routing. Home is the landing view, which is what makes the brand
  // icon+wordmark a working "back to home" control on a plain reload. The other
  // hashes exist so the manifest shortcuts can deep-link straight into a view.
  function routeFromHash() {
    switch ((location.hash || "").toLowerCase()) {
      case "#today": showToday(); break;
      case "#build":
      case "#manage": showManage(); break;
      case "#ai": showAI(); break;
      case "#progress":                 // legacy link - Progress is part of Home now
      case "#home":
      default:
        // renderAll() has already painted Home at this point, so only the view
        // needs switching - re-rendering would refit every model for nothing.
        history.replaceState(null, "", "#home");
        showView("homeView");
        break;
    }
  }

  // Public surface used by manage.js and report.js.
  window.GymCoach = {
    project, day, exercise, save,
    renderAll, renderToday, renderProgress, showHome, showToday, showManage, showProgress, showAI,
    renderIntensity, renderArchivedCSVs,
    openDetails, mediaSrc,
    setCurrentDay: id => { currentDayId = id; },
    get currentDayId() { return currentDayId; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
