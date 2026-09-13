// js/supabaseClient.js
const SUPABASE_URL = 'https://zxirntfsigasqcpkalic.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4aXJudGZzaWdhc3FjcGthbGljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMzI1MzgsImV4cCI6MjEwNDgwODUzOH0._bhsiHoBZPC6HwRxOmDFO6cJtTs6OHEO_rmknqRHjGo';

const noRemember = sessionStorage.getItem("gymcoach_no_remember") === "true";

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: noRemember ? window.sessionStorage : window.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
