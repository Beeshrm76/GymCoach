// js/sync.js — Bi-directional Cloud Synchronization Engine
// Syncs workout and profile data between devices (e.g. PC and mobile) using Supabase sync_data.

window.SyncEngine = (() => {
  const SYNC_KEYS = new Set([
    "gymcoach_projects_v4",
    "gymcoach_active_project_v4",
    "gymcoach_profile_v4",
    "gymcoach_settings_v4",
    "gymcoach_settings",
    "gymcoach_csv_archives_v1",
    "gymcoach_wearable_v1",
    "gymcoach_exercise_scoring_overrides_v1"
  ]);

  const TIMESTAMPS_KEY = "gymcoach_sync_timestamps";

  let syncQueue = new Set();
  let syncTimer = null;
  let isSyncing = false;
  let supabase = null;
  let realtimeChannel = null;
  let pollInterval = null;

  function getLocalTimestamps() {
    try {
      return JSON.parse(localStorage.getItem(TIMESTAMPS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setLocalTimestamp(key, isoString) {
    const ts = getLocalTimestamps();
    ts[key] = isoString;
    const rawSet = window._originalSetItem || localStorage.setItem;
    rawSet.call(localStorage, TIMESTAMPS_KEY, JSON.stringify(ts));
  }

  // Intercept localStorage writes
  function interceptStorage() {
    if (window._originalSetItem) return;
    window._originalSetItem = localStorage.setItem;

    localStorage.setItem = function(key, value) {
      window._originalSetItem.apply(this, arguments);

      if (SYNC_KEYS.has(key)) {
        setLocalTimestamp(key, new Date().toISOString());
        queueSync(key);
      }
    };
  }

  async function getValidUser() {
    if (window.Auth && window.Auth.getUser && window.Auth.getUser()?.id) {
      return window.Auth.getUser();
    }
    if (supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          return session.user;
        }
      } catch (e) {
        console.warn("[SyncEngine] getSession error:", e);
      }
    }
    return null;
  }

  function isDefaultSeed(projects) {
    if (!Array.isArray(projects) || projects.length !== 1) return false;
    const p = projects[0];
    if (!p) return false;
    if (p.id === "project-ppl6" || p.id === "project-seed" || p.name === "6-Day PPL x2" || p.name === "My Workout Project") {
      const hasCompletedLogs = (p.days || []).some(d =>
        (d.exercises || []).some(ex =>
          (ex.logs || []).some(l => l.completed || (l.values && (l.values.weight || l.values.reps)))
        )
      );
      return !hasCompletedLogs;
    }
    return false;
  }

  const NUMERIC_KEYS = new Set([
    "bodyWeight", "bodyWaist", "bodyChest", "bodyArm", "completionPct", "workoutDurationMin",
    "targetWeightKg", "targetEffectiveWeightKg", "targetRepsMin", "targetRepsMax", "targetRir",
    "loggedSets", "recordedTotalSec", "pulleyRatio", "sets", "number", "weekday",
    "weightRaw", "weightKg", "effectiveWeightKg", "volumeKg", "recordedSeconds",
    "restPlannedSec", "restExtraSec", "restBalanceSec", "restDefaultDelaySec", "restTotalAfterBalancingSec"
  ]);

  function sanitizeForSync(key, val) {
    if (key !== "gymcoach_projects_v4" || !Array.isArray(val)) return val;
    return val.map(p => {
      if (!p || typeof p !== "object") return p;
      const copy = { ...p };
      if (Array.isArray(copy.days)) {
        copy.days = copy.days.map(d => {
          if (!d || typeof d !== "object") return d;
          const dayCopy = { ...d };
          NUMERIC_KEYS.forEach(k => {
            if (dayCopy[k] === "" || dayCopy[k] === undefined) dayCopy[k] = null;
          });
          if (Array.isArray(dayCopy.exercises)) {
            dayCopy.exercises = dayCopy.exercises.map(ex => {
              if (!ex || typeof ex !== "object") return ex;
              const exCopy = { ...ex };
              NUMERIC_KEYS.forEach(k => {
                if (exCopy[k] === "" || exCopy[k] === undefined) exCopy[k] = null;
              });
              if (Array.isArray(exCopy.logs)) {
                exCopy.logs = exCopy.logs.map(log => {
                  if (!log || typeof log !== "object") return log;
                  const logCopy = { ...log };
                  NUMERIC_KEYS.forEach(k => {
                    if (logCopy[k] === "" || logCopy[k] === undefined) logCopy[k] = null;
                  });
                  if (logCopy.values && typeof logCopy.values === "object") {
                    const vals = { ...logCopy.values };
                    NUMERIC_KEYS.forEach(k => {
                      if (vals[k] === "" || vals[k] === undefined) vals[k] = null;
                    });
                    logCopy.values = vals;
                  }
                  return logCopy;
                });
              }
              return exCopy;
            });
          }
          return dayCopy;
        });
      }
      return copy;
    });
  }

  function queueSync(key) {
    if (!SYNC_KEYS.has(key)) return;
    syncQueue.add(key);

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flushSync, 1500); // Debounce 1.5s
  }

  async function flushSync() {
    const user = await getValidUser();
    if (!user || !supabase) return;
    if (syncQueue.size === 0) return;

    if (isSyncing) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 1500);
      return;
    }

    isSyncing = true;
    const keysToSync = Array.from(syncQueue);
    syncQueue.clear();

    const rawSet = window._originalSetItem || localStorage.setItem;

    for (const key of keysToSync) {
      if (!SYNC_KEYS.has(key)) continue;
      const val = localStorage.getItem(key);
      if (val === null) continue;

      try {
        let jsonVal = null;
        try { jsonVal = JSON.parse(val); } catch { jsonVal = val; }

        if (key.includes("active") && typeof jsonVal !== "object") {
          jsonVal = { value: jsonVal };
        } else if (key === "gymcoach_projects_v4") {
          jsonVal = sanitizeForSync(key, jsonVal);
        }

        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from("sync_data")
          .upsert({
            user_id: user.id,
            storage_key: key,
            value: jsonVal,
            updated_at: nowIso
          }, { onConflict: "user_id, storage_key" });

        if (error) throw error;
        setLocalTimestamp(key, nowIso);
        console.log(`[SyncEngine] Synced ${key} to cloud.`);
      } catch (err) {
        console.error(`[SyncEngine] Failed to sync ${key}:`, err);
        syncQueue.add(key);
      }
    }

    isSyncing = false;
    if (syncQueue.size > 0) {
      syncTimer = setTimeout(flushSync, 3000);
    }
  }

  // Initial and recurring sync
  async function syncNow() {
    if (isSyncing) return;
    const user = await getValidUser();
    if (!user || !supabase) return;

    isSyncing = true;
    console.log("[SyncEngine] Checking remote sync...");

    try {
      const { data: cloudData, error } = await supabase
        .from("sync_data")
        .select("*")
        .eq("user_id", user.id);

      if (error) throw error;

      const localTimestamps = getLocalTimestamps();
      const rawSet = window._originalSetItem || localStorage.setItem;
      const cloudMap = {};

      for (const row of (cloudData || [])) {
        if (SYNC_KEYS.has(row.storage_key)) {
          cloudMap[row.storage_key] = row;
        }
      }

      const allKeys = new Set([
        ...Object.keys(cloudMap),
        ...Array.from(SYNC_KEYS).filter(k => localStorage.getItem(k) !== null)
      ]);

      let updatedLocal = false;
      let pulledProjects = null;
      let pulledActiveId = null;

      for (const key of allKeys) {
        const cRow = cloudMap[key];
        const localVal = localStorage.getItem(key);
        const localTs = localTimestamps[key];

        let parsedLocal = null;
        if (localVal) {
          try { parsedLocal = JSON.parse(localVal); } catch { parsedLocal = localVal; }
        }

        // Case A: Cloud has data and (local is missing OR local is just the default seed project)
        if (cRow && (!localVal || (key === "gymcoach_projects_v4" && isDefaultSeed(parsedLocal)))) {
          console.log(`[SyncEngine] Pulling ${key} from cloud (local was empty or default seed)...`);
          let valToStore = cRow.value;
          if (key.includes("active") && valToStore && valToStore.value !== undefined) {
            valToStore = valToStore.value;
            rawSet.call(localStorage, key, valToStore);
            pulledActiveId = valToStore;
          } else {
            rawSet.call(localStorage, key, typeof valToStore === "string" ? valToStore : JSON.stringify(valToStore));
            if (key === "gymcoach_projects_v4") pulledProjects = valToStore;
          }
          setLocalTimestamp(key, cRow.updated_at);
          updatedLocal = true;
        }
        // Case B: Both have data -> Last Write Wins
        else if (localVal && cRow) {
          const cTime = new Date(cRow.updated_at).getTime();
          const lTime = localTs ? new Date(localTs).getTime() : 0;

          if (cTime > lTime) {
            console.log(`[SyncEngine] Cloud data newer for ${key}, pulling...`);
            let valToStore = cRow.value;
            if (key.includes("active") && valToStore && valToStore.value !== undefined) {
              valToStore = valToStore.value;
              rawSet.call(localStorage, key, valToStore);
              pulledActiveId = valToStore;
            } else {
              rawSet.call(localStorage, key, typeof valToStore === "string" ? valToStore : JSON.stringify(valToStore));
              if (key === "gymcoach_projects_v4") pulledProjects = valToStore;
            }
            setLocalTimestamp(key, cRow.updated_at);
            updatedLocal = true;
          } else if (lTime > cTime) {
            console.log(`[SyncEngine] Local data newer for ${key}, queuing push...`);
            queueSync(key);
          }
        }
        // Case C: Local has data, cloud missing -> push
        else if (localVal && !cRow) {
          console.log(`[SyncEngine] Cloud missing ${key}, queuing push...`);
          queueSync(key);
        }
      }

      if (updatedLocal) {
        if (pulledProjects && window.Store?.replaceAll) {
          window.Store.replaceAll(pulledProjects, pulledActiveId);
        }
        if (window.GymCoach?.renderAll) {
          window.GymCoach.renderAll();
        }
        window.dispatchEvent(new CustomEvent("gymcoach:remotesync"));
      }

    } catch (err) {
      console.error("[SyncEngine] Sync failed:", err);
    } finally {
      isSyncing = false;
    }

    if (syncQueue.size > 0) {
      flushSync();
    }
  }

  function setupRealtime(userId) {
    if (!supabase || realtimeChannel) return;
    try {
      realtimeChannel = supabase
        .channel(`sync_data_realtime_${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sync_data", filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new;
            if (!row || !SYNC_KEYS.has(row.storage_key)) return;
            const localTs = getLocalTimestamps()[row.storage_key];
            const cTime = new Date(row.updated_at).getTime();
            const lTime = localTs ? new Date(localTs).getTime() : 0;
            if (cTime > lTime) {
              console.log(`[SyncEngine] Realtime update for ${row.storage_key}, applying...`);
              let valToStore = row.value;
              let pulledActive = null;
              if (row.storage_key.includes("active") && valToStore && valToStore.value !== undefined) {
                valToStore = valToStore.value;
                pulledActive = valToStore;
              }
              const strVal = typeof valToStore === "string" ? valToStore : JSON.stringify(valToStore);
              const rawSet = window._originalSetItem || localStorage.setItem;
              rawSet.call(localStorage, row.storage_key, strVal);
              setLocalTimestamp(row.storage_key, row.updated_at);

              if (row.storage_key === "gymcoach_projects_v4" && window.Store?.replaceAll) {
                window.Store.replaceAll(row.value, pulledActive);
              }
              if (window.GymCoach?.renderAll) {
                window.GymCoach.renderAll();
              }
              window.dispatchEvent(new CustomEvent("gymcoach:remotesync"));
            }
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[SyncEngine] Realtime channel connected for instant cross-device sync.");
          }
        });
    } catch (e) {
      console.warn("[SyncEngine] Realtime setup error:", e);
    }
  }

  function init() {
    supabase = window.supabaseClient;
    interceptStorage();

    // Listen to Supabase auth events
    if (supabase) {
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
          if (session?.user) {
            setupRealtime(session.user.id);
          }
          setTimeout(syncNow, 500);
        }
      });
    }

    // Trigger sync when page becomes visible or focused (e.g. phone screen unlocked or switched tab)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncNow();
      }
    });

    window.addEventListener("focus", () => syncNow());
    window.addEventListener("online", () => syncNow());

    // Recurring background sync every 30s while page is visible
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        if (document.visibilityState === "visible") {
          syncNow();
        }
      }, 30000);
    }

    // Immediate check
    setTimeout(syncNow, 600);
  }

  return { init, syncNow, flushSync, queueSync };
})();

document.addEventListener("DOMContentLoaded", () => {
  SyncEngine.init();
});
