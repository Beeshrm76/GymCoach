// js/sync.js — Background Cloud Synchronization Engine
// Syncs local storage blobs to Supabase sync_data table based on Last Write Wins

window.SyncEngine = (() => {
  const SYNC_KEYS = [
    "gymcoach_projects_v2",
    "gymcoach_active_v2",
    "gymcoach_profile_v1",
    "gymcoach_wearable_v1",
    "gymcoach_layout_v1",
    "gymcoach_settings",
    "gymcoach_csv_archives"
  ];
  
  const TIMESTAMPS_KEY = "gymcoach_sync_timestamps";

  let syncQueue = new Set();
  let syncTimer = null;
  let isSyncing = false;
  let supabase = null;

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
    // use original so we don't infinitely loop
    window._originalSetItem.call(localStorage, TIMESTAMPS_KEY, JSON.stringify(ts));
  }

  // Intercept localStorage writes
  function interceptStorage() {
    if (window._originalSetItem) return; // already intercepted
    window._originalSetItem = localStorage.setItem;
    
    localStorage.setItem = function(key, value) {
      window._originalSetItem.apply(this, arguments);
      
      if (SYNC_KEYS.includes(key)) {
        setLocalTimestamp(key, new Date().toISOString());
        queueSync(key);
      }
    };
  }

  function queueSync(key) {
    if (!Auth || !Auth.isLoggedIn()) return;
    syncQueue.add(key);
    
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flushSync, 2000); // debounce 2s
  }

  async function flushSync() {
    if (!Auth || !Auth.isLoggedIn() || !supabase) return;
    if (syncQueue.size === 0) return;
    if (isSyncing) {
       syncTimer = setTimeout(flushSync, 2000);
       return;
    }

    isSyncing = true;
    const user = Auth.getUser();
    if (!user) { isSyncing = false; return; }

    const keysToSync = Array.from(syncQueue);
    syncQueue.clear();

    for (let key of keysToSync) {
      const val = localStorage.getItem(key);
      if (!val) continue;

      try {
        let jsonVal = JSON.parse(val);
        // Special case: active key is a string not an object, wrap it
        if (key === "gymcoach_active_v2" && typeof jsonVal !== 'object') {
           jsonVal = { value: jsonVal };
        }

        const { error } = await supabase
          .from('sync_data')
          .upsert({
            user_id: user.id,
            storage_key: key,
            value: jsonVal,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id, storage_key' });

        if (error) throw error;
        console.log(`Synced ${key} to cloud.`);
      } catch (err) {
        console.error(`Failed to sync ${key}:`, err);
        // re-queue
        syncQueue.add(key);
      }
    }

    isSyncing = false;
    
    if (syncQueue.size > 0) {
      syncTimer = setTimeout(flushSync, 2000);
    }
  }

  // Initial Sync on load/login
  async function performInitialSync() {
    if (!Auth || !Auth.isLoggedIn() || !supabase) return;
    const user = Auth.getUser();
    if (!user) return;

    console.log("Starting initial sync...");
    
    try {
      const { data: cloudData, error } = await supabase
        .from('sync_data')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      const localTimestamps = getLocalTimestamps();
      let reloadedNeeded = false;

      // Map cloud data
      const cloudMap = {};
      for (let row of cloudData) {
         cloudMap[row.storage_key] = row;
      }

      for (let key of SYNC_KEYS) {
        const cRow = cloudMap[key];
        const localVal = localStorage.getItem(key);
        const localTs = localTimestamps[key];

        if (!localVal && cRow) {
          // Device has no data for this key, use Cloud
          console.log(`Pulling ${key} from cloud (empty local)...`);
          let valToStore = cRow.value;
          if (key === "gymcoach_active_v2" && valToStore.value !== undefined) {
             valToStore = valToStore.value;
             window._originalSetItem.call(localStorage, key, valToStore);
          } else {
             window._originalSetItem.call(localStorage, key, JSON.stringify(valToStore));
          }
          setLocalTimestamp(key, cRow.updated_at);
          reloadedNeeded = true;
        } 
        else if (localVal && cRow) {
          // Both have data. Last Write Wins.
          const cTime = new Date(cRow.updated_at).getTime();
          const lTime = localTs ? new Date(localTs).getTime() : 0; // If no local ts, cloud wins

          if (cTime > lTime) {
            console.log(`Cloud data newer for ${key}, pulling...`);
            let valToStore = cRow.value;
            if (key === "gymcoach_active_v2" && valToStore.value !== undefined) {
               valToStore = valToStore.value;
               window._originalSetItem.call(localStorage, key, valToStore);
            } else {
               window._originalSetItem.call(localStorage, key, JSON.stringify(valToStore));
            }
            setLocalTimestamp(key, cRow.updated_at);
            reloadedNeeded = true;
          } else if (lTime > cTime) {
            // Local is newer, push to cloud
            console.log(`Local data newer for ${key}, queuing sync...`);
            queueSync(key);
          }
        }
        else if (localVal && !cRow) {
          // Local has data, cloud doesn't. Push.
          console.log(`Cloud missing ${key}, queuing sync...`);
          queueSync(key);
        }
      }

      if (reloadedNeeded) {
        // If we pulled new projects or profile, a reload is safest to reset the Store state.
        // Wait 500ms to allow logs to flush
        setTimeout(() => location.reload(), 500);
      }

    } catch (err) {
      console.error("Initial sync failed:", err);
    }
  }

  function init() {
    supabase = window.supabaseClient;
    interceptStorage();
    
    // Listen for auth events to trigger initial sync
    if (window.supabaseClient) {
       window.supabaseClient.auth.onAuthStateChange((event, session) => {
         if (event === 'SIGNED_IN') {
           setTimeout(performInitialSync, 1000);
         }
       });
    }

    // Run initial sync if already logged in on load
    if (Auth && Auth.isLoggedIn()) {
      setTimeout(performInitialSync, 1000);
    }
  }

  return { init, flushSync };
})();

document.addEventListener("DOMContentLoaded", () => {
  // Wait a tick to ensure Auth has initialized
  setTimeout(() => SyncEngine.init(), 100);
});
