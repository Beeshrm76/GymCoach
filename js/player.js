// player.js - Workout Audio Playlist Player
// Offline-first audio player for workouts. Songs are organized by weekdays (Monday-Sunday)
// and stored in IndexedDB (MediaStore).
// In the page, only the clean music media player is shown.
// Uploading, YouTube extraction, and track management live cleanly in Settings.

window.WorkoutPlayer = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => window.UI?.esc ? window.UI.esc(v) : String(v || "");

  let audio = new Audio();
  let currentTrackIndex = -1;
  let isPlaying = false;
  let repeatMode = "all"; // "all" | "one" | "off"
  let isMuted = false;
  let previousVolume = 0.9;
  let currentAudioUrl = null;
  let selectedWeekday = null; // null = auto (follows current day)

  audio.volume = 0.9;

  // Track time formatting: mm:ss
  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  // Returns the currently active weekday key ("monday", "tuesday", etc.)
  function activeWeekday() {
    if (selectedWeekday) return selectedWeekday;
    try {
      const currentDay = window.GymCoach?.day?.();
      if (currentDay?.name) {
        const k = window.Store?.getWeekdayKey(currentDay.name);
        if (k && k !== "general") return k;
      }
    } catch {}
    return window.Store?.getWeekdayKey() || "monday";
  }

  function getPlaylist(weekdayKey) {
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return [];
    const w = weekdayKey || activeWeekday();
    return window.Store?.getDayPlaylist ? window.Store.getDayPlaylist(p, w) : (p.playlist || []);
  }

  function setWeekday(w) {
    if (selectedWeekday === w) return;
    selectedWeekday = w;
    currentTrackIndex = -1;
    audio.pause();
    isPlaying = false;
    render();
  }

  // Audio Event Listeners
  audio.addEventListener("timeupdate", () => {
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;
    const curEl = $("wpbCurrentTime");
    const durEl = $("wpbDuration");
    const slider = $("wpbSeekSlider");
    const metaEl = $("wpbSongMeta");

    if (curEl) curEl.textContent = fmtTime(cur);
    if (durEl) durEl.textContent = fmtTime(dur);
    if (slider && dur > 0 && !slider.matches(":active")) {
      slider.value = (cur / dur) * 100;
    }
    if (metaEl && dur > 0) {
      const w = activeWeekday();
      metaEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)} · ${w.charAt(0).toUpperCase() + w.slice(1)}`;
    }
  });

  audio.addEventListener("ended", () => {
    if (repeatMode === "one") {
      audio.currentTime = 0;
      audio.play().catch(console.warn);
    } else {
      next(repeatMode === "all");
    }
  });

  audio.addEventListener("play", () => {
    isPlaying = true;
    updateUIState();
  });

  audio.addEventListener("pause", () => {
    isPlaying = false;
    updateUIState();
  });

  audio.addEventListener("error", (e) => {
    console.warn("Audio playback error:", e);
    isPlaying = false;
    updateUIState();
    window.UI?.toast?.("Could not play audio track", "error");
  });

  function updateUIState() {
    const playBtn = $("wpbPlayBtn");
    const disc = $("wpbDisc");
    const bar = $("workoutPlayerBar");
    const playlist = getPlaylist();
    const w = activeWeekday();

    if (playBtn) {
      playBtn.innerHTML = isPlaying ? "⏸" : "▶";
      playBtn.title = isPlaying ? "Pause" : "Play";
    }
    if (disc) {
      disc.classList.toggle("is-playing", isPlaying);
    }
    if (bar) {
      // In-page block is always available
      bar.hidden = false;
    }

    // Day badge in player
    const dayBadge = $("wpbDayBadge");
    if (dayBadge) {
      const count = playlist.length;
      dayBadge.textContent = `${w.charAt(0).toUpperCase() + w.slice(1)} (${count})`;
      dayBadge.title = `Current playlist: ${w}. Click to manage in Settings.`;
    }

    const titleEl = $("wpbSongTitle");
    const metaEl = $("wpbSongMeta");
    if (titleEl) {
      if (currentTrackIndex >= 0 && playlist[currentTrackIndex]) {
        titleEl.textContent = playlist[currentTrackIndex].name || "Workout Track";
      } else if (playlist.length > 0) {
        titleEl.textContent = playlist[0].name || "Ready to play";
      } else {
        titleEl.textContent = `No tracks for ${w.charAt(0).toUpperCase() + w.slice(1)}`;
      }
    }
    if (metaEl && (!audio.duration || audio.duration === 0)) {
      metaEl.textContent = playlist.length
        ? `${playlist.length} track${playlist.length === 1 ? "" : "s"} · ${w.charAt(0).toUpperCase() + w.slice(1)}`
        : "Tap ⚙️ to add songs or extract from YouTube";
    }

    // Update any track list rows (e.g. in Settings modal)
    document.querySelectorAll(".playlist-track-row").forEach((row, i) => {
      const isCurrent = i === currentTrackIndex;
      row.classList.toggle("active-track", isCurrent);
      row.classList.toggle("is-playing", isCurrent && isPlaying);
      const icon = row.querySelector(".track-play-icon");
      if (icon) {
        icon.textContent = isCurrent && isPlaying ? "⏸" : "▶";
      }
    });
  }

  async function play(index) {
    const p = window.Store?.active ? window.Store.active() : null;
    const playlist = getPlaylist();
    if (!p) return;

    if (!playlist.length) {
      window.UI?.toast?.("No songs in today's playlist. Add tracks in Settings ➜ Workout Music", "info");
      return;
    }

    if (index < 0 || index >= playlist.length) {
      index = 0;
    }

    currentTrackIndex = index;
    const track = playlist[index];

    try {
      let audioUrl = await window.MediaStore?.getAudioURL(p.id, track.id);
      // Fallback: if track has static relative path (e.g. music/monday/song.mp3)
      if (!audioUrl && track.path) {
        audioUrl = track.path;
      }

      if (!audioUrl) {
        window.UI?.toast?.("Track audio not found in storage", "error");
        return;
      }

      currentAudioUrl = audioUrl;
      audio.src = audioUrl;
      await audio.play();
      isPlaying = true;

      const titleEl = $("wpbSongTitle");
      if (titleEl) titleEl.textContent = track.name || "Workout Track";

      // Setup MediaSession lock screen controls if available
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.name || "Workout Track",
          artist: "GymCoach Playlist",
          album: `${p.name || "Workout"} · ${activeWeekday()}`
        });
        navigator.mediaSession.setActionHandler("play", () => togglePlay());
        navigator.mediaSession.setActionHandler("pause", () => togglePlay());
        navigator.mediaSession.setActionHandler("previoustrack", () => prev());
        navigator.mediaSession.setActionHandler("nexttrack", () => next());
      }
    } catch (err) {
      console.warn("Play error:", err);
      isPlaying = false;
    }

    updateUIState();
  }

  function togglePlay() {
    const playlist = getPlaylist();
    if (!playlist.length) {
      window.UI?.toast?.("No tracks for today. Click ⚙️ to add music in Settings.", "info");
      window.Settings?.open?.("music");
      return;
    }

    if (currentTrackIndex < 0) {
      play(0);
      return;
    }

    if (audio.paused) {
      audio.play().catch(console.warn);
    } else {
      audio.pause();
    }
  }

  function next(loop = true) {
    const playlist = getPlaylist();
    if (!playlist.length) return;
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= playlist.length) {
      if (loop) nextIndex = 0;
      else {
        audio.pause();
        audio.currentTime = 0;
        return;
      }
    }
    play(nextIndex);
  }

  function prev() {
    const playlist = getPlaylist();
    if (!playlist.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    play(prevIndex);
  }

  function seek(pct) {
    if (!audio.duration) return;
    audio.currentTime = (pct / 100) * audio.duration;
  }

  function setVolume(val) {
    audio.volume = Math.max(0, Math.min(1, val));
    isMuted = audio.volume === 0;
    updateVolumeUI();
  }

  function toggleMute() {
    if (isMuted) {
      audio.volume = previousVolume || 0.8;
      isMuted = false;
    } else {
      previousVolume = audio.volume;
      audio.volume = 0;
      isMuted = true;
    }
    updateVolumeUI();
  }

  function updateVolumeUI() {
    const slider = $("wpbVolumeSlider");
    const muteBtn = $("wpbMuteBtn");
    if (slider) slider.value = audio.volume;
    if (muteBtn) muteBtn.innerHTML = audio.volume === 0 ? "🔇" : audio.volume < 0.5 ? "🔉" : "🔊";
  }

  function toggleLoop() {
    const loopBtn = $("wpbLoopBtn");
    if (repeatMode === "all") {
      repeatMode = "one";
      if (loopBtn) {
        loopBtn.innerHTML = "🔂";
        loopBtn.title = "Repeat one";
        loopBtn.classList.add("active-accent");
      }
      window.UI?.toast?.("Repeat current song");
    } else if (repeatMode === "one") {
      repeatMode = "off";
      if (loopBtn) {
        loopBtn.innerHTML = "➡";
        loopBtn.title = "Play once";
        loopBtn.classList.remove("active-accent");
      }
      window.UI?.toast?.("Repeat off");
    } else {
      repeatMode = "all";
      if (loopBtn) {
        loopBtn.innerHTML = "🔁";
        loopBtn.title = "Repeat playlist";
        loopBtn.classList.add("active-accent");
      }
      window.UI?.toast?.("Repeat all songs");
    }
  }

  // Upload user songs to specific weekday (or active weekday)
  async function uploadSongs(files, targetWeekday) {
    if (!files || !files.length) return 0;
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return 0;

    window.Store?.normalize?.(p);
    const w = targetWeekday || activeWeekday();
    if (!p.dayPlaylists[w]) p.dayPlaylists[w] = [];

    let addedCount = 0;
    window.UI?.toast?.(`Uploading ${files.length} track(s) to ${w}…`);

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
        continue;
      }

      const songId = window.Store.uid("song");
      const cleanName = file.name.replace(/\.[^/.]+$/, "");

      let duration = 0;
      try {
        const tempUrl = URL.createObjectURL(file);
        duration = await new Promise(resolve => {
          const probe = new Audio();
          probe.src = tempUrl;
          probe.onloadedmetadata = () => {
            const d = probe.duration;
            URL.revokeObjectURL(tempUrl);
            resolve(Number.isFinite(d) ? Math.round(d) : 0);
          };
          probe.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            resolve(0);
          };
        });
      } catch {
        duration = 0;
      }

      await window.MediaStore?.saveAudio(p.id, songId, file);

      const trackObj = {
        id: songId,
        name: cleanName,
        duration: duration,
        size: file.size,
        type: file.type || "audio/mpeg",
        source: "upload",
        weekday: w,
        path: `music/${w}/${file.name}`,
        addedAt: Date.now()
      };

      p.dayPlaylists[w].push(trackObj);
      if (!p.playlist.some(s => s.id === songId)) {
        p.playlist.push(trackObj);
      }
      addedCount++;
    }

    if (addedCount > 0) {
      window.Store.save();
      render();
      window.UI?.toast?.(`Added ${addedCount} track(s) to ${w.toUpperCase()}`, "ok");
    } else {
      window.UI?.toast?.("Please select valid audio files (.mp3, .wav, .m4a, etc.)", "error");
    }
    return addedCount;
  }

  // Add an individual track (e.g. from YouTube Extractor)
  async function addTrack(trackData, targetWeekday, audioBlob) {
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return null;
    window.Store?.normalize?.(p);

    const w = targetWeekday || activeWeekday();
    if (!p.dayPlaylists[w]) p.dayPlaylists[w] = [];

    const songId = trackData.id || window.Store.uid("song");
    if (audioBlob) {
      await window.MediaStore?.saveAudio(p.id, songId, audioBlob);
    }

    const trackObj = {
      id: songId,
      name: trackData.name || trackData.title || "Workout Track",
      duration: trackData.duration || 0,
      size: trackData.size || (audioBlob ? audioBlob.size : 0),
      type: trackData.type || "audio/mpeg",
      source: trackData.source || "youtube",
      sourceUrl: trackData.url || trackData.sourceUrl || "",
      weekday: w,
      path: `music/${w}/${(trackData.filename || trackData.name || "track")}.mp3`,
      addedAt: Date.now()
    };

    p.dayPlaylists[w].push(trackObj);
    if (!p.playlist.some(s => s.id === songId)) {
      p.playlist.push(trackObj);
    }

    window.Store.save();
    render();
    return trackObj;
  }

  async function deleteSong(songId, targetWeekday) {
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return;
    window.Store?.normalize?.(p);

    const w = targetWeekday || activeWeekday();
    const dayList = p.dayPlaylists?.[w];
    if (Array.isArray(dayList)) {
      const idx = dayList.findIndex(s => s.id === songId);
      if (idx >= 0) dayList.splice(idx, 1);
    }
    const generalIdx = (p.playlist || []).findIndex(s => s.id === songId);
    if (generalIdx >= 0) p.playlist.splice(generalIdx, 1);

    await window.MediaStore?.deleteAudio(p.id, songId);

    const playlist = getPlaylist();
    if (currentTrackIndex >= playlist.length) {
      currentTrackIndex = -1;
      audio.pause();
      audio.src = "";
      isPlaying = false;
    }

    window.Store.save();
    render();
    window.UI?.toast?.("Removed track from playlist");
  }

  function render() {
    updateUIState();
  }

  function init() {
    const playBtn = $("wpbPlayBtn");
    if (playBtn) playBtn.onclick = () => togglePlay();

    const prevBtn = $("wpbPrevBtn");
    if (prevBtn) prevBtn.onclick = () => prev();

    const nextBtn = $("wpbNextBtn");
    if (nextBtn) nextBtn.onclick = () => next();

    const slider = $("wpbSeekSlider");
    if (slider) {
      slider.oninput = (e) => {
        if (audio.duration) {
          const curEl = $("wpbCurrentTime");
          if (curEl) curEl.textContent = fmtTime((e.target.value / 100) * audio.duration);
        }
      };
      slider.onchange = (e) => seek(Number(e.target.value));
    }

    const volSlider = $("wpbVolumeSlider");
    if (volSlider) volSlider.oninput = (e) => setVolume(Number(e.target.value));

    const muteBtn = $("wpbMuteBtn");
    if (muteBtn) muteBtn.onclick = () => toggleMute();

    const loopBtn = $("wpbLoopBtn");
    if (loopBtn) loopBtn.onclick = () => toggleLoop();

    const settingsBtn = $("wpbSettingsBtn");
    if (settingsBtn) settingsBtn.onclick = () => window.Settings?.open?.("music");

    const dayBadge = $("wpbDayBadge");
    if (dayBadge) {
      dayBadge.onclick = () => {
        // Cycle weekdays or open settings
        const keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const cur = activeWeekday();
        const nextIdx = (keys.indexOf(cur) + 1) % keys.length;
        setWeekday(keys[nextIdx]);
        window.UI?.toast?.(`Switched to ${keys[nextIdx].toUpperCase()} playlist`);
      };
    }

    render();
  }

  return {
    init,
    render,
    play,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    uploadSongs,
    addTrack,
    deleteSong,
    getPlaylist,
    setWeekday,
    get activeWeekday() { return activeWeekday(); },
    get currentTrackIndex() { return currentTrackIndex; }
  };
})();
