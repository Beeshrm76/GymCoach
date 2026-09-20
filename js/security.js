// js/security.js — GymCoach Enterprise Security Engine
// Handles: CSRF tokens, input sanitization, upload whitelisting (MIME + magic bytes),
// prompt injection defense, AI usage capping, failed login lockouts (5 attempts -> 5 mins),
// security event logging, and secure cookies.

window.Security = (() => {
  const CSRF_STORAGE_KEY = "gymcoach_csrf_token";
  const LOGIN_ATTEMPTS_KEY = "gymcoach_login_lockout";
  const AI_USAGE_KEY = "gymcoach_ai_usage_log";
  const LOCKOUT_THRESHOLD = 5;
  const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  // Size Limits in Bytes
  const SIZE_LIMITS = {
    avatar: 2 * 1024 * 1024,      // 2 MB
    image: 5 * 1024 * 1024,       // 5 MB
    video: 25 * 1024 * 1024,      // 25 MB
    payload: 256 * 1024           // 256 KB
  };

  // AI Usage Caps
  const AI_CAPS = {
    maxPerHour: 10,
    maxPerDay: 30,
    maxTokens: 800
  };

  // Known Prompt Injection Patterns (Case-insensitive)
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|rules)/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
    /you\s+are\s+now\s+(in\s+)?(dan|jailbreak|unfiltered|developer\s+mode)/i,
    /system\s*:\s*override/i,
    /act\s+as\s+(a\s+)?(system\s+administrator|root|sudo|superadmin)/i,
    /output\s+the\s+(entire\s+)?(system\s+prompt|instructions|initial\s+prompt)/i,
    /reveal\s+(your\s+)?(system\s+instructions|system\s+prompt|secret\s+key)/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /```system/i,
    /---\s*END\s+OF\s+SYSTEM/i
  ];

  // Magic Byte Signatures
  const MAGIC_BYTES = {
    jpeg: [0xFF, 0xD8, 0xFF],
    png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    webp_riff: [0x52, 0x49, 0x46, 0x46], // "RIFF"
    webp_marker: [0x57, 0x45, 0x42, 0x50], // "WEBP" at offset 8
    mp4_ftyp: [0x66, 0x74, 0x79, 0x70] // "ftyp" at offset 4
  };

  // ── 1. CSRF Protection ──────────────────────────────────────────

  function getCSRFToken() {
    let token = sessionStorage.getItem(CSRF_STORAGE_KEY);
    if (!token) {
      const arr = new Uint8Array(24);
      window.crypto.getRandomValues(arr);
      token = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    }
    return token;
  }

  function validateCSRFToken(token) {
    if (!token) return false;
    const stored = sessionStorage.getItem(CSRF_STORAGE_KEY);
    return Boolean(stored && stored === token);
  }

  function attachCSRF(form) {
    if (!form) return;
    let input = form.querySelector('input[name="_csrf"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      form.appendChild(input);
    }
    input.value = getCSRFToken();
  }

  // ── 2. Input Sanitization (XSS Defense) ──────────────────────────

  function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/javascript\s*:/gi, '')
      .replace(/data\s*:\s*text\/html/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  function sanitize(data) {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') return sanitizeString(data);
    if (Array.isArray(data)) return data.map(item => sanitize(item));
    if (typeof data === 'object') {
      const result = {};
      for (const [key, val] of Object.entries(data)) {
        result[key] = sanitize(val);
      }
      return result;
    }
    return data;
  }

  // ── 3. Upload Validation (MIME & Magic Bytes) ───────────────────

  async function validateUpload(file, kind = 'image') {
    if (!file) throw new Error("No file provided.");

    // 1. Check File Size
    const limit = SIZE_LIMITS[kind] || SIZE_LIMITS.image;
    if (file.size > limit) {
      const mb = (limit / (1024 * 1024)).toFixed(0);
      throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed limit of ${mb} MB.`);
    }

    // 2. Reject SVG and Executables
    const lowerName = file.name.toLowerCase();
    const forbiddenExts = ['.svg', '.html', '.htm', '.js', '.php', '.exe', '.sh', '.bat', '.cmd', '.vbs', '.scr'];
    if (forbiddenExts.some(ext => lowerName.endsWith(ext))) {
      throw new Error("Invalid file type: executable or script-bearing files are strictly prohibited.");
    }

    // 3. Inspect Magic Bytes
    const buffer = await file.slice(0, 32).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (kind === 'avatar' || kind === 'image') {
      const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
      const isWebp = (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50   // WEBP
      );

      if (!isJpeg && !isPng && !isWebp) {
        throw new Error("Invalid image format: file contents do not match genuine JPEG, PNG, or WebP binary signatures.");
      }
    } else if (kind === 'video') {
      // MP4: 'ftyp' at offset 4
      const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
      if (!isMp4) {
        throw new Error("Invalid video format: file contents do not match a genuine MP4 binary signature.");
      }
    }

    return true;
  }

  // ── 4. Prompt Injection Defense ─────────────────────────────────

  function inspectPrompt(userInput) {
    if (!userInput || typeof userInput !== 'string') {
      return { safe: true, sanitized: "" };
    }

    const trimmed = userInput.trim();

    // Check for injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        logEvent('PROMPT_INJECTION_BLOCKED', { snippet: trimmed.slice(0, 100) });
        return {
          safe: false,
          reason: "Input blocked by AI security guardrails: potential prompt override or jailbreak pattern detected.",
          sanitized: ""
        };
      }
    }

    // Cap length to 4000 characters
    const capped = trimmed.slice(0, 4000);

    // Fence user input inside XML-style delimiters
    const fenced = `<user_data>\n${capped}\n</user_data>`;

    return {
      safe: true,
      sanitized: fenced
    };
  }

  // ── 5. AI Usage Capping & Rate Limiting ──────────────────────────

  function getAIUsage() {
    try {
      return JSON.parse(localStorage.getItem(AI_USAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function checkAICap() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    const history = getAIUsage().filter(ts => ts > oneDayAgo);
    const hourCount = history.filter(ts => ts > oneHourAgo).length;
    const dayCount = history.length;

    if (hourCount >= AI_CAPS.maxPerHour) {
      const oldestInHour = history.filter(ts => ts > oneHourAgo)[0];
      const resetSeconds = Math.ceil((oldestInHour + (60 * 60 * 1000) - now) / 1000);
      return {
        allowed: false,
        reason: `AI hourly usage limit reached (${AI_CAPS.maxPerHour}/hour). Please wait ${resetSeconds}s before making another request.`,
        resetSeconds
      };
    }

    if (dayCount >= AI_CAPS.maxPerDay) {
      const oldestInDay = history[0];
      const resetSeconds = Math.ceil((oldestInDay + (24 * 60 * 60 * 1000) - now) / 1000);
      return {
        allowed: false,
        reason: `AI daily usage limit reached (${AI_CAPS.maxPerDay}/day). Quota resets in ${Math.ceil(resetSeconds / 60)} minutes.`,
        resetSeconds
      };
    }

    return {
      allowed: true,
      remainingHour: AI_CAPS.maxPerHour - hourCount,
      remainingDay: AI_CAPS.maxPerDay - dayCount,
      maxTokens: AI_CAPS.maxTokens
    };
  }

  function recordAIUsage() {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const history = getAIUsage().filter(ts => ts > oneDayAgo);
    history.push(now);
    try {
      localStorage.setItem(AI_USAGE_KEY, JSON.stringify(history));
    } catch (_) {}
  }

  // ── 6. Login Lockout (5 Failed Attempts -> 5 Mins) ───────────────

  function getLockoutData() {
    try {
      return JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveLockoutData(data) {
    try {
      localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function getLockoutStatus(identifier) {
    const id = (identifier || "global").toLowerCase().trim();
    const data = getLockoutData();
    const record = data[id];

    if (!record) return { locked: false, attempts: 0, remainingSeconds: 0 };

    const now = Date.now();
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { locked: true, attempts: record.attempts, remainingSeconds };
    }

    // Lockout expired
    if (record.lockedUntil && record.lockedUntil <= now) {
      delete data[id];
      saveLockoutData(data);
      return { locked: false, attempts: 0, remainingSeconds: 0 };
    }

    return { locked: false, attempts: record.attempts || 0, remainingSeconds: 0 };
  }

  async function recordLoginAttempt(identifier, success) {
    const id = (identifier || "global").toLowerCase().trim();
    const data = getLockoutData();
    const record = data[id] || { attempts: 0, lockedUntil: null };

    if (success) {
      delete data[id];
      saveLockoutData(data);
      return { locked: false };
    }

    record.attempts = (record.attempts || 0) + 1;

    if (record.attempts >= LOCKOUT_THRESHOLD) {
      record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      data[id] = record;
      saveLockoutData(data);

      // Log security event and notify admins
      await logEvent('FAILED_LOGIN_LOCKOUT', {
        identifier: id,
        attempts: record.attempts,
        lockoutDurationSeconds: LOCKOUT_DURATION_MS / 1000
      });

      // Create admin alert in Supabase
      await notifyAdminsOfLockout(id, record.attempts);

      return { locked: true, remainingSeconds: LOCKOUT_DURATION_MS / 1000 };
    }

    data[id] = record;
    saveLockoutData(data);
    return { locked: false, remainingAttempts: LOCKOUT_THRESHOLD - record.attempts };
  }

  async function notifyAdminsOfLockout(identifier, attempts) {
    try {
      if (!window.supabaseClient) return;
      await window.supabaseClient.from('security_alerts').insert({
        alert_type: 'FAILED_LOGIN_LOCKOUT',
        severity: 'HIGH',
        message: `Account locked: ${attempts} consecutive failed login attempts on '${identifier}'. Locked for 5 minutes.`,
        metadata: { identifier, attempts, timestamp: new Date().toISOString() }
      });
    } catch (e) {
      console.warn("Could not dispatch admin security alert:", e.message);
    }
  }

  // ── 7. Security Event Logging ────────────────────────────────────

  async function logEvent(eventType, details = {}) {
    const user = window.Auth?.getUser();
    const event = {
      event_type: eventType,
      user_id: user?.id || null,
      details: details,
      user_agent: navigator.userAgent,
      created_at: new Date().toISOString()
    };

    console.info(`[Security Event: ${eventType}]`, details);

    // Save to local cache
    try {
      const logs = JSON.parse(sessionStorage.getItem("gymcoach_sec_events") || '[]');
      logs.push(event);
      sessionStorage.setItem("gymcoach_sec_events", JSON.stringify(logs.slice(-50)));
    } catch (_) {}

    // Send to Supabase if client is ready
    try {
      if (window.supabaseClient) {
        await window.supabaseClient.from('security_logs').insert(event);
      }
    } catch (e) {
      // Non-blocking
    }
  }

  // ── 8. Secure Cookie Flags ──────────────────────────────────────

  function setCookie(name, value, days = 7) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const isHttps = window.location.protocol === 'https:';
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Strict${isHttps ? '; Secure' : ''}`;
  }

  return {
    getCSRFToken,
    validateCSRFToken,
    attachCSRF,
    sanitize,
    validateUpload,
    inspectPrompt,
    checkAICap,
    recordAIUsage,
    getLockoutStatus,
    recordLoginAttempt,
    logEvent,
    setCookie,
    SIZE_LIMITS,
    AI_CAPS
  };
})();
