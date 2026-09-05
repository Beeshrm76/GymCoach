// manage.js - the project builder. Create/switch/copy/delete projects, add days,
// flip any day between Workout and Rest, reorder and edit exercises.
//
// A project is an ordered list of days, and a day is either a workout with N exercises or a rest day.

window.Manage = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => UI.esc(v);
  const project = () => Store.active();
  const save = opts => Store.save(opts);

  // ------------------------------------------------------- project header

  function renderProjectSettings() {
    const p = project();
    $("projectName").value = p.name || "";
    $("projectGoal").value = p.goal || "";
    $("projectDescription").value = p.description || "";
    $("projectNotes").value = p.notes || "";

    const prog = Store.projectProgress(p);
    const workoutDays = p.days.filter(d => d.type === "workout").length;
    const restDays = p.days.length - workoutDays;
    const exCount = p.days.reduce((n, d) => n + d.exercises.length, 0);
    $("projectSummary").textContent =
      `${p.days.length} days (${workoutDays} workout / ${restDays} rest) · ${exCount} exercises · ${prog.pct}% complete`;
  }

  function saveProjectSettings() {
    const p = project();
    p.name = $("projectName").value.trim() || "Workout Project";
    p.goal = $("projectGoal").value.trim();
    p.description = $("projectDescription").value.trim();
    p.notes = $("projectNotes").value;
    save();
    window.GymCoach?.renderToday();
    render();
    UI.toast("Project saved");
  }

  // ---------------------------------------------------------------- days

  function render() {
    if ($("manageView")?.hidden && !$("manageDays")) return;
    renderProjectSettings();

    const p = project();
    const box = $("manageDays");
    if (!box) return;
    box.innerHTML = "";

    if (!p.days.length) {
      box.innerHTML = `<div class="empty-state panel">
          <b>No days in this project</b>
          <p>A project is just an ordered list of days. Add one and pick Workout or Rest.</p>
          <button class="btn primary" data-action="create-day">+ Add the first day</button>
        </div>`;
      return;
    }

    p.days.forEach((d, di) => box.appendChild(dayCard(p, d, di)));
  }

  function dayCard(p, d, di) {
    const card = document.createElement("div");
    card.className = "panel manage-day-card" + (d.type === "rest" ? " is-rest" : "");
    const prog = Store.dayProgress(d);

    card.innerHTML = `
      <div class="manage-day-header">
        <div class="manage-day-id">
          <span class="day-index">${di + 1}</span>
          <div>
            <div class="manage-day-title">${esc(d.name)}</div>
            <div class="manage-day-sub">${d.type === "rest" ? "Rest / Recovery" : `${esc(d.title || "Workout")} · ${d.exercises.length} exercises · ${prog.pct}%`}</div>
          </div>
        </div>
        <div class="manage-day-tools">
          <div class="day-toggle" role="group" aria-label="Day type">
            <button class="${d.type === "workout" ? "active" : ""}" data-type="workout">Workout</button>
            <button class="${d.type === "rest" ? "active" : ""}" data-type="rest">Rest</button>
          </div>
          <button class="icon-btn" data-day-up title="Move up" ${di === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-btn" data-day-down title="Move down" ${di === p.days.length - 1 ? "disabled" : ""}>↓</button>
          <button class="icon-btn" data-day-copy title="Duplicate day">⧉</button>
          <button class="icon-btn danger" data-day-delete title="Delete day">×</button>
        </div>
      </div>`;

    // Rest days only need a name, title and notes - no exercise machinery.
    const meta = document.createElement("div");
    meta.className = "manage-day-meta";
    meta.innerHTML = d.type === "workout"
      ? `<label>Day name<input data-meta="name" value="${esc(d.name)}"></label>
         <label>Title
           <div class="day-title-wrap">
             <input data-meta="title" value="${esc(d.title || "")}" placeholder="e.g. Push A">
             <select data-meta="category" class="quick-split-select" title="Workout split (Push, Pull, Leg, Other) — automatically chooses icon">
               <option value="" disabled ${!d.category ? "selected" : ""}>Split ▾</option>
               <option value="push" ${d.category === "push" ? "selected" : ""}>Push</option>
               <option value="pull" ${d.category === "pull" ? "selected" : ""}>Pull</option>
               <option value="leg" ${d.category === "leg" ? "selected" : ""}>Leg</option>
               <option value="other" ${d.category === "other" ? "selected" : ""}>Other</option>
             </select>
           </div>
         </label>
         <label>Subtitle<input data-meta="subtitle" value="${esc(d.subtitle || "")}"></label>
         <label>Focus<input data-meta="focus" value="${esc(d.focus || "")}"></label>
         <label>Muscles<input data-meta="muscles" value="${esc(d.muscles || "")}"></label>`
      : `<label>Day name<input data-meta="name" value="${esc(d.name)}"></label>
         <label>Rest title<input data-meta="title" value="${esc(d.title || "Rest Day")}"></label>
         <label class="span-2">Rest notes<input data-meta="restNotes" value="${esc(d.restNotes || "")}" placeholder="e.g. Full rest + weekly measurements"></label>`;
    card.appendChild(meta);

    if (d.type === "workout") {
      const list = document.createElement("div");
      list.className = "manage-exercises";
      if (d.exercises.length) {
        const head = document.createElement("div");
        head.className = "manage-exercises-head";
        head.innerHTML = `
          <span class="head-thumb"></span>
          <span class="head-name">Name</span>
          <span class="head-weight">Target</span>
          <span class="head-reps">Reps range</span>
          <span class="head-sets">Sets</span>
          <span class="head-tools"></span>`;
        list.appendChild(head);
      }
      d.exercises.forEach((ex, ei) => list.appendChild(exerciseRow(d, ex, ei)));
      if (!d.exercises.length) {
        list.innerHTML = `<div class="inline-empty">No exercises yet.</div>`;
      }
      card.appendChild(list);

      const footer = document.createElement("div");
      footer.className = "manage-day-footer";
      footer.innerHTML = `
        <button class="btn" data-add-ex>+ Add Exercise</button>
        <button class="btn" data-open-day>Open in Today</button>
        <button class="btn" data-clear-day>Clear logged sets</button>`;
      card.appendChild(footer);

      footer.querySelector("[data-add-ex]").onclick = () => {
        d.exercises.push(Store.newExercise({ name: `Exercise ${d.exercises.length + 1}` }));
        save(); render(); window.GymCoach?.renderToday(); window.GymCoach?.renderAll();
      };
      footer.querySelector("[data-open-day]").onclick = () => {
        window.GymCoach.setCurrentDay(d.id);
        window.GymCoach.showToday();
      };
      footer.querySelector("[data-clear-day]").onclick = async () => {
        if (!await UI.confirm(`Clear logged sets on ${d.name}?`, "Targets and columns are kept.")) return;
        Store.resetDayLogs(d); save(); render(); window.GymCoach?.renderToday(); window.GymCoach?.renderAll(); UI.toast("Cleared");
      };
    }

    // meta inputs
    meta.querySelectorAll("[data-meta]").forEach(inp => {
      inp.onchange = () => {
        const key = inp.dataset.meta;
        d[key] = inp.value;
        if (key === "category" && inp.value) {
          if (!d.title || /^(workout|day \d+|push|pull|leg|other)$/i.test(d.title.trim())) {
            d.title = inp.value.charAt(0).toUpperCase() + inp.value.slice(1);
            const titleInp = meta.querySelector('[data-meta="title"]');
            if (titleInp) titleInp.value = d.title;
          }
        }
        save();
        render();
        window.GymCoach?.renderToday();
        window.GymCoach?.renderAll();
      };
    });

    // day type toggle
    card.querySelectorAll("[data-type]").forEach(btn => btn.onclick = async () => {
      const next = btn.dataset.type;
      if (next === d.type) return;
      if (next === "rest" && d.exercises.length) {
        if (!await UI.confirm(`Make ${d.name} a rest day?`,
          `Its ${d.exercises.length} exercises are kept and come back if you switch it to Workout again.`,
          { confirmLabel: "Make rest day", danger: false })) return;
      }
      d.type = next;
      // Switching to rest preserves exercises so they aren't lost by accident.
      if (next === "rest") { d.restNotes ||= "Recovery day."; d.title ||= "Rest Day"; }
      else if (!d.exercises.length) d.exercises.push(Store.newExercise({ name: "Exercise 1" }));
      save(); render(); window.GymCoach?.renderToday();
    });

    const moveDay = (from, to) => {
      if (to < 0 || to >= p.days.length) return;
      [p.days[from], p.days[to]] = [p.days[to], p.days[from]];
      save(); render(); window.GymCoach?.renderToday();
    };
    card.querySelector("[data-day-up]").onclick = () => moveDay(di, di - 1);
    card.querySelector("[data-day-down]").onclick = () => moveDay(di, di + 1);

    card.querySelector("[data-day-copy]").onclick = () => {
      const copy = Store.clone(d);
      copy.id = Store.uid("day");
      copy.name = `${d.name} (copy)`;
      copy.exercises.forEach(ex => {
        ex.id = Store.uid("ex");
        ex.logs = Array.from({ length: Math.max(1, ex.logs.length) }, () => Store.newSetRow(ex.setColumns));
      });
      p.days.splice(di + 1, 0, copy);
      save(); render(); window.GymCoach?.renderToday();
      UI.toast(`Duplicated ${d.name}`);
    };

    card.querySelector("[data-day-delete]").onclick = async () => {
      if (!await UI.confirm(`Delete ${d.name}?`, `${d.exercises.length} exercises and their logs are removed.`)) return;
      d.exercises.forEach(ex => {
        MediaStore.deleteImage(p.id, ex.id);
        MediaStore.deleteVideo(p.id, ex.id);
      });
      p.days.splice(di, 1);
      if (window.GymCoach.currentDayId === d.id) window.GymCoach.setCurrentDay(p.days[0]?.id || null);
      save(); render(); window.GymCoach?.renderToday();
      UI.toast("Day deleted");
    };

    return card;
  }

  // ----------------------------------------------------------- exercises

  function exerciseRow(d, ex, ei) {
    const row = document.createElement("div");
    row.className = "manage-exercise-row";
    row.innerHTML = `
      <div class="mini-thumb" data-mini-thumb="${ex.id}"><span>▦</span></div>
      <input class="field-wide" data-f="name" value="${esc(ex.name)}" placeholder="Name" aria-label="Exercise name">
      <input data-f="weight" value="${esc(ex.weight || "")}" placeholder="Target" aria-label="Target weight">
      <input data-f="reps" value="${esc(ex.reps || "")}" placeholder="Reps range" aria-label="Target reps range">
      <span class="set-count" title="Set rows are managed in the details panel">${ex.logs.length} sets</span>
      <div class="manage-ex-buttons">
        <button class="icon-btn" data-ex-details title="Open details (media, RIR, set table)">⋯</button>
        <button class="icon-btn" data-ex-up title="Move up" ${ei === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-btn" data-ex-down title="Move down" ${ei === d.exercises.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-btn danger" data-ex-delete title="Delete">×</button>
      </div>`;

    // Helper: derives a slug the same way app.js does
    const toSlug = (name) => (name || "").trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const isAutoPath = (path, kind) => {
      if (!path) return true;
      const p = path.trim();
      if (!p) return true;
      if (kind === "video") return /^videos\/[a-z0-9_]+\.mp4$/i.test(p);
      if (kind === "image") return /^images\/[a-z0-9_]+\.(?:jpg|jpeg|png|webp)$/i.test(p);
      return false;
    };

    row.querySelectorAll("[data-f]").forEach(inp => {
      inp.onchange = () => {
        const key = inp.dataset.f;
        if (key === "name") {
          // Auto-update image/video paths if they're auto-generated or empty
          const newSlug = toSlug(inp.value.trim());
          if (isAutoPath(ex.image, "image")) {
            ex.image = newSlug ? `images/${newSlug}.jpg` : "";
          }
          if (isAutoPath(ex.video, "video")) {
            ex.video = newSlug ? `videos/${newSlug}.mp4` : "";
          }
        }
        ex[key] = inp.value.trim();
        save();
        window.GymCoach?.renderToday();
      };
    });

    // Attach exercise name autocomplete to the name input in the Build view
    const nameInput = row.querySelector('[data-f="name"]');
    if (nameInput && window.ExerciseAutocomplete) {
      ExerciseAutocomplete.attach(nameInput, {
        onSelect(name) {
          const newSlug = toSlug(name);
          if (isAutoPath(ex.image, "image")) {
            ex.image = newSlug ? `images/${newSlug}.jpg` : "";
          }
          if (isAutoPath(ex.video, "video")) {
            ex.video = newSlug ? `videos/${newSlug}.mp4` : "";
          }
          ex.name = name;
          save();
          window.GymCoach?.renderToday();
        }
      });
    }

    row.querySelector("[data-ex-details]").onclick = () => {
      window.GymCoach.setCurrentDay(d.id);
      window.GymCoach.openDetails(ex.id);
    };

    const move = (from, to) => {
      if (to < 0 || to >= d.exercises.length) return;
      [d.exercises[from], d.exercises[to]] = [d.exercises[to], d.exercises[from]];
      save(); render(); window.GymCoach?.renderToday();
    };
    row.querySelector("[data-ex-up]").onclick = () => move(ei, ei - 1);
    row.querySelector("[data-ex-down]").onclick = () => move(ei, ei + 1);

    row.querySelector("[data-ex-delete]").onclick = async () => {
      if (!await UI.confirm(`Delete "${ex.name}"?`, "Its set log and uploaded media go too.")) return;
      MediaStore.deleteImage(project().id, ex.id);
      MediaStore.deleteVideo(project().id, ex.id);
      d.exercises.splice(ei, 1);
      save(); render(); window.GymCoach?.renderToday();
      UI.toast("Exercise deleted");
    };

    // Media keys are ID-based, so a thumbnail can't drift onto another exercise
    // after a reorder.
    window.GymCoach?.mediaSrc(ex, "image").then(src => {
      const el = row.querySelector(`[data-mini-thumb="${ex.id}"]`);
      if (src && el) el.innerHTML = `<img src="${src}" alt="">`;
    });

    return row;
  }

  // ------------------------------------------------------ project chooser

  function renderProjectModal() {
    const box = $("projectModalList");
    box.innerHTML = "";
    const activeId = project().id;

    Store.all().forEach(p => {
      const prog = Store.projectProgress(p);
      const item = document.createElement("div");
      item.className = "project-item" + (p.id === activeId ? " active" : "");
      item.innerHTML = `
        <div class="project-item-main">
          <b>${esc(p.name)}</b>
          <small>${p.days.length} days · ${p.days.reduce((n, d) => n + d.exercises.length, 0)} exercises · ${prog.pct}%</small>
          <small class="muted">${esc(p.goal || "No goal set")}</small>
        </div>
        <div class="project-item-actions">
          <button class="small-btn" data-open>${p.id === activeId ? "Current" : "Open"}</button>
          <button class="small-btn" data-copy>Copy</button>
          <button class="small-btn danger" data-del ${Store.all().length <= 1 ? "disabled" : ""}>×</button>
        </div>`;

      item.querySelector("[data-open]").onclick = () => {
        Store.setActive(p.id);
        window.GymCoach.setCurrentDay(p.days[0]?.id || null);
        UI.closeModal("projectModal");
        window.GymCoach.renderAll();
        window.GymCoach.showToday();
      };
      item.querySelector("[data-copy]").onclick = () => {
        const copy = Store.duplicateProject(p.id);
        window.GymCoach.setCurrentDay(copy.days[0]?.id || null);
        renderProjectModal();
        window.GymCoach.renderAll();
        UI.toast(`Created "${copy.name}"`);
      };
      item.querySelector("[data-del]").onclick = async () => {
        if (Store.all().length <= 1) { UI.toast("Keep at least one project.", "error"); return; }
        if (!await UI.confirm(`Delete "${p.name}"?`, "All its days, logs and uploaded media are removed.")) return;
        await MediaStore.purgeProject(p.id);
        Store.deleteProject(p.id);
        window.GymCoach.setCurrentDay(Store.active().days[0]?.id || null);
        renderProjectModal();
        window.GymCoach.renderAll();
        UI.toast("Project deleted");
      };
      box.appendChild(item);
    });

    const sel = $("newProjectTemplate");
    if (sel && !sel.dataset.filled) {
      sel.innerHTML = (window.PROJECT_TEMPLATES || [])
        .map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
      sel.dataset.filled = "1";
      sel.onchange = updateTemplateHint;
    }
    updateTemplateHint();
  }

  function updateTemplateHint() {
    const t = (window.PROJECT_TEMPLATES || []).find(x => x.id === $("newProjectTemplate")?.value);
    const hint = $("templateHint");
    if (!hint) return;
    hint.textContent = t ? t.summary : "";
    if (t && !$("newProjectGoal").value.trim()) $("newProjectGoal").placeholder = t.goal || "Goal";
  }

  function createProjectFromModal() {
    const name = $("newProjectName").value.trim();
    if (!name) { UI.toast("Enter a project name.", "error"); return; }
    const template = (window.PROJECT_TEMPLATES || []).find(t => t.id === $("newProjectTemplate").value);
    const p = Store.createProject({
      name,
      goal: $("newProjectGoal").value.trim() || template?.goal || "",
      template
    });
    $("newProjectName").value = "";
    $("newProjectGoal").value = "";
    window.GymCoach.setCurrentDay(p.days[0]?.id || null);
    UI.closeModal("projectModal");
    window.GymCoach.renderAll();
    window.GymCoach.showManage();
    UI.toast(`Created "${p.name}" with ${p.days.length} days`);
  }

  function openChooser() { renderProjectModal(); UI.openModal("projectModal"); }

  // ------------------------------------------------------ backup / restore

  function exportBackup() {
    const payload = {
      version: 4,
      exportedAt: new Date().toISOString(),
      projects: Store.all(),
      activeId: Store.active().id,
      profile: Store.profile()
    };
    // Include wearable health data (Amazfit / Zepp) if any exists
    if (window.WearableStore) {
      const wd = WearableStore.readAll();
      if (Object.keys(wd).length) payload.wearable = wd;
    }
    UI.download(
      `gymcoach-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    UI.toast("Backup downloaded (media stays on this device)");
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : data.projects;
        if (!Array.isArray(list) || !list.length) throw new Error("No projects in that file");
        if (!await UI.confirm(`Replace your projects with ${list.length} from this file?`,
          "Current projects are overwritten. Uploaded media is not part of a backup.")) return;
        Store.replaceAll(list, data.activeId);
        if (data.profile?.current) localStorage.setItem(Store.keys.profile, JSON.stringify(data.profile));
        // Restore wearable health data if the backup contains it
        if (data.wearable && typeof data.wearable === "object" && window.WearableStore) {
          const existing = WearableStore.readAll();
          const merged = Object.assign(existing, data.wearable);
          localStorage.setItem("gymcoach_wearable_v1", JSON.stringify(merged));
        }
        window.GymCoach.setCurrentDay(Store.active().days[0]?.id || null);
        window.GymCoach.renderAll();
        UI.toast(`Imported ${list.length} project(s)`);
      } catch (err) {
        console.error(err);
        UI.toast("That file isn't a GymCoach backup.", "error");
      }
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------- wiring

  function init() {
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-action]");
      if (!a) return;
      const act = a.dataset.action;
      if (act === "save-project") saveProjectSettings();
      if (act === "open-projects") openChooser();
      if (act === "create-project-from-modal") createProjectFromModal();
      if (act === "export-backup") exportBackup();
    });
    document.querySelectorAll("[data-close-project-modal]").forEach(b =>
      b.onclick = () => UI.closeModal("projectModal"));
    $("importBackupInput")?.addEventListener("change", e => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) importBackup(f);
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { render, openChooser, renderProjectModal };
})();
