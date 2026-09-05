// youtubeExtractor.js - YouTube Audio & MP3 Extractor for GymCoach
// Extracts audio streams from YouTube URLs for offline workout playlists
// and allows direct downloading to local music/<weekday>/ folders.

window.YouTubeExtractor = (() => {
  // Public conversion and stream extraction endpoints (with fallback order)
  const COBALT_INSTANCES = [
    "https://cobalt-api.kwiatekm.pl/api/json",
    "https://api.wuk.sh/api/json",
    "https://cobalt.canine.tools/api/json",
    "https://api.cobalt.tools/api/json"
  ];

  const INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net/api/v1/videos/",
    "https://invidious.nerdvpn.de/api/v1/videos/",
    "https://invidious.protokolla.fi/api/v1/videos/"
  ];

  function parseYouTubeId(url) {
    if (!url) return null;
    const str = String(url).trim();
    try {
      const parsed = new URL(str.startsWith("http") ? str : "https://" + str);
      if (parsed.hostname.includes("youtu.be")) {
        const id = parsed.pathname.slice(1).split("/")[0];
        if (id && id.length === 11) return id;
      }
      if (parsed.pathname.includes("/shorts/")) {
        const id = parsed.pathname.split("/shorts/")[1]?.split("/")[0]?.split("?")[0];
        if (id && id.length === 11) return id;
      }
      if (parsed.pathname.includes("/embed/")) {
        const id = parsed.pathname.split("/embed/")[1]?.split("/")[0]?.split("?")[0];
        if (id && id.length === 11) return id;
      }
      const v = parsed.searchParams.get("v");
      if (v && v.length === 11) return v;
    } catch { /* fallback to regex */ }

    const match = str.match(/(?:v=|\/|be\/)([0-9A-Za-z_-]{11})(?:\?|&|\/|$)/);
    return match ? match[1] : null;
  }

  // Fetches video metadata via YouTube oEmbed (CORS enabled by Google)
  async function fetchMetadata(videoId) {
    if (!videoId) throw new Error("Invalid YouTube video ID");
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    try {
      const res = await fetch(oembedUrl);
      if (!res.ok) throw new Error(`oEmbed failed with status ${res.status}`);
      const data = await res.json();
      return {
        videoId,
        title: data.title || "YouTube Audio Track",
        author: data.author_name || "Unknown Artist",
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`
      };
    } catch {
      return {
        videoId,
        title: `YouTube Video (${videoId})`,
        author: "Unknown Artist",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`
      };
    }
  }

  // Attempt extraction via Cobalt API instances
  async function tryCobalt(videoUrl, bitrate = "192", onStatus = () => {}) {
    const payload = {
      url: videoUrl,
      downloadMode: "audio",
      audioFormat: "mp3",
      audioBitrate: String(bitrate)
    };

    for (const instance of COBALT_INSTANCES) {
      try {
        onStatus(`Contacting audio engine (${new URL(instance).hostname})…`);
        const res = await fetch(instance, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) continue;
        const data = await res.json();

        // Cobalt returns { status: "redirect" | "tunnel" | "picker", url: "..." }
        const streamUrl = data.url || (data.picker && data.picker[0]?.url);
        if (streamUrl) {
          onStatus("Downloading converted MP3 stream…");
          const audioRes = await fetch(streamUrl);
          if (!audioRes.ok) continue;
          const blob = await audioRes.blob();
          if (blob && blob.size > 10000) {
            return blob;
          }
        }
      } catch (err) {
        console.warn(`Cobalt instance ${instance} failed:`, err);
      }
    }
    return null;
  }

  // Attempt extraction via Invidious audio format streams
  async function tryInvidious(videoId, onStatus = () => {}) {
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        onStatus(`Probing audio streams (${new URL(instance).hostname})…`);
        const res = await fetch(`${instance}${videoId}`);
        if (!res.ok) continue;
        const data = await res.json();
        const formats = data.adaptiveFormats || [];
        // Find highest quality audio stream
        const audioFormat = formats
          .filter(f => f.type && f.type.startsWith("audio/"))
          .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];

        if (audioFormat && audioFormat.url) {
          onStatus("Streaming audio track…");
          const audioRes = await fetch(audioFormat.url);
          if (audioRes.ok) {
            const blob = await audioRes.blob();
            if (blob && blob.size > 10000) return blob;
          }
        }
      } catch (err) {
        console.warn(`Invidious instance ${instance} failed:`, err);
      }
    }
    return null;
  }

  // Measures duration of an audio blob using HTML5 Audio element
  async function probeDuration(blob) {
    return new Promise(resolve => {
      try {
        const tempUrl = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.src = tempUrl;
        audio.onloadedmetadata = () => {
          const d = audio.duration;
          URL.revokeObjectURL(tempUrl);
          resolve(Number.isFinite(d) ? Math.round(d) : 0);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(tempUrl);
          resolve(0);
        };
      } catch {
        resolve(0);
      }
    });
  }

  // Full extraction flow
  async function extract(url, { weekday = "monday", bitrate = "192", onStatus = () => {} } = {}) {
    const videoId = parseYouTubeId(url);
    if (!videoId) throw new Error("Could not parse a valid YouTube video ID from that URL.");

    onStatus("Fetching video info…");
    const meta = await fetchMetadata(videoId);

    onStatus("Extracting audio stream…");
    let blob = await tryCobalt(meta.url, bitrate, onStatus);
    if (!blob) {
      blob = await tryInvidious(videoId, onStatus);
    }

    if (!blob) {
      throw new Error("Online extraction servers are temporarily busy or blocked. Use the direct link or the local yt-dlp option below.");
    }

    onStatus("Processing audio metadata…");
    const duration = await probeDuration(blob);

    // Clean safe filename: "Artist - Title.mp3" or "Title.mp3"
    const safeTitle = (meta.title || "Workout Track").replace(/[/\\?%*:|"<>]/g, "_").trim();
    const filename = `${safeTitle}.mp3`;

    return {
      videoId,
      title: meta.title,
      author: meta.author,
      thumbnail: meta.thumbnail,
      duration,
      blob,
      size: blob.size,
      filename,
      weekday
    };
  }

  // Download blob to user's computer with suggested subfolder path
  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      a.remove();
    }, 1500);
  }

  return {
    parseYouTubeId,
    fetchMetadata,
    extract,
    downloadBlob
  };
})();
