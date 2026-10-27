// js/supabaseClient.js
const SUPABASE_URL = 'https://zxirntfsigasqcpkalic.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4aXJudGZzaWdhc3FjcGthbGljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMzI1MzgsImV4cCI6MjEwNDgwODUzOH0._bhsiHoBZPC6HwRxOmDFO6cJtTs6OHEO_rmknqRHjGo';

const dynamicStorage = {
  getItem: (key) => {
    const isNoRemember = sessionStorage.getItem("gymcoach_no_remember") === "true";
    return isNoRemember ? sessionStorage.getItem(key) : localStorage.getItem(key);
  },
  setItem: (key, value) => {
    const isNoRemember = sessionStorage.getItem("gymcoach_no_remember") === "true";
    if (isNoRemember) {
      sessionStorage.setItem(key, value);
      try { localStorage.removeItem(key); } catch (_) {}
    } else {
      localStorage.setItem(key, value);
      try { sessionStorage.removeItem(key); } catch (_) {}
    }
  },
  removeItem: (key) => {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }
};

const sb = window.supabase || (typeof globalThis !== 'undefined' ? globalThis.supabase : null) || (typeof self !== 'undefined' ? self.supabase : null);

if (sb && typeof sb.createClient === 'function') {
  window.supabaseClient = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: dynamicStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  });
} else {
  console.error("Supabase SDK not loaded on window.supabase");
}

