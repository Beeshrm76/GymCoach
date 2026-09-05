// store.js - projects, days, exercises, set columns and set rows.
//
//
// Holds ONE live in-memory copy of the store. active() returns the same reference
// every time, mutations land on the real object, and save() serialises that
// reference. Storage is read once per session (or on external change).

window.Store = (() => {
  const KEY = "gymcoach_projects_v4";
  const ACTIVE_KEY = "gymcoach_active_project_v4";
  const PROFILE_KEY = "gymcoach_profile_v4";
  const CSV_ARCHIVE_KEY = "gymcoach_csv_archives_v1";
  // Legacy keys, migrated once on first run so existing data is not orphaned.
  const LEGACY = { projects: "gymcoach_projects_v3", active: "gymcoach_active_project_v3", profile: "gymcoach_profile_v3" };

  const clone = x => JSON.parse(JSON.stringify(x));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let projects = null;      // the single live array - never replaced wholesale
  let activeId = null;
  const listeners = new Set();

  const DEFAULT_COLUMNS = () => [
    { key: "weight", label: "Weight" },
    { key: "reps", label: "Reps" },
    { key: "time", label: "Time" }
  ];

  function newSetRow(columns) {
    const values = {};
    (columns || []).forEach(c => { values[c.key] = ""; });
    return { id: uid("set"), date: "", values, notes: "", rir: "", completed: false };
  }


  const WEIGHT_UNITS = { kg: "kg", lb: "lb" };
  const KG_PER_LB = 0.45359237;
  const PULLEY_RATIOS = { single: 1, double: 2, four: 4 };

  function parseWeightNumber(value) {
    if (value === null || value === undefined) return null;
    const m = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  function normalizeWeightUnit(unit) {
    return String(unit || "").toLowerCase() === "lb" ? "lb" : "kg";
  }
  function weightToKg(value, unit = "kg") {
    const n = parseWeightNumber(value);
    if (n === null) return null;
    return normalizeWeightUnit(unit) === "lb" ? n * KG_PER_LB : n;
  }
  function kgToWeight(kg, unit = "kg") {
    if (kg === null || kg === undefined || Number.isNaN(Number(kg))) return "";
    const value = normalizeWeightUnit(unit) === "lb" ? Number(kg) / KG_PER_LB : Number(kg);
    return String(Math.round(value * 100) / 100);
  }
  function pulleyKey(value) {
    const v = String(value || "").toLowerCase();
    if (v === "double" || v === "2" || v.includes("double")) return "double";
    if (v === "four" || v === "4" || v.includes("four")) return "four";
    return "single";
  }
  function pulleyRatio(value) { return PULLEY_RATIOS[pulleyKey(value)] || 1; }
  function convertWeightValue(value, fromUnit, toUnit) {
    const kg = weightToKg(value, fromUnit);
    return kg === null ? String(value ?? "") : kgToWeight(kg, toUnit);
  }
  function convertPulleyWeight(value, unit, fromPulley, toPulley) {
    const kg = weightToKg(value, unit);
    if (kg === null) return String(value ?? "");
    const effective = kg / pulleyRatio(fromPulley);
    return kgToWeight(effective * pulleyRatio(toPulley), unit);
  }

  // The one standardised number every analysis and export should compare on:
  // the entry converted to kilograms and then divided by the pulley ratio, so a
  // 40 kg stack on a 2:1 cable and a 20 kg dumbbell read as the same 20 kg of
  // load. This is the same arithmetic convertPulleyWeight() does internally; it
  // was previously buried there and never persisted or exported.
  function effectiveKg(value, unit = "kg", pulley = "single") {
    const kg = weightToKg(value, unit);
    if (kg === null) return null;
    return Math.round((kg / pulleyRatio(pulley)) * 1000) / 1000;
  }

  function newExercise(overrides = {}) {
    const columns = DEFAULT_COLUMNS();
    const ex = {
      id: uid("ex"),
      name: "New Exercise",
      weight: "",
      weightUnit: "kg",
      pulleySystem: "single",
      reps: "8-12",
      sets: 3,
      image: "",
      video: "",
      details: { targetRIR: "", rest: "", tempo: "", equipment: "", notes: "", cues: [] },
      restStats: { plannedSec: 0, extraSec: 0, defaultDelaySec: 0, totalSec: 0, intervals: [] },
      setColumns: columns,
      logs: [],
      ...overrides
    };
    ex.logs = Array.from({ length: Math.max(1, Number(ex.sets) || 1) }, () => newSetRow(ex.setColumns));
    return ex;
  }

  function newDay(overrides = {}) {
    const type = overrides.type === "rest" ? "rest" : "workout";
    return {
      id: uid("day"),
      name: "New Day",
      weekday: null,
      type,
      title: type === "rest" ? "Rest Day" : "Workout",
      subtitle: "",
      focus: "",
      muscles: "",
      restNotes: type === "rest" ? "Recovery day." : "",
      workTimes: {},
      exercises: [],
      ...overrides
    };
  }

  // Repairs anything missing or of the wrong type. Mutates in place - it must not
  // clone, or callers holding a reference would silently lose their edits again.

  function newCardioEntry(overrides = {}) {
    return {
      id: uid("cardio"),
      type: "",
      duration: "",
      calories: "",
      incline: "",
      speed: "",
      gear: "",
      notes: "",
      date: "",
      ...overrides
    };
  }


  function localDateKey(date = new Date()) {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function weekStartDate(date = new Date()) {
    const d = date instanceof Date ? new Date(date) : new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    d.setDate(d.getDate() + diff);
    return d;
  }

  function weekStartKey(date = new Date()) {
    return localDateKey(weekStartDate(date));
  }

  function readArchives() {
    try { return JSON.parse(localStorage.getItem(CSV_ARCHIVE_KEY) || "{}") || {}; }
    catch { return {}; }
  }

  function writeArchives(archives) {
    localStorage.setItem(CSV_ARCHIVE_KEY, JSON.stringify(archives));
  }

  function csvCell(v) {
    return `"${String(v ?? "").replace(/"/g, '""')}"`;
  }

  function csvForDay(day, sourceRows) {
    const header = ["date", "day", "exercise", "set", "completed", "field", "value", "set_note", "workout_start", "workout_end"];
    const rows = [header];
    sourceRows.forEach(r => {
      const ex = r.ex;
      const log = r.log;
      const wt = getWorkTime(day, dateKey(log.date) || todayKey());
      const startCell = wt.startTime ? `${wt.startTime} ${wt.startAmPm || ""}`.trim() : "not counted";
      const endCell = wt.endTime ? `${wt.endTime} ${wt.endAmPm || ""}`.trim() : "not counted";
      const fields = Object.entries(log.values || {});
      if (!fields.length) {
        rows.push([log.date || "", day.name, ex.name, r.set, log.completed ? "yes" : "not counted",
          "not counted", "not counted", log.notes || "not counted", startCell, endCell]);
      } else {
        fields.forEach(([field, value]) => rows.push([
          log.date || "", day.name, ex.name, r.set,
          log.completed ? "yes" : "not counted",
          field, String(value).trim() || "not counted",
          log.notes || "not counted", startCell, endCell
        ]));
      }
    });
    return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  }

  function archiveOldLogs() {
    const cutoff = weekStartDate();
    const archives = readArchives();
    let changed = false;

    projects.forEach(project => {
      project.days.forEach(day => {
        const oldRows = [];
        day.exercises.forEach(ex => {
          const keep = [];
          (ex.logs || []).forEach((log, index) => {
            if (!log.date) {
              keep.push(log);
              return;
            }
            const dt = new Date(log.date);
            if (Number.isNaN(dt.getTime()) || dt >= cutoff) {
              keep.push(log);
              return;
            }
            oldRows.push({ ex, log, set: index + 1 });
          });

          if (keep.length !== ex.logs.length) {
            ex.logs = keep.length ? keep : [newSetRow(ex.setColumns)];
            changed = true;
          }
        });

        if (oldRows.length) {
          const key = `${project.id}:${day.id}:${localDateKey(cutoff)}`;
          archives[key] = {
            projectId: project.id,
            projectName: project.name,
            dayId: day.id,
            dayName: day.name,
            weekStart: localDateKey(cutoff),
            csv: csvForDay(day, oldRows),
            updatedAt: new Date().toISOString()
          };
          changed = true;
        }
      });
    });

    if (changed) writeArchives(archives);
    return changed;
  }

  function archivedCSVs(projectId = active().id) {
    const archives = readArchives();
    return Object.values(archives).filter(a => a.projectId === projectId);
  }

  function clearArchivedCSV(key) {
    const archives = readArchives();
    delete archives[key];
    writeArchives(archives);
  }

  // Lets the export pipeline park a full CSV snapshot beside the rolling weekly
  // archives, so a saved export survives a page reload and shows up in the same
  // "Archived CSV" list the user already knows.
  function saveArchivedCSV(key, record) {
    const archives = readArchives();
    archives[key] = { updatedAt: new Date().toISOString(), ...record };
    try {
      writeArchives(archives);
      return true;
    } catch (err) {
      console.error("Store: could not store CSV snapshot", err);
      window.UI?.toast("Snapshot too large for browser storage — download it instead.", "error");
      return false;
    }
  }

  function allArchivedCSVs() {
    const archives = readArchives();
    return Object.entries(archives).map(([key, value]) => ({ key, ...value }));
  }

  function normalize(p) {
    p.id ||= uid("project");
    p.name ||= "Workout Project";
    p.goal ??= "";
    p.description ??= "";
    p.notes ??= "";
    if (!Array.isArray(p.playlist)) p.playlist = [];
    if (!p.dayPlaylists || typeof p.dayPlaylists !== "object") p.dayPlaylists = {};
    const ALL_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "general"];
    ALL_WEEKDAYS.forEach(k => {
      if (!Array.isArray(p.dayPlaylists[k])) p.dayPlaylists[k] = [];
    });
    if (p.playlist.length && !p.dayPlaylists.general.length) {
      p.dayPlaylists.general = [...p.playlist];
    }
    if (!p.desiredBody || typeof p.desiredBody !== "object") p.desiredBody = {};
    if (!Array.isArray(p.days)) p.days = [];

    p.days.forEach(day => {
      day.id ||= uid("day");
      day.name ||= "Day";
      if (day.weekday === undefined) {
        const weekdayMap = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
        day.weekday = Object.prototype.hasOwnProperty.call(weekdayMap, day.name)
          ? weekdayMap[day.name] : null;
      }
      day.type = day.type === "rest" ? "rest" : "workout";
      day.title ||= day.type === "rest" ? "Rest Day" : "Workout";
      if (day.name === "Saturday" && day.title === "Pull C") {
        day.title = "Pull B";
      }
      if (!day.category) {
        const dName = (day.name || "").toLowerCase();
        const dTitle = (day.title || "").toLowerCase();
        if (day.type === "rest") {
          day.category = "rest";
        } else if (dName.includes("wednesday") || dName.includes("friday") || /pull|row|lat|back|chin|deadlift/.test(dTitle)) {
          day.category = "pull";
        } else if (dName.includes("thursday") || dName.includes("sunday") || /leg|squat|quad|hamstring|lower|lunge/.test(dTitle)) {
          day.category = "leg";
        } else if (dName.includes("tuesday") || /push|chest|bench|press|shoulder|tricep/.test(dTitle)) {
          day.category = "push";
        } else {
          day.category = "other";
        }
      }
      day.subtitle ??= "";
      day.focus ??= "";
      day.muscles ??= "";
      day.restNotes ??= "";
      if (!day.workTimes || typeof day.workTimes !== "object") day.workTimes = {};
      if (!Array.isArray(day.cardio)) day.cardio = [];
      day.cardio.forEach(entry => {
        entry.id ||= uid("cardio");
        entry.type ??= "";
        entry.duration ??= "";
        entry.calories ??= "";
        entry.incline ??= "";
        entry.speed ??= "";
        entry.gear ??= "";
        entry.notes ??= "";
        entry.date ??= "";
      });
      if (!Array.isArray(day.exercises)) day.exercises = [];

      day.exercises.forEach(ex => {
        ex.id ||= uid("ex");
        ex.name ||= "Exercise";
        if (ex.name === "Hanging Knee Raise / Reverse Crunch") {
          ex.name = "Hanging Knee Raise";
        }
        ex.weight ??= "";
        ex.weightUnit = normalizeWeightUnit(ex.weightUnit || "kg");
        const legacyWeight = parseWeightNumber(ex.weight);
        if (legacyWeight !== null && /(?:kg|lb)/i.test(String(ex.weight))) {
          ex.weightUnit = /lb/i.test(String(ex.weight)) ? "lb" : "kg";
          ex.weight = String(legacyWeight);
        }
        ex.pulleySystem = pulleyKey(ex.pulleySystem || "single");
        ex.reps ??= "";
        ex.sets = Math.max(1, Number(ex.sets) || 1);
        ex.image ??= "";
        ex.video ??= "";

        ex.details ||= {};
        ["targetRIR", "rest", "tempo", "equipment", "notes"].forEach(k => { ex.details[k] ??= ""; });
        ex.restStats ||= { plannedSec: 0, extraSec: 0, balanceSec: 0, defaultDelaySec: 0, totalSec: 0, intervals: [] };
        ex.restStats.plannedSec = Number(ex.restStats.plannedSec) || 0;
        ex.restStats.extraSec = Number(ex.restStats.extraSec) || 0;
        ex.restStats.balanceSec = Number(ex.restStats.balanceSec) || 0;
        ex.restStats.defaultDelaySec = Number(ex.restStats.defaultDelaySec) || 0;
        ex.restStats.totalSec = Number(ex.restStats.totalSec) || ex.restStats.plannedSec + ex.restStats.extraSec + ex.restStats.defaultDelaySec;
        if (!Array.isArray(ex.restStats.intervals)) ex.restStats.intervals = [];
        // One interval per stopped timer. Uncapped this grows forever and eats the
        // 5 MB localStorage budget, so keep only the most recent stretch.
        if (ex.restStats.intervals.length > 200) ex.restStats.intervals = ex.restStats.intervals.slice(-200);
        if (!Array.isArray(ex.details.cues)) ex.details.cues = [];

        if (!Array.isArray(ex.setColumns) || !ex.setColumns.length) ex.setColumns = DEFAULT_COLUMNS();
        ex.setColumns = ex.setColumns
          .filter(c => c && (c.key || c.label))
          .map(c => ({ key: c.key || slugKey(c.label), label: c.label || c.key }));
        if (!ex.setColumns.length) ex.setColumns = DEFAULT_COLUMNS();

        // V10: RIR is replaced by per-set elapsed Time. Preserve any old RIR
        // values only when they already look like a time value; otherwise clear it.
        ex.setColumns = ex.setColumns.map(c => {
          if (c.key === "rir" || /^(rir|RIR)$/i.test(String(c.label || ""))) return { key: "time", label: "Time" };
          return c;
        });
        const seenCols = new Set();
        ex.setColumns = ex.setColumns.filter(c => {
          if (seenCols.has(c.key)) return false;
          seenCols.add(c.key); return true;
        });
        if (!ex.setColumns.some(c => c.key === "time")) ex.setColumns.push({ key: "time", label: "Time" });

        if (!Array.isArray(ex.logs)) ex.logs = [];
        ex.logs.forEach(log => {
          log.id ||= uid("set");
          log.date ??= "";
          log.notes ??= "";
          log.rir ??= "";
          log.completed = !!log.completed;
          if (!log.values || typeof log.values !== "object") log.values = {};
          if ((log.values.time ?? "") === "" && log.values.rir !== undefined) {
            const legacy = String(log.values.rir ?? "").trim();
            // Do not pretend an RIR number is elapsed time. Only migrate values
            // explicitly formatted as time, otherwise the new Time field starts blank.
            if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(legacy)) log.values.time = legacy;
          }
          delete log.values.rir;
          ex.setColumns.forEach(c => { log.values[c.key] ??= ""; });
        });
        // A set table with no rows can't be typed into, so guarantee one.
        if (!ex.logs.length) ex.logs.push(newSetRow(ex.setColumns));
      });
    });
    return p;
  }

  function slugKey(label) {
    return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || uid("col");
  }

  function readRaw(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }

  function hydrate() {
    if (projects) return;

    let stored = readRaw(KEY);
    let storedActive = localStorage.getItem(ACTIVE_KEY);

    if (!Array.isArray(stored) || !stored.length) {
      const legacy = readRaw(LEGACY.projects);
      if (Array.isArray(legacy) && legacy.length) {
        stored = legacy;
        storedActive = localStorage.getItem(LEGACY.active);
        const oldProfile = readRaw(LEGACY.profile);
        if (oldProfile && !localStorage.getItem(PROFILE_KEY)) {
          localStorage.setItem(PROFILE_KEY, JSON.stringify({ current: oldProfile, history: [] }));
        }
      }
    }

    if (Array.isArray(stored) && stored.length) {
      projects = stored.map(normalize);
    } else {
      projects = [normalize(clone(window.SEED_PROJECT || { name: "My Workout Project", days: [] }))];
      persist();
    }

    activeId = projects.some(p => p.id === storedActive) ? storedActive : projects[0].id;
    localStorage.setItem(ACTIVE_KEY, activeId);
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(projects));
    } catch (err) {
      // Quota is the realistic failure here: media lives in IndexedDB, but a very
      // large plan plus long set history can still fill the 5 MB text budget.
      console.error("Store: could not persist projects", err);
      window.UI?.toast("Could not save - browser storage is full.", "error");
    }
  }

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

  // The only write path. Callers mutate the live object, then call save().
  function save({ silent = false } = {}) {
    hydrate();
    normalize(active());
    archiveOldLogs();
    persist();
    if (!silent) emit();
  }

  function all() { hydrate(); return projects; }

  function active() {
    hydrate();
    return projects.find(p => p.id === activeId) || projects[0];
  }

  function setActive(id) {
    hydrate();
    if (projects.some(p => p.id === id)) {
      activeId = id;
      localStorage.setItem(ACTIVE_KEY, id);
    }
    return active();
  }

  function findDay(dayId) { return active().days.find(d => d.id === dayId) || null; }

  function findExercise(dayId, exId) {
    const d = findDay(dayId);
    return d ? d.exercises.find(e => e.id === exId) || null : null;
  }

  function createProject({ name, goal = "", template = null } = {}) {
    hydrate();
    const p = normalize({
      id: uid("project"),
      name: name || "New Workout Project",
      goal,
      description: "",
      notes: "",
      days: []
    });

    if (template?.cloneSeed && window.SEED_PROJECT) {
      const seeded = normalize(clone(window.SEED_PROJECT));
      p.days = seeded.days;
      reid(p);
    } else if (template?.days?.length) {
      p.days = template.days.map(spec => {
        const day = newDay({
          name: spec.name,
          weekday: Number.isInteger(spec.weekday) ? spec.weekday : null,
          type: spec.type,
          title: spec.title,
          subtitle: spec.subtitle || "",
          focus: spec.focus || "",
          muscles: spec.muscles || "",
          restNotes: spec.restNotes || (spec.type === "rest" ? "Recovery day." : "")
        });
        if (day.type === "workout") {
          day.exercises = Array.isArray(spec.exercises)
            ? spec.exercises.map(ex => newExercise(ex))
            : Array.from({ length: Number(spec.exercises) || 0 },
              (_, i) => newExercise({ name: `Exercise ${i + 1}` }));
        }
        return day;
      });
    }

    if (!p.days.length) p.days = [newDay({ name: "Day 1" })];

    normalize(p);
    projects.push(p);
    activeId = p.id;
    localStorage.setItem(ACTIVE_KEY, p.id);
    persist();
    emit();
    return p;
  }

  // Fresh IDs for a copied tree, otherwise two projects would share exercise IDs
  // and therefore share IndexedDB media keys.
  function reid(p) {
    p.days.forEach(day => {
      day.id = uid("day");
      day.exercises.forEach(ex => {
        ex.id = uid("ex");
        ex.logs.forEach(log => { log.id = uid("set"); });
      });
    });
  }

  function duplicateProject(id, { keepLogs = false } = {}) {
    hydrate();
    const src = projects.find(p => p.id === id);
    if (!src) return null;
    const copy = normalize(clone(src));
    copy.id = uid("project");
    copy.name = `${src.name} (copy)`;
    reid(copy);
    if (!keepLogs) {
      copy.days.forEach(d => d.exercises.forEach(ex => {
        ex.logs = Array.from({ length: Math.max(1, ex.sets) }, () => newSetRow(ex.setColumns));
      }));
    }

    // PLAYLISTS: When workout is copied to new project, copy music across all weekdays
    const allTracksToCopy = [];
    copy.dayPlaylists = {};
    const ALL_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "general"];
    ALL_WEEKDAYS.forEach(w => {
      const srcList = src.dayPlaylists?.[w] || (w === "general" ? src.playlist : []);
      if (Array.isArray(srcList) && srcList.length) {
        copy.dayPlaylists[w] = srcList.map(song => {
          const cloned = { ...song, id: uid("song"), origId: song.id };
          allTracksToCopy.push(cloned);
          return cloned;
        });
      } else {
        copy.dayPlaylists[w] = [];
      }
    });
    copy.playlist = copy.dayPlaylists.general || [];

    if (allTracksToCopy.length && window.MediaStore?.copyPlaylistMedia) {
      window.MediaStore.copyPlaylistMedia(src.id, copy.id, allTracksToCopy).then(() => {
        allTracksToCopy.forEach(s => delete s.origId);
        persist();
      });
    }

    projects.push(copy);
    activeId = copy.id;
    localStorage.setItem(ACTIVE_KEY, copy.id);
    persist();
    emit();
    return copy;
  }

  function deleteProject(id) {
    hydrate();
    if (projects.length <= 1) return false;
    const i = projects.findIndex(p => p.id === id);
    if (i < 0) return false;
    const deletedId = projects[i].id;
    projects.splice(i, 1);
    if (window.MediaStore?.purgeProject) window.MediaStore.purgeProject(deletedId);
    if (activeId === id) setActive(projects[0].id);
    persist();
    emit();
    return true;
  }

  function replaceAll(nextProjects, nextActiveId) {
    if (!Array.isArray(nextProjects) || !nextProjects.length) return false;
    projects = nextProjects.map(normalize);
    activeId = projects.some(p => p.id === nextActiveId) ? nextActiveId : projects[0].id;
    localStorage.setItem(ACTIVE_KEY, activeId);
    persist();
    emit();
    return true;
  }

  // ---- set columns -------------------------------------------------------
  // Columns are per-exercise and fully dynamic: nothing in the app assumes
  // "weight" or "reps" exists.

  function addColumn(ex, label) {
    const base = slugKey(label);
    let key = base, n = 2;
    while (ex.setColumns.some(c => c.key === key)) key = `${base}_${n++}`;
    ex.setColumns.push({ key, label: label || key });
    ex.logs.forEach(log => { log.values[key] ??= ""; });
    return key;
  }

  function removeColumn(ex, index) {
    if (ex.setColumns.length <= 1) return false;
    const [col] = ex.setColumns.splice(index, 1);
    ex.logs.forEach(log => { delete log.values[col.key]; });
    return true;
  }

  function moveColumn(ex, index, dir) {
    const to = index + dir;
    if (to < 0 || to >= ex.setColumns.length) return false;
    [ex.setColumns[index], ex.setColumns[to]] = [ex.setColumns[to], ex.setColumns[index]];
    return true;
  }

  function renameColumn(ex, index, label) {
    if (!ex.setColumns[index]) return false;
    ex.setColumns[index].label = label;
    return true;
  }

  // Copy one exercise's column layout across a whole day, preserving any values
  // already logged under matching keys.
  function applyColumnsToDay(day, columns) {
    day.exercises.forEach(ex => {
      ex.setColumns = clone(columns);
      ex.logs.forEach(log => {
        const next = {};
        ex.setColumns.forEach(c => { next[c.key] = log.values[c.key] ?? ""; });
        log.values = next;
      });
    });
  }

  // ---- set rows ----------------------------------------------------------

  function addRow(ex) { const row = newSetRow(ex.setColumns); ex.logs.push(row); return row; }

  function removeRow(ex, index) {
    if (ex.logs.length <= 1) return false;
    ex.logs.splice(index, 1);
    return true;
  }

  function duplicateRow(ex, index) {
    const src = ex.logs[index];
    if (!src) return false;
    const copy = clone(src);
    copy.id = uid("set");
    copy.completed = false;
    copy.date = "";
    ex.logs.splice(index + 1, 0, copy);
    return true;
  }

  function fillDown(ex, fromIndex = 0) {
    const src = ex.logs[fromIndex];
    if (!src) return false;
    const stamp = new Date().toISOString();
    ex.logs.forEach((log, i) => {
      if (i > fromIndex) {
        log.values = clone(src.values);
        log.rir = src.rir ?? "";
        // Without this, a row carrying yesterday's date fell outside
        // currentSessionRows() after filling — its Time value silently
        // dropped out of both the editable Current section and the
        // Recorded total, even though it now holds today's data.
        log.date = stamp;
      }
    });
    return true;
  }


  // ---- current / previous session helpers -------------------------------
  function dateKey(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  // ---- workout clock time (for peak-performance-by-time-of-day analysis) --
  // Stored per calendar date so history/CSV/AI export stay accurate even as
  // the recurring weekday template gets reused week after week.
  function getWorkTime(day, key = todayKey()) {
    if (!day) return { startTime: "", startAmPm: "AM", endTime: "", endAmPm: "AM" };
    if (!day.workTimes || typeof day.workTimes !== "object") day.workTimes = {};
    return day.workTimes[key] || { startTime: "", startAmPm: "AM", endTime: "", endAmPm: "AM" };
  }

  function setWorkTime(day, patch, key = todayKey()) {
    if (!day) return;
    if (!day.workTimes || typeof day.workTimes !== "object") day.workTimes = {};
    day.workTimes[key] = { ...getWorkTime(day, key), ...patch };
  }

  function workTimeText(wt) {
    if (!wt || (!wt.startTime && !wt.endTime)) return "";
    const start = wt.startTime ? `${wt.startTime} ${wt.startAmPm || ""}`.trim() : "";
    const end = wt.endTime ? `${wt.endTime} ${wt.endAmPm || ""}`.trim() : "";
    if (start && end) return `${start} – ${end}`;
    return start || end;
  }

  function currentSessionRows(ex) {
    const today = todayKey();
    return (ex.logs || []).filter(log => !log.date || dateKey(log.date) === today);
  }

  function previousSessionRows(ex) {
    const dates = [...new Set((ex.logs || []).map(l => dateKey(l.date)).filter(Boolean))]
      .filter(k => k < todayKey())
      .sort()
      .reverse();
    if (!dates.length) return [];
    const previous = dates[0];
    return (ex.logs || []).filter(l => dateKey(l.date) === previous);
  }

  // ---- completion --------------------------------------------------------


  const isExerciseDone = ex => {
    const rows = currentSessionRows(ex);
    return !!rows.length && rows.every(l => l.completed);
  };

  const isExerciseStarted = ex => {
    const rows = currentSessionRows(ex);
    return rows.some(l => l.completed || Object.values(l.values || {}).some(v => String(v).trim()));
  };

  function setExerciseDone(ex, done) {
    const rows = currentSessionRows(ex);
    const stamp = new Date().toISOString();
    rows.forEach(log => {
      log.completed = done;
      log.date = stamp;
    });
  }

  function dayProgress(day) {
    if (!day || day.type !== "workout") return { total: 0, done: 0, pct: 0 };
    const total = day.exercises.length;
    const done = day.exercises.filter(isExerciseDone).length;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  function projectProgress(p = active()) {
    let total = 0, done = 0;
    p.days.forEach(d => {
      if (d.type !== "workout") return;
      d.exercises.forEach(ex => { total++; if (isExerciseDone(ex)) done++; });
    });
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  function resetDayLogs(day) {
    day.exercises.forEach(ex => currentSessionRows(ex).forEach(log => {
      log.completed = false;
      log.date = "";
      Object.keys(log.values).forEach(k => { log.values[k] = ""; });
      log.notes = "";
    }));
  }


  // ---- intensity ----------------------------------------------------------
  // 5 points is the maximum for an exercise. Every planned/current set earns
  // one-fifth of the exercise score. Missing sets score zero; reduced reps
  // reduce that set's credit. The overall day score is weighted by planned
  // set count, so it reflects the whole session rather than one exercise.
  function repFloor(target) {
    const m = String(target || "").match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }

  function setIntensity(ex, log) {
    if (!log?.completed) return 0;
    const repCol = (ex.setColumns || []).find(c => c.key === "reps" || /rep/i.test(c.label || ""));
    const floor = repFloor(ex.reps);
    if (!repCol || floor == null) return 1;

    const raw = String(log.values?.[repCol.key] ?? "");
    const m = raw.match(/\d+(?:\.\d+)?/);
    if (!m) return 0;
    return Math.max(0, Math.min(1, Number(m[0]) / floor));
  }

  function exerciseIntensity(ex) {
    const rows = currentSessionRows(ex);
    const planned = Math.max(1, Number(ex.sets || rows.length || 1));
    const credits = rows.reduce((sum, log) => sum + setIntensity(ex, log), 0);
    return Math.max(0, Math.min(5, (credits / planned) * 5));
  }

  function dayIntensity(day) {
    if (!day || day.type !== "workout") return 0;
    let earned = 0, possible = 0;
    day.exercises.forEach(ex => {
      const planned = Math.max(1, Number(ex.sets || 1));
      earned += (exerciseIntensity(ex) / 5) * planned;
      possible += planned;
    });
    return possible ? Math.max(0, Math.min(5, (earned / possible) * 5)) : 0;
  }

  function projectIntensity(p = active()) {
    const days = p.days.filter(d => d.type === "workout");
    if (!days.length) return 0;
    return days.reduce((sum, d) => sum + dayIntensity(d), 0) / days.length;
  }

  // The 0-5 score as a word. On screen intensity is deliberately a gradient bar
  // with no number (V11), but exports are data files read by a person or a model,
  // and "moderate" travels better than "2.7" with no scale attached.
  function intensityBand(score) {
    const n = Number(score);
    if (!Number.isFinite(n) || n <= 0) return "none";
    if (n < 1) return "very light";
    if (n < 2) return "light";
    if (n < 3) return "moderate";
    if (n < 4) return "hard";
    if (n < 4.75) return "very hard";
    return "maximal";
  }

  function dayForWeekday(p = active(), weekday = new Date().getDay()) {
    return p.days.find(d => Number.isInteger(d.weekday) && d.weekday === weekday) || null;
  }

  // ---- body profile ------------------------------------------------------
  // Kept as {current, history} so the AI export can show a trend, not one number.

  function profile() {
    const raw = readRaw(PROFILE_KEY);
    if (raw && typeof raw === "object" && ("current" in raw || "history" in raw)) {
      return { current: raw.current || {}, history: Array.isArray(raw.history) ? raw.history : [] };
    }
    return { current: raw || {}, history: [] };
  }

  function saveProfile(entry) {
    const p = profile();
    const record = { ...entry, date: new Date().toISOString() };
    p.current = record;
    p.history.unshift(record);
    p.history = p.history.slice(0, 60);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    emit();
    return p;
  }

  const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  function getWeekdayKey(input) {
    if (!input) {
      const idx = new Date().getDay();
      return idx === 0 ? "sunday" : WEEKDAY_KEYS[idx - 1] || "monday";
    }
    if (typeof input === "number") {
      return input === 0 ? "sunday" : (WEEKDAY_KEYS[input - 1] || "monday");
    }
    const s = String(input).trim().toLowerCase();
    for (const w of WEEKDAY_KEYS) {
      if (s.includes(w)) return w;
    }
    if (s.includes("sun")) return "sunday";
    const abbrevs = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
    for (const [abbr, full] of Object.entries(abbrevs)) {
      if (s.includes(abbr)) return full;
    }
    return "general";
  }

  function getDayPlaylist(project, dayKeyOrName) {
    if (!project) return [];
    normalize(project);
    const key = getWeekdayKey(dayKeyOrName);
    const dayList = project.dayPlaylists?.[key];
    if (Array.isArray(dayList) && dayList.length > 0) return dayList;
    if (key !== "general" && Array.isArray(project.dayPlaylists?.general) && project.dayPlaylists.general.length > 0) {
      return project.dayPlaylists.general;
    }
    return Array.isArray(project.playlist) ? project.playlist : [];
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return {
    uid, clone, slugKey, normalize,
    newCardioEntry,
    localDateKey, weekStartKey, archivedCSVs,
    clearArchivedCSV, saveArchivedCSV, allArchivedCSVs,
    parseWeightNumber, normalizeWeightUnit, weightToKg, kgToWeight,
    pulleyKey, pulleyRatio, convertWeightValue, convertPulleyWeight, effectiveKg,
    all, active, setActive, save, onChange, replaceAll,
    findDay, findExercise,
    createProject, duplicateProject, deleteProject,
    newDay, newExercise, newSetRow, DEFAULT_COLUMNS,
    addColumn, removeColumn, moveColumn, renameColumn, applyColumnsToDay,
    addRow, removeRow, duplicateRow, fillDown,
    isExerciseDone, isExerciseStarted, setExerciseDone,
    dayProgress, projectProgress, resetDayLogs,
    dateKey, todayKey, currentSessionRows, previousSessionRows, dayForWeekday,
    repFloor, setIntensity, exerciseIntensity, dayIntensity, projectIntensity, intensityBand,
    getWorkTime, setWorkTime, workTimeText,
    profile, saveProfile,
    WEEKDAY_KEYS, getWeekdayKey, getDayPlaylist,
    keys: { projects: KEY, active: ACTIVE_KEY, profile: PROFILE_KEY, csvArchives: CSV_ARCHIVE_KEY }
  };
})();
