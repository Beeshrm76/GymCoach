// settings.js - branding, the optional live AI connection, install/offline plumbing
// and storage tools.
//
// Everything here is device-local. The API key is written to this browser's
// localStorage and sent only to the endpoint you choose; the app has no backend and
// uploads nothing on its own.
//
//
window.Settings = (() => {
  const $ = id => document.getElementById(id);
  const KEY = "gymcoach_settings_v4";

  const DEFAULTS = {
    provider: "anthropic",
    apiKey: "",
    model: "claude-3-5-sonnet-20241022",
    endpoint: "",
    system: "You are an experienced strength and hypertrophy coach. Be specific, cite the logged sets you reason from, and never invent numbers that are not in the data."
  };

  const PROVIDER_PRESETS = {
    anthropic: {
      name: "Anthropic (Claude)",
      defaultEndpoint: "",
      defaultModel: "claude-3-5-sonnet-20241022",
      models: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
      endpointPlaceholder: "Direct Anthropic API (https://api.anthropic.com/v1)",
      modelPlaceholder: "claude-3-5-sonnet-20241022",
      keyPlaceholder: "sk-ant-...",
      hint: "Direct Anthropic Claude API. GymCoach sends CORS header 'anthropic-dangerous-direct-browser-access'.",
      hideEndpoint: true
    },
    openai: {
      name: "OpenAI",
      defaultEndpoint: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
      endpointPlaceholder: "https://api.openai.com/v1",
      modelPlaceholder: "gpt-4o",
      keyPlaceholder: "sk-proj-...",
      hint: "Official OpenAI Chat Completions API. Base URL defaults to https://api.openai.com/v1.",
      hideEndpoint: false
    },
    gemini: {
      name: "Google Gemini",
      defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
      endpointPlaceholder: "https://generativelanguage.googleapis.com/v1beta/openai/",
      modelPlaceholder: "gemini-2.0-flash",
      keyPlaceholder: "AIzaSy...",
      hint: "Google Gemini via official OpenAI-compatible endpoint. Get an API key from Google AI Studio.",
      hideEndpoint: false
    },
    groq: {
      name: "Groq",
      defaultEndpoint: "https://api.groq.com/openai/v1",
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"],
      endpointPlaceholder: "https://api.groq.com/openai/v1",
      modelPlaceholder: "llama-3.3-70b-versatile",
      keyPlaceholder: "gsk_...",
      hint: "Ultra-low-latency LPU inference for Llama and DeepSeek models.",
      hideEndpoint: false
    },
    deepseek: {
      name: "DeepSeek",
      defaultEndpoint: "https://api.deepseek.com",
      defaultModel: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"],
      endpointPlaceholder: "https://api.deepseek.com",
      modelPlaceholder: "deepseek-chat",
      keyPlaceholder: "sk-...",
      hint: "DeepSeek V3 / R1 reasoning models via official OpenAI-compatible API.",
      hideEndpoint: false
    },
    xai: {
      name: "xAI (Grok)",
      defaultEndpoint: "https://api.x.ai/v1",
      defaultModel: "grok-2-latest",
      models: ["grok-2-latest", "grok-beta"],
      endpointPlaceholder: "https://api.x.ai/v1",
      modelPlaceholder: "grok-2-latest",
      keyPlaceholder: "xai-...",
      hint: "xAI Grok models via OpenAI-compatible endpoint.",
      hideEndpoint: false
    },
    openrouter: {
      name: "OpenRouter",
      defaultEndpoint: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude-3.5-sonnet",
      models: ["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct", "google/gemini-2.0-flash-001", "deepseek/deepseek-r1"],
      endpointPlaceholder: "https://openrouter.ai/api/v1",
      modelPlaceholder: "anthropic/claude-3.5-sonnet",
      keyPlaceholder: "sk-or-...",
      hint: "Unified gateway routing to hundreds of frontier and open-source models.",
      hideEndpoint: false
    },
    mistral: {
      name: "Mistral AI",
      defaultEndpoint: "https://api.mistral.ai/v1",
      defaultModel: "mistral-small-latest",
      models: ["mistral-small-latest", "mistral-large-latest", "codestral-latest"],
      endpointPlaceholder: "https://api.mistral.ai/v1",
      modelPlaceholder: "mistral-small-latest",
      keyPlaceholder: "...",
      hint: "Mistral AI official endpoint.",
      hideEndpoint: false
    },
    perplexity: {
      name: "Perplexity",
      defaultEndpoint: "https://api.perplexity.ai",
      defaultModel: "sonar-pro",
      models: ["sonar-pro", "sonar", "sonar-reasoning"],
      endpointPlaceholder: "https://api.perplexity.ai",
      modelPlaceholder: "sonar-pro",
      keyPlaceholder: "pplx-...",
      hint: "Perplexity online search and reasoning models.",
      hideEndpoint: false
    },
    together: {
      name: "Together AI",
      defaultEndpoint: "https://api.together.xyz/v1",
      defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-R1"],
      endpointPlaceholder: "https://api.together.xyz/v1",
      modelPlaceholder: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      keyPlaceholder: "...",
      hint: "High-speed cloud inference for open-source AI models.",
      hideEndpoint: false
    },
    cohere: {
      name: "Cohere",
      defaultEndpoint: "https://api.cohere.com/v2",
      defaultModel: "command-r-plus",
      models: ["command-r-plus", "command-r"],
      endpointPlaceholder: "https://api.cohere.com/v2",
      modelPlaceholder: "command-r-plus",
      keyPlaceholder: "...",
      hint: "Cohere Command models API.",
      hideEndpoint: false
    },
    custom: {
      name: "My own proxy",
      defaultEndpoint: "",
      defaultModel: "",
      models: [],
      endpointPlaceholder: "https://my-proxy.workers.dev",
      modelPlaceholder: "Custom model identifier (optional)",
      keyPlaceholder: "optional — only if proxy requires authentication",
      hint: "Your own proxy or Cloudflare Worker. POSTs {\"prompt\": \"…\"} and renders reply.",
      hideEndpoint: false
    },
    others: {
      name: "Others (OpenAI-compatible)",
      defaultEndpoint: "",
      defaultModel: "",
      models: ["local-model", "default"],
      endpointPlaceholder: "https://api.provider.com/v1 or http://localhost:11434/v1",
      modelPlaceholder: "Enter model name",
      keyPlaceholder: "API key (or leave empty for local Ollama/LM Studio)",
      hint: "Connect any OpenAI-compatible API (Ollama, LM Studio, vLLM, LocalAI, etc.).",
      hideEndpoint: false
    },
    manual: {
      name: "Manually configure",
      defaultEndpoint: "",
      defaultModel: "",
      models: [],
      endpointPlaceholder: "https://custom-host:port/v1",
      modelPlaceholder: "Custom model ID",
      keyPlaceholder: "Custom authentication token",
      hint: "Manually specify endpoint, model ID, and API key.",
      hideEndpoint: false
    }
  };

  // Models that take adaptive thinking. Older ones use a fixed token budget instead,
  // so sending `thinking` to them is a 400 - we just omit it.
  // Server-side refusal fallback is only offered on the current flagship models.
  const FALLBACK_OK = /^claude-/;

  let state = load();

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
    catch { return { ...DEFAULTS }; }
  }

  const get = () => ({ ...state });

  function set(patch) {
    state = { ...state, ...patch };
    localStorage.setItem(KEY, JSON.stringify(state));
    return get();
  }

  // ----------------------------------------------------------------- modal
  let currentMusicWeekday = "monday";

  function switchTab(tabId) {
    const isMusic = tabId === "music";
    const generalBtn = $("settingsTabBtnGeneral");
    const musicBtn = $("settingsTabBtnMusic");
    const generalTab = $("settingsGeneralTab");
    const musicTab = $("settingsMusicTab");

    if (generalBtn) generalBtn.classList.toggle("active", !isMusic);
    if (musicBtn) musicBtn.classList.toggle("active", isMusic);
    if (generalTab) generalTab.hidden = isMusic;
    if (musicTab) musicTab.hidden = !isMusic;

    if (isMusic) {
      const activeW = window.WorkoutPlayer?.activeWeekday || window.Store?.getWeekdayKey?.() || "monday";
      if (!currentMusicWeekday) currentMusicWeekday = activeW;
      renderMusicSettings();
    }
  }

  function open(section = "general") {
    renderForm();
    renderStorage();
    renderLogoPreview();
    switchTab(section);
    UI.openModal("settingsModal");
  }

  function onProviderChange(p) {
    state.provider = p;
    const preset = PROVIDER_PRESETS[p] || PROVIDER_PRESETS.others;

    // If new preset has a default endpoint, update endpoint input
    if (preset.defaultEndpoint) {
      const isKnownDefault = !state.endpoint || Object.values(PROVIDER_PRESETS).some(pr => pr.defaultEndpoint === state.endpoint);
      if (isKnownDefault) {
        state.endpoint = preset.defaultEndpoint;
        if ($("settingsEndpoint")) $("settingsEndpoint").value = preset.defaultEndpoint;
      }
    }

    // If new preset has a default model, update model input
    if (preset.defaultModel) {
      const isKnownModel = !state.model || Object.values(PROVIDER_PRESETS).some(pr => pr.defaultModel === state.model);
      if (isKnownModel) {
        state.model = preset.defaultModel;
        if ($("settingsModel")) $("settingsModel").value = preset.defaultModel;
      }
    }

    applyProviderVisibility();
    renderModelChips();

    // Persist immediately to localStorage
    set({
      provider: p,
      endpoint: $("settingsEndpoint")?.value || state.endpoint,
      model: $("settingsModel")?.value || state.model
    });
  }

  function renderForm() {
    const pSel = $("settingsProvider");
    if (pSel) pSel.value = state.provider;

    if ($("settingsApiKey")) $("settingsApiKey").value = state.apiKey || "";
    if ($("settingsEndpoint")) $("settingsEndpoint").value = state.endpoint || "";
    if ($("settingsSystem")) $("settingsSystem").value = state.system || DEFAULTS.system;

    const mInput = $("settingsModel");
    if (mInput) {
      mInput.value = state.model || "";
    }

    applyProviderVisibility();
    renderModelChips();
  }

  function renderModelChips() {
    const container = $("settingsModelChips");
    if (!container) return;
    const p = $("settingsProvider")?.value || state.provider;
    const preset = PROVIDER_PRESETS[p];
    if (!preset || !preset.models || !preset.models.length) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }
    container.hidden = false;
    const currentM = $("settingsModel")?.value || state.model;
    container.innerHTML = preset.models.map(m => `
      <button type="button" class="model-chip ${m === currentM ? 'active' : ''}" data-model-val="${m}">
        ${m}
      </button>
    `).join("");

    container.querySelectorAll("[data-model-val]").forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.modelVal;
        if ($("settingsModel")) $("settingsModel").value = val;
        state.model = val;
        set({ model: val });
        renderModelChips();
      };
    });
  }

  function applyProviderVisibility() {
    const p = $("settingsProvider")?.value || state.provider;
    const preset = PROVIDER_PRESETS[p] || PROVIDER_PRESETS.others;
    const isAnthropic = p === "anthropic";

    const endpointRow = $("settingsEndpointRow");
    if (endpointRow) endpointRow.hidden = isAnthropic;

    const endpointInput = $("settingsEndpoint");
    if (endpointInput) endpointInput.placeholder = preset.endpointPlaceholder || "https://api.openai.com/v1";

    const modelInput = $("settingsModel");
    if (modelInput) modelInput.placeholder = preset.modelPlaceholder || "Enter model ID";

    const keyInput = $("settingsApiKey");
    if (keyInput) keyInput.placeholder = preset.keyPlaceholder || "sk-…";

    const hintEl = $("settingsProviderHint");
    if (hintEl) {
      hintEl.textContent = preset.hint || "";
    }
  }

  function toggleApiKeyVisibility() {
    const keyInput = $("settingsApiKey");
    if (!keyInput) return;
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  }

  function saveFromForm() {
    set({
      provider: $("settingsProvider")?.value || state.provider,
      apiKey: $("settingsApiKey")?.value.trim() || "",
      model: $("settingsModel")?.value.trim() || "",
      endpoint: $("settingsEndpoint")?.value.trim() || "",
      system: $("settingsSystem")?.value.trim() || DEFAULTS.system
    });
    UI.toast("Settings saved on this device", "ok");
    UI.closeModal("settingsModal");
  }

  async function testConnection() {
    const btn = $("testConnectionButton");
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Testing…";
    try {
      // Save first so the test uses exactly what the form shows.
      set({
        provider: $("settingsProvider").value,
        apiKey: $("settingsApiKey").value.trim(),
        model: $("settingsModel").value.trim(),
        endpoint: $("settingsEndpoint").value.trim()
      });
      const reply = await callModel("Reply with exactly: GymCoach connection OK.", { maxTokens: 64, think: false });
      UI.toast(reply.trim().slice(0, 60) || "Empty reply", "ok");
    } catch (err) {
      UI.toast(err.message, "error", 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  // ------------------------------------------------------------ model call

  async function callModel(prompt, opts = {}) {
    const s = get();
    if (s.provider === "anthropic") return callAnthropic(s, prompt, opts);
    if (["custom", "others", "manual"].includes(s.provider)) return callCustom(s, prompt);
    return callOpenAI(s, prompt, opts);
  }

  async function callAnthropic(s, prompt, { maxTokens = 16000, think = true } = {}) {
    if (!s.apiKey) throw new Error("No API key set.");
    const model = s.model || DEFAULTS.model;

    const body = {
      model,
      max_tokens: maxTokens,
      system: s.system,
      messages: [{ role: "user", content: prompt }]
    };
    // Adaptive thinking gives a far better programme critique; older models reject it.
    // Route around a safety refusal instead of returning an empty answer.
    const useFallback = FALLBACK_OK.test(model);
    if (useFallback) body.fallbacks = "default";

    const send = withFallback => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": s.apiKey,
        "anthropic-version": "2023-06-01",
        // Required to call the API directly from a browser; without it the request
        // is blocked by CORS with no useful error.
        "anthropic-dangerous-direct-browser-access": "true",
        ...(withFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {})
      },
      body: JSON.stringify(withFallback ? body : (({ fallbacks, ...rest }) => rest)(body))
    });

    let res = await send(useFallback);
    // If this deployment doesn't know the fallback beta, retry plainly rather than
    // failing the whole export in the user's face.
    if (!res.ok && useFallback && res.status === 400) res = await send(false);

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(apiError(res, data));

    if (data.stop_reason === "refusal") {
      throw new Error(`The model declined this request${data.stop_details?.category ? ` (${data.stop_details.category})` : ""}. Try Copy Prompt and paste it into your AI chat instead.`);
    }
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The model returned no text.");
    return data.stop_reason === "max_tokens"
      ? `${text}\n\n[cut off at the ${maxTokens.toLocaleString()}-token limit]`
      : text;
  }

  async function callOpenAI(s, prompt, { maxTokens = 16000 } = {}) {
    if (!s.model) throw new Error("Set a model id for this endpoint.");
    const base = (s.endpoint || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: s.model,
        max_completion_tokens: maxTokens,
        messages: [{ role: "system", content: s.system }, { role: "user", content: prompt }]
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(apiError(res, data));
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("The endpoint returned no text.");
    return text;
  }

  // A proxy you host: keeps the key server-side. Accepts either {"reply": "..."} /
  // {"text": "..."} / {"content": "..."} JSON or plain text.
  async function callCustom(s, prompt) {
    if (!s.endpoint) throw new Error("Set your proxy URL in Settings.");
    const res = await fetch(s.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {})
      },
      body: JSON.stringify({ prompt, model: s.model, system: s.system })
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Proxy returned ${res.status}: ${raw.slice(0, 200)}`);
    try {
      const j = JSON.parse(raw);
      return (j.reply || j.text || j.content || j.output || raw).toString().trim();
    } catch {
      return raw.trim();
    }
  }

  function apiError(res, data) {
    const msg = data?.error?.message || data?.error?.type || data?.message;
    if (msg) return `${res.status}: ${msg}`;
    if (res.status === 401) return "401: that key was rejected.";
    if (res.status === 404) return "404: check the model id and endpoint.";
    if (res.status === 429) return "429: rate limited — wait a moment and retry.";
    return `Request failed with ${res.status}.`;
  }

  // --------------------------------------------------------------- branding

  async function renderLogoPreview() {
    const src = await MediaStore.getLogoURL();
    const box = $("logoPreview");
    if (!box) return;
    box.innerHTML = src
      ? `<img src="${src}" alt="Your logo">`
      : `<span class="muted">No logo — using the default mark</span>`;
    $("resetLogoButton").disabled = !src;
  }

  async function onLogoPicked(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { UI.toast("Pick an image file.", "error"); return; }
    await MediaStore.saveLogo(file);
    await MediaStore.applyLogo();
    await renderLogoPreview();
    UI.toast("Logo updated");
  }

  async function resetLogo() {
    await MediaStore.deleteLogo();
    await MediaStore.applyLogo();
    await renderLogoPreview();
    UI.toast("Logo reset");
  }

  // ---------------------------------------------------------------- storage

  async function renderStorage() {
    const box = $("settingsStorage");
    if (!box) return;
    const projects = Store.all();
    const days = projects.reduce((n, p) => n + p.days.length, 0);
    const ex = projects.reduce((n, p) => n + p.days.reduce((m, d) => m + d.exercises.length, 0), 0);
    let quota = "";
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage != null) {
        quota = ` · ${(est.usage / 1048576).toFixed(1)} MB used`
          + (est.quota ? ` of ~${(est.quota / 1048576 / 1024).toFixed(1)} GB available` : "");
      }
    } catch { /* estimate() is optional */ }
    const media = await MediaStore.listKeys().catch(() => []);
    box.textContent = `${projects.length} projects · ${days} days · ${ex} exercises · ${media.length} media files${quota}`;
  }

  async function clearAllData() {
    if (!await UI.confirm("Erase everything on this device?",
      "Projects, logs, measurements, uploaded images and videos, your logo and your API key. This cannot be undone.")) return;
    if (!await UI.confirm("Really erase everything?", "Export a backup first if you want to keep any of it.",
      { confirmLabel: "Erase it all" })) return;
    for (const p of Store.all()) await MediaStore.purgeProject(p.id).catch(() => {});
    await MediaStore.deleteLogo().catch(() => {});
    // The CSV archive key was missing here, so "Erase everything" left the saved
    // weekly files and pipeline snapshots behind on the device.
    // gymcoach_wearable_v1 holds Amazfit / Zepp imported health data.
    [KEY, Store.keys.projects, Store.keys.active, Store.keys.profile, Store.keys.csvArchives, "gymcoach_layout_v4", "gymcoach_wearable_v1"]
      .forEach(k => localStorage.removeItem(k));
    location.reload();
  }

  // ------------------------------------------------- install / offline (PWA)

  let installPrompt = null;

  function iosLike() {
    const ua = navigator.userAgent || "";
    // iPadOS 13+ reports itself as Macintosh, so touch points are the only tell.
    return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function isInstalled() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true
      || window.navigator.standalone === true;
  }

  // Opens the platform install flow when the browser offers one, and otherwise
  // shows the manual Add-to-Home-Screen steps. Safari on iOS never fires
  // beforeinstallprompt, so for iPhone/iPad the modal IS the install path.
  async function promptInstall() {
    if (isInstalled()) {
      UI.toast("Already installed — you are running the app version.");
      return false;
    }
    if (!installPrompt) {
      UI.openModal("installModal");
      showInstallSteps();
      return false;
    }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    const btn = $("installButton");
    if (btn && outcome === "accepted") btn.hidden = true;
    if (outcome !== "accepted") {
      UI.openModal("installModal");
      showInstallSteps();
    }
    return outcome === "accepted";
  }

  // The modal carries both platforms' steps; only the relevant block is shown.
  function showInstallSteps() {
    const ios = iosLike();
    const iosBlock = $("installStepsIos"), otherBlock = $("installStepsOther");
    if (iosBlock) iosBlock.hidden = !ios;
    if (otherBlock) otherBlock.hidden = ios;
    const state = $("installModalState");
    if (state) {
      state.textContent = isInstalled()
        ? "This device already runs GymCoach as an installed app."
        : ios
          ? "iPhone and iPad install through the Share menu — there is no install button in Safari."
          : installPrompt
            ? "Your browser can install this app directly."
            : "Your browser has not offered a direct install yet; the menu route always works.";
    }
  }

  function wireInstall() {
    const btn = $("installButton");
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      installPrompt = e;
      if (btn) btn.hidden = false;
      window.Home?.render?.();
    });
    window.addEventListener("appinstalled", () => {
      installPrompt = null;
      if (btn) btn.hidden = true;
      UI.toast("Installed — GymCoach now opens like an app");
      window.Home?.render?.();
    });

    // On iOS the button is the only route to the instructions, so show it there
    // even though beforeinstallprompt will never fire.
    if (btn) {
      btn.hidden = !(iosLike() && !isInstalled());
      btn.onclick = () => promptInstall();
    }

    document.querySelectorAll("[data-close-install]").forEach(b =>
      b.onclick = () => UI.closeModal("installModal"));
  }

  function registerServiceWorker() {
    // Service workers are unavailable on file:// - opening index.html directly is a
    // supported way to use the app, so this must fail quietly there.
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("./sw.js").catch(err => console.info("Offline cache unavailable:", err.message));
  }

  // ----------------------------------------------------------- music settings

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function setMusicWeekday(w) {
    currentMusicWeekday = w;
    renderMusicSettings();
  }

  function renderMusicSettings() {
    const w = currentMusicWeekday || "monday";
    const wCapitalized = w.charAt(0).toUpperCase() + w.slice(1);

    // Update weekday pill buttons & counts
    document.querySelectorAll(".weekday-pill-btn").forEach(btn => {
      const day = btn.dataset.musicWeekday;
      btn.classList.toggle("active", day === w);
      const countEl = btn.querySelector(".pill-count");
      if (countEl) {
        const dayTracks = window.WorkoutPlayer?.getPlaylist ? window.WorkoutPlayer.getPlaylist(day) : [];
        const count = dayTracks.length;
        countEl.textContent = count;
        countEl.hidden = count === 0;
      }
    });

    // Update active day chip
    const activeDayEl = $("musicActiveDayText");
    if (activeDayEl) activeDayEl.textContent = `Editing ${wCapitalized} Playlist`;

    // Update form labels & selects
    const ytSelect = $("ytTargetWeekdaySelect");
    if (ytSelect) ytSelect.value = w;

    const uploadLabel = $("uploadSelectedDayLabel");
    if (uploadLabel) uploadLabel.textContent = `to ${wCapitalized}`;

    const titleEl = $("settingsPlaylistTitle");
    if (titleEl) titleEl.textContent = `${wCapitalized} Playlist`;

    // Retrieve playlist for this day
    const tracks = window.WorkoutPlayer?.getPlaylist ? window.WorkoutPlayer.getPlaylist(w) : [];
    const statsEl = $("settingsPlaylistStats");
    if (statsEl) {
      const totalSec = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
      statsEl.textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"} · ${fmtTime(totalSec)} total`;
    }

    // Render track rows
    const listEl = $("settingsPlaylistTracks");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!tracks.length) {
      listEl.innerHTML = `
        <div class="empty-state small music-empty-state">
          <span class="empty-music-icon">🎵</span>
          <b>No tracks for ${wCapitalized} yet</b>
          <p>Extract an MP3 from YouTube above or upload audio files to customize this day's music.</p>
        </div>`;
      return;
    }

    tracks.forEach((track, i) => {
      const row = document.createElement("div");
      row.className = "settings-track-row";

      row.innerHTML = `
        <button class="small-icon-btn track-play-preview-btn" type="button" title="Preview track">
          <span class="preview-icon">▶</span>
        </button>
        <div class="track-row-main">
          <b class="track-row-title">${UI.esc(track.name || "Workout Track")}</b>
          <small class="track-row-meta">
            ${fmtTime(track.duration)}
            <span class="track-source-tag ${track.source === 'youtube' ? 'yt-tag' : 'file-tag'}">
              ${track.source === 'youtube' ? 'YouTube ⚡' : 'Upload 📁'}
            </span>
          </small>
        </div>
        <div class="track-row-actions">
          <button class="small-btn track-download-btn" type="button" title="Download MP3 for local music/${w}/ folder">📥 MP3</button>
          <button class="small-btn danger track-delete-btn" type="button" title="Remove track from this playlist">🗑️</button>
        </div>
      `;

      row.querySelector(".track-play-preview-btn").onclick = () => {
        if (window.WorkoutPlayer) {
          window.WorkoutPlayer.setWeekday(w);
          window.WorkoutPlayer.play(i);
        }
      };

      row.querySelector(".track-download-btn").onclick = () => {
        const p = window.Store?.active ? window.Store.active() : null;
        if (!p) return;
        const filename = `${w}_${(track.name || "track").replace(/[/\\?%*:|"<>]/g, "_")}.mp3`;
        window.MediaStore?.exportAudioFile(p.id, track.id, filename);
        UI.toast(`Downloading ${filename} for music/${w}/`);
      };

      row.querySelector(".track-delete-btn").onclick = async () => {
        if (!await UI.confirm(`Remove "${track.name}"?`, `This removes the song from the ${wCapitalized} playlist.`)) return;
        window.WorkoutPlayer?.deleteSong(track.id, w);
        renderMusicSettings();
      };

      listEl.appendChild(row);
    });
  }

  function wireMusicSettings() {
    // Tab switching
    document.querySelectorAll("[data-settings-tab]").forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.settingsTab);
    });

    // Weekday pills in Settings
    document.querySelectorAll("[data-music-weekday]").forEach(btn => {
      btn.onclick = () => setMusicWeekday(btn.dataset.musicWeekday);
    });

    // YouTube paste button
    $("ytPasteBtn")?.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && $("ytExtractUrl")) {
          $("ytExtractUrl").value = text.trim();
          UI.toast("Pasted link from clipboard");
        }
      } catch {
        UI.toast("Please paste with Ctrl+V", "info");
      }
    });

    // YouTube Extract Button
    $("ytExtractBtn")?.addEventListener("click", async () => {
      const urlInput = $("ytExtractUrl");
      const url = urlInput?.value.trim();
      const statusBox = $("ytExtractStatus");
      const btn = $("ytExtractBtn");

      if (!url) {
        UI.toast("Please enter a YouTube link.", "error");
        return;
      }

      const videoId = window.YouTubeExtractor?.parseYouTubeId(url);
      if (!videoId) {
        UI.toast("Invalid YouTube URL. Please check the link.", "error");
        return;
      }

      const targetWeekday = $("ytTargetWeekdaySelect")?.value || currentMusicWeekday || "monday";
      const bitrate = $("ytBitrateSelect")?.value || "192";

      if (btn) btn.disabled = true;
      if (statusBox) {
        statusBox.hidden = false;
        statusBox.className = "yt-status-box is-loading";
        statusBox.innerHTML = `
          <div class="yt-status-loading">
            <span class="spinner"></span>
            <span id="ytStatusMessage">Connecting to YouTube…</span>
          </div>`;
      }

      const updateStatus = msg => {
        const el = $("ytStatusMessage");
        if (el) el.textContent = msg;
      };

      try {
        const extracted = await window.YouTubeExtractor.extract(url, {
          weekday: targetWeekday,
          bitrate,
          onStatus: updateStatus
        });

        // Add track to player & store
        await window.WorkoutPlayer?.addTrack(extracted, targetWeekday, extracted.blob);

        // Auto-download file for local music/<weekday>/ folder
        const downloadFilename = `music_${targetWeekday}_${extracted.filename}`;
        window.YouTubeExtractor.downloadBlob(extracted.blob, downloadFilename);

        if (statusBox) {
          statusBox.className = "yt-status-box is-success";
          statusBox.innerHTML = `
            <div class="yt-success-wrap">
              <img src="${extracted.thumbnail}" class="yt-thumb-preview" alt="">
              <div class="yt-success-info">
                <b>${UI.esc(extracted.title)}</b>
                <small class="text-success">✓ Saved to ${targetWeekday.toUpperCase()} playlist &amp; downloaded!</small>
                <small class="muted">${fmtTime(extracted.duration)} · ${(extracted.size / 1048576).toFixed(1)} MB</small>
              </div>
              <button class="small-btn primary" id="ytRedownloadBtn" type="button">📥 Re-download MP3</button>
            </div>`;
          $("ytRedownloadBtn")?.addEventListener("click", () => {
            window.YouTubeExtractor.downloadBlob(extracted.blob, downloadFilename);
          });
        }

        if (urlInput) urlInput.value = "";
        setMusicWeekday(targetWeekday);
        UI.toast(`Added "${extracted.title}" to ${targetWeekday.toUpperCase()} playlist!`, "ok");
      } catch (err) {
        console.warn("Extraction error:", err);
        if (statusBox) {
          statusBox.className = "yt-status-box is-error";
          statusBox.innerHTML = `
            <div class="yt-error-wrap">
              <b>Extraction Notice</b>
              <p>${UI.esc(err.message || "Extraction service is busy.")}</p>
              <div class="yt-cmd-box">
                <small>Terminal / yt-dlp direct command for <code>music/${targetWeekday}/</code>:</small>
                <code>yt-dlp -x --audio-format mp3 -o "music/${targetWeekday}/%(title)s.%(ext)s" "${url}"</code>
              </div>
            </div>`;
        }
        UI.toast("Could not convert audio online. See direct options.", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Audio upload file picker
    $("settingsAudioUploadInput")?.addEventListener("change", async e => {
      const files = e.target.files;
      if (!files || !files.length) return;
      const count = await window.WorkoutPlayer?.uploadSongs(files, currentMusicWeekday);
      e.target.value = "";
      if (count > 0) renderMusicSettings();
    });

    // Drag and Drop Zone
    const dropZone = $("audioDropZone");
    if (dropZone) {
      ["dragenter", "dragover"].forEach(ev => {
        dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
      });
      ["dragleave", "drop"].forEach(ev => {
        dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove("drag-over"); });
      });
      dropZone.addEventListener("drop", async e => {
        const files = e.dataTransfer.files;
        if (files && files.length) {
          const count = await window.WorkoutPlayer?.uploadSongs(files, currentMusicWeekday);
          if (count > 0) renderMusicSettings();
        }
      });
    }

    // Clear Day button
    $("settingsClearDayBtn")?.addEventListener("click", async () => {
      const w = currentMusicWeekday || "monday";
      if (!await UI.confirm(`Clear all songs from ${w.toUpperCase()}?`, "This removes all tracks for this weekday.")) return;
      const p = window.Store?.active ? window.Store.active() : null;
      if (p && p.dayPlaylists && Array.isArray(p.dayPlaylists[w])) {
        for (const t of p.dayPlaylists[w]) {
          await window.MediaStore?.deleteAudio(p.id, t.id);
        }
        p.dayPlaylists[w] = [];
        window.Store.save();
        renderMusicSettings();
        window.WorkoutPlayer?.render();
        UI.toast(`Cleared ${w.toUpperCase()} playlist`);
      }
    });

    // Download all MP3s for weekday
    $("settingsDownloadAllBtn")?.addEventListener("click", async () => {
      const w = currentMusicWeekday || "monday";
      const p = window.Store?.active ? window.Store.active() : null;
      const tracks = window.WorkoutPlayer?.getPlaylist ? window.WorkoutPlayer.getPlaylist(w) : [];
      if (!tracks.length || !p) {
        UI.toast(`No tracks in ${w.toUpperCase()} playlist to download.`, "info");
        return;
      }
      UI.toast(`Downloading ${tracks.length} track(s) for music/${w}/…`);
      let delay = 0;
      tracks.forEach(track => {
        setTimeout(() => {
          const filename = `${w}_${(track.name || "track").replace(/[/\\?%*:|"<>]/g, "_")}.mp3`;
          window.MediaStore?.exportAudioFile(p.id, track.id, filename);
        }, delay);
        delay += 600;
      });
    });
  }

  // ----------------------------------------------------------------- wiring

  function init() {
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-action]");
      if (!a) return;
      switch (a.dataset.action) {
        case "open-settings": open(); break;
        case "save-settings": saveFromForm(); break;
        case "test-connection": testConnection(); break;
        case "reset-logo": resetLogo(); break;
        case "clear-all-data": clearAllData(); break;
        case "install-app": promptInstall(); break;
        case "show-install-help": UI.openModal("installModal"); showInstallSteps(); break;
      }
    });
    document.querySelectorAll("[data-close-settings]").forEach(b =>
      b.onclick = () => UI.closeModal("settingsModal"));
    $("settingsProvider")?.addEventListener("change", e => { onProviderChange(e.target.value); });
    $("toggleApiKeyEye")?.addEventListener("click", () => { toggleApiKeyVisibility(); });
    $("logoUploadInput")?.addEventListener("change", e => {
      const f = e.target.files?.[0];
      e.target.value = "";
      onLogoPicked(f);
    });
    wireInstall();
    registerServiceWorker();
    wireMusicSettings();
    MediaStore.applyLogo();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { get, set, open, switchTab, renderMusicSettings, callModel, renderStorage, promptInstall, isInstalled, iosLike };
})();
