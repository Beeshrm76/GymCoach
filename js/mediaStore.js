// mediaStore.js - per-exercise images/videos and the custom app logo, held as
// Blobs in IndexedDB so nothing is uploaded anywhere and nothing needs a server.


window.MediaStore = (() => {
  const DB_NAME = "gymcoach-media-v4";
  const STORE = "blobs";
  let dbPromise = null;
  const urlCache = new Map();   // key -> object URL

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  const mediaKey = (projectId, exerciseId, kind) => `${projectId}::${exerciseId}::${kind}`;

  function tx(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result?.__req ? result.__req.result : true);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function dropCached(key) {
    const url = urlCache.get(key);
    if (url) { URL.revokeObjectURL(url); urlCache.delete(key); }
  }

  async function put(key, blob) {
    dropCached(key);
    await tx("readwrite", store => store.put(blob, key));
    return true;
  }

  async function get(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(key) {
    dropCached(key);
    await tx("readwrite", store => store.delete(key));
    return true;
  }

  async function url(key) {
    if (urlCache.has(key)) return urlCache.get(key);
    let blob = null;
    try { blob = await get(key); } catch { return null; }
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    urlCache.set(key, objectUrl);
    return objectUrl;
  }

  // Deletes every blob belonging to a project (used when a project is deleted).
  async function purgeProject(projectId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        (req.result || [])
          .filter(k => {
            const s = String(k);
            return s.startsWith(`${projectId}::`) || s.startsWith(`desired::${projectId}::`) || s.startsWith(`music::${projectId}::`);
          })
          .forEach(k => { dropCached(k); store.delete(k); });
      };
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  }

  async function listKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // Applies the stored logo to every .brand-logo-img and hides the fallback dot.
  async function applyLogo() {
    const src = await url("app::logo");
    document.querySelectorAll(".brand-logo-img").forEach(img => {
      if (src) { img.src = src; img.hidden = false; } else { img.removeAttribute("src"); img.hidden = true; }
    });
    document.querySelectorAll(".brand-dot").forEach(dot => { dot.style.display = src ? "none" : ""; });
  }

  async function copyAudio(srcProjectId, srcSongId, destProjectId, destSongId) {
    try {
      const blob = await get(`music::${srcProjectId}::${srcSongId}`);
      if (blob) await put(`music::${destProjectId}::${destSongId}`, blob);
    } catch (e) {
      console.warn("Could not copy audio blob:", e);
    }
  }

  async function copyPlaylistMedia(srcProjectId, destProjectId, playlist) {
    if (!Array.isArray(playlist)) return;
    for (const song of playlist) {
      if (song.origId) {
        await copyAudio(srcProjectId, song.origId, destProjectId, song.id);
      }
    }
  }

  return {
    saveImage: (projectId, exId, blob) => put(mediaKey(projectId, exId, "image"), blob),
    getImageURL: (projectId, exId) => url(mediaKey(projectId, exId, "image")),
    deleteImage: (projectId, exId) => remove(mediaKey(projectId, exId, "image")),
    saveVideo: (projectId, exId, blob) => put(mediaKey(projectId, exId, "video"), blob),
    getVideoURL: (projectId, exId) => url(mediaKey(projectId, exId, "video")),
    deleteVideo: (projectId, exId) => remove(mediaKey(projectId, exId, "video")),
    hasMedia: async (projectId, exId, kind) => !!(await get(mediaKey(projectId, exId, kind))),
    // Shared media across projects keyed by exercise slug (e.g. shoulder_press_machine)
    saveMediaBySlug: (slug, kind, blob) => slug ? put(`slug::${slug}::${kind}`, blob) : Promise.resolve(false),
    getMediaBySlugURL: (slug, kind) => slug ? url(`slug::${slug}::${kind}`) : Promise.resolve(null),
    deleteMediaBySlug: (slug, kind) => slug ? remove(`slug::${slug}::${kind}`) : Promise.resolve(false),
    hasMediaBySlug: async (slug, kind) => slug ? !!(await get(`slug::${slug}::${kind}`)) : false,
    saveLogo: blob => put("app::logo", blob),
    deleteLogo: () => remove("app::logo"),
    getLogoURL: () => url("app::logo"),
    // Desired body photos
    saveDesiredImage: (projectId, slotKey, blob) => put(`desired::${projectId}::${slotKey}`, blob),
    getDesiredImageURL: (projectId, slotKey) => url(`desired::${projectId}::${slotKey}`),
    deleteDesiredImage: (projectId, slotKey) => remove(`desired::${projectId}::${slotKey}`),
    hasDesiredImage: async (projectId, slotKey) => !!(await get(`desired::${projectId}::${slotKey}`)),
    // Workout audio tracks
    saveAudio: (projectId, songId, blob) => put(`music::${projectId}::${songId}`, blob),
    getAudioURL: (projectId, songId) => url(`music::${projectId}::${songId}`),
    getAudioBlob: (projectId, songId) => get(`music::${projectId}::${songId}`),
    deleteAudio: (projectId, songId) => remove(`music::${projectId}::${songId}`),
    exportAudioFile: async (projectId, songId, filename = "workout_track.mp3") => {
      try {
        const blob = await get(`music::${projectId}::${songId}`);
        if (!blob) return false;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(objectUrl); a.remove(); }, 1500);
        return true;
      } catch (err) {
        console.warn("Could not export audio file:", err);
        return false;
      }
    },
    copyAudio,
    copyPlaylistMedia,
    applyLogo, purgeProject, listKeys
  };
})();
