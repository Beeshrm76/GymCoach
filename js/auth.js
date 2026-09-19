// auth.js — Frontend authentication client.
// Checks session status, shows user info in sidebar, and handles logout.

window.Auth = (() => {
  const SESSION_KEY = "gymcoach_session";

  let currentUser = null;
  let serverAvailable = true;

  const supabase = window.supabaseClient;

  // ── Initialise on load ──────────────────────────────────────

  async function init() {
    loadSystemSettings();

    // Check if we have a cached session.
    try {
      const cached = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (cached) currentUser = cached;
    } catch { /* no cached session */ }

    // Verify with Supabase Auth
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (session && session.user) {
        // Fetch profile to get role, display_name, status, admin_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          currentUser = {
            id: session.user.id,
            email: session.user.email,
            ...profile
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
        } else {
          // If no profile yet
          currentUser = {
            id: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.username,
            display_name: session.user.user_metadata?.display_name || session.user.user_metadata?.username,
            role: session.user.user_metadata?.role || 'USER',
            status: 'ACTIVE'
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
        }
        
        // Ensure user is not suspended
        if (currentUser.status === 'SUSPENDED' || currentUser.status === 'DISABLED') {
           console.warn("User is suspended/disabled.");
           // Optional: auto logout or show persistent warning
           // await logout(); return;
        }

      } else {
        currentUser = null;
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      console.error("Supabase auth error:", e);
      serverAvailable = false;
    }

    // Subscribe to auth state changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        localStorage.removeItem(SESSION_KEY);
        // Clear sync data from memory/local if desired, or keep offline
        renderUserUI();
      } else if (event === 'SIGNED_IN') {
        // init will naturally catch this on next load or we could fetch profile here
      }
    });

    renderUserUI();
    return currentUser;
  }

  // ── UI Rendering ────────────────────────────────────────────

  function renderUserUI() {
    const container = document.getElementById("authUserNav");
    if (!container) return;

    if (currentUser) {
      const initial = (currentUser.display_name || currentUser.username || "U").charAt(0).toUpperCase();
      const name = currentUser.display_name || currentUser.username;
      const roleStr = currentUser.role === 'SUPER_ADMIN' ? 'Super Admin' : 
                      currentUser.role === 'ADMIN' ? 'Admin' : 'User';

      if (document.getElementById("sidebarUserLabel")) {
        document.getElementById("sidebarUserLabel").textContent = "@" + (currentUser.username || name);
      }

      let adminBtns = '';
      if (currentUser.role === 'SUPER_ADMIN') {
        adminBtns += `
          <button class="nav-btn" onclick="window.open('superadmin.html','_blank')" title="Open Super Admin Panel">
            <span class="nav-icon">👑</span>
            <span class="nav-text"><b>Super Admin</b><small>Manage Admins & System</small></span>
          </button>`;
      } else if (currentUser.role === 'ADMIN') {
        adminBtns += `
          <button class="nav-btn" onclick="window.open('admin.html','_blank')" title="Open Admin Panel">
            <span class="nav-icon">🛡</span>
            <span class="nav-text"><b>Admin Panel</b><small>Manage Assigned Users</small></span>
          </button>`;
      }

      let avatarHtml = `<span class="nav-icon auth-avatar">${initial}</span>`;
      if (currentUser.avatar_url) {
        avatarHtml = `<img src="${escHtml(currentUser.avatar_url)}" class="nav-icon auth-avatar" style="border-radius:50%; object-fit:cover;" alt="Avatar">`;
      }

      container.innerHTML = `
        <button class="nav-btn auth-user-btn" data-action="open-user-profile" title="Account: ${name}">
          ${avatarHtml}
          <span class="nav-text">
            <b>${escHtml(name)}</b>
            <small>${roleStr}${serverAvailable ? "" : " · Offline"}</small>
          </span>
        </button>
        ${adminBtns}
        <button class="nav-btn" data-action="auth-logout" title="Sign out">
          <span class="nav-icon">⏻</span>
          <span class="nav-text"><b>Sign Out</b><small>Log out of your account</small></span>
        </button>
      `;

      // Bind logout.
      const logoutBtn = container.querySelector("[data-action='auth-logout']");
      if (logoutBtn) logoutBtn.addEventListener("click", logout);
    } else {
      if (document.getElementById("sidebarUserLabel")) {
        document.getElementById("sidebarUserLabel").textContent = "Home";
      }
      container.innerHTML = `
        <button class="nav-btn" onclick="window.location.href='login.html'" title="Sign In">
          <span class="nav-icon">👤</span>
          <span class="nav-text"><b>Sign In</b><small>Login or create account</small></span>
        </button>
      `;
    }
  }

  // ── Logout ──────────────────────────────────────────────────

  async function logout() {
    try {
      await supabase.auth.signOut();
    } catch { /* Server might not be available */ }
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    // Always redirect to login page when signed out
    window.location.href = "login.html";
  }

  // ── Helpers ─────────────────────────────────────────────────

  function escHtml(s) {
    if (!s) return "";
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  async function loadSystemSettings() {
    try {
      const { data, error } = await supabase.from('system_settings').select('*');
      if (!error && data) {
        const nameSetting = data.find(s => s.key === 'app_name');
        const logoSetting = data.find(s => s.key === 'app_logo');
        const welcomeSetting = data.find(s => s.key === 'welcome_message');
        if (window.AppBranding) {
          window.AppBranding.set({
            name: nameSetting?.value,
            logo: logoSetting?.value,
            welcome: welcomeSetting?.value
          });
        }
        const exSetting = data.find(s => s.key === 'default_exercises');
        if (exSetting && exSetting.value && Array.isArray(exSetting.value) && exSetting.value.length > 0) {
          window.EXERCISE_DB = exSetting.value;
        }
        const modelsSetting = data.find(s => s.key === 'ai_provider_models');
        if (modelsSetting && modelsSetting.value && typeof modelsSetting.value === 'object') {
          window.CUSTOM_PROVIDER_MODELS = modelsSetting.value;
          try { localStorage.setItem('gymcoach_provider_models', JSON.stringify(modelsSetting.value)); } catch(e){}
          if (window.Settings?.updateProviderModels) {
            window.Settings.updateProviderModels(modelsSetting.value);
          }
        }
      }
    } catch { }
  }

  function getUser() { return currentUser; }
  function isRole(r) { return currentUser?.role === r; }
  function isLoggedIn() { return !!currentUser; }
  function isServerAvailable() { return serverAvailable; }

  return { init, getUser, isRole, isLoggedIn, isServerAvailable, logout };
})();

// Auto-init when DOM is ready.
document.addEventListener("DOMContentLoaded", () => Auth.init());
