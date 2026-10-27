// mediaCache.js - Persistent high-capacity caching for exercise videos and images
// Uses the standard Cache API (with fallback) so videos/images download once and play offline.

window.MediaCache = (() => {
  const CACHE_NAME = "gymcoach-media-cache-v1";
  const memoryBlobUrls = new Map(); // url -> objectUrl

  function isCacheAvailable() {
    return typeof window !== "undefined" && "caches" in window;
  }

  async function getCache() {
    if (!isCacheAvailable()) return null;
    try {
      return await caches.open(CACHE_NAME);
    } catch (e) {
      console.warn("MediaCache: Cache API open error:", e);
      return null;
    }
  }

  function isEligibleForCache(url) {
    if (!url || typeof url !== "string") return false;
    const clean = url.trim();
    if (!clean) return false;
    // Don't re-cache blob: or data: URLs or YouTube embeds
    if (clean.startsWith("blob:") || clean.startsWith("data:")) return false;
    if (clean.includes("youtube.com") || clean.includes("youtu.be") || clean.includes("vimeo.com")) return false;
    return true;
  }

  /**
   * Retrieves a cached Blob URL for the given video/image URL, or fetches and caches it.
   * If already cached, returns the local blob URL with zero network traffic (enables 100% offline playback).
   */
  async function getOrCache(url) {
    if (!isEligibleForCache(url)) return url;
    const cleanUrl = url.trim();

    // 1. Instant in-memory cache lookup
    if (memoryBlobUrls.has(cleanUrl)) {
      return memoryBlobUrls.get(cleanUrl);
    }

    const cache = await getCache();
    if (cache) {
      try {
        // 2. Check if already stored in Cache API
        const matched = await cache.match(cleanUrl);
        if (matched) {
          const blob = await matched.blob();
          const objUrl = URL.createObjectURL(blob);
          memoryBlobUrls.set(cleanUrl, objUrl);
          return objUrl;
        }

        // 3. Not in cache yet: fetch from network and store in Cache API
        const res = await fetch(cleanUrl, { mode: "cors" });
        if (res.ok) {
          // Clone the response before reading the body (Cache API requirement)
          await cache.put(cleanUrl, res.clone());
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          memoryBlobUrls.set(cleanUrl, objUrl);
          return objUrl;
        }
      } catch (err) {
        // Network error (e.g. offline and not cached yet)
        console.warn("MediaCache: Error fetching/caching", cleanUrl, err.message);
      }
    }

    return cleanUrl;
  }

  async function isCached(url) {
    if (!isEligibleForCache(url)) return false;
    if (memoryBlobUrls.has(url.trim())) return true;
    const cache = await getCache();
    if (!cache) return false;
    try {
      const match = await cache.match(url.trim());
      return !!match;
    } catch {
      return false;
    }
  }

  async function clear() {
    memoryBlobUrls.forEach(u => {
      try { URL.revokeObjectURL(u); } catch (_) {}
    });
    memoryBlobUrls.clear();
    if (isCacheAvailable()) {
      try {
        await caches.delete(CACHE_NAME);
      } catch (_) {}
    }
    return true;
  }

  return {
    getOrCache,
    isCached,
    clear,
    CACHE_NAME
  };
})();
