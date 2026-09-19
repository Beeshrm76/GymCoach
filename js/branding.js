// js/branding.js — Unified dynamic branding manager for GymCoach.
// Rebrands the entire system (Main App, Login, Admin, Super Admin) live from cloud settings or cache.

(function () {
  const DEFAULT_BRAND_NAME = "GymCoach";
  const DEFAULT_ACRONYM = "GC";

  function computeAcronym(name) {
    if (!name) return DEFAULT_ACRONYM;
    const clean = name.trim();
    const parts = clean.split(/[\s_-]+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0] + (parts[2] ? parts[2][0] : '')).toUpperCase().slice(0, 3);
    }
    // Handle camelCase / PascalCase like GymCoachX -> GCX
    const uppers = clean.replace(/[^A-Z0-9]/g, '');
    if (uppers.length >= 2) {
      return uppers.slice(0, 3);
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function getBrand() {
    return {
      name: localStorage.getItem('gymcoach_brand_name') || DEFAULT_BRAND_NAME,
      logo: localStorage.getItem('gymcoach_brand_logo') || '',
      welcome: localStorage.getItem('gymcoach_welcome_msg') || ''
    };
  }

  function applyBrand(brandInput) {
    const current = getBrand();
    const name = (brandInput && brandInput.name) ? brandInput.name.trim() : current.name;
    const logo = (brandInput && brandInput.logo !== undefined) ? brandInput.logo : current.logo;
    const welcome = (brandInput && brandInput.welcome !== undefined) ? brandInput.welcome : current.welcome;

    window.__APP_BRAND_NAME__ = name;
    window.__APP_BRAND_LOGO__ = logo;

    // 1. Document Title
    if (document.title) {
      if (document.title.includes('GymCoach')) {
        document.title = document.title.replace(/GymCoach/g, name);
      } else {
        // If already customized, replace the prefix before '—' or '·' or '-'
        const match = document.title.match(/^([^—·-]+)(\s*[—·-].*)$/s);
        if (match) {
          document.title = `${name}${match[2]}`;
        }
      }
    }

    // 2. Meta Tags
    const metaApp = document.querySelector('meta[name="application-name"]');
    if (metaApp) metaApp.content = name;
    const metaApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (metaApple) metaApple.content = name;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && metaDesc.content && metaDesc.content.includes('GymCoach')) {
      metaDesc.content = metaDesc.content.replace(/GymCoach/g, name);
    }

    // 3. Brand Text Elements
    const acronym = computeAcronym(name);

    // Sidebar & Header Brand Texts
    document.querySelectorAll('.brand-text b, .sidebar-brand-inner h2, .showcase-header h2, .auth-mobile-header h1, .brand-name-text, [data-brand-name]').forEach(el => {
      const crown = el.querySelector('.brand-crown');
      el.textContent = name;
      if (crown) el.appendChild(crown);
    });

    // Home button title / aria-label in index.html
    document.querySelectorAll('.brand-home-button').forEach(btn => {
      btn.setAttribute('title', `${name} · Home`);
      btn.setAttribute('aria-label', `${name} · Home`);
    });

    // 4. Brand Logo Image & Acronym Badges
    if (logo) {
      // Set image on all .brand-logo-img
      document.querySelectorAll('.brand-logo-img').forEach(img => {
        img.src = logo;
        img.alt = name;
        img.hidden = false;
      });
      // Hide dots
      document.querySelectorAll('.brand-dot').forEach(dot => dot.style.display = 'none');
      // Replace text inside .login-logo and .sidebar-logo with <img>
      document.querySelectorAll('.login-logo, .sidebar-logo').forEach(el => {
        el.innerHTML = `<img src="${logo}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="${name}">`;
      });
    } else {
      // Fallback: Show clean acronym
      document.querySelectorAll('.brand-logo-img').forEach(img => {
        img.hidden = true;
      });
      document.querySelectorAll('.brand-dot').forEach(dot => {
        dot.style.display = '';
        dot.textContent = acronym;
      });
      document.querySelectorAll('.login-logo, .sidebar-logo').forEach(el => {
        el.textContent = acronym;
      });
    }

    // 5. Welcome Message
    if (welcome) {
      const welcomeDisplay = document.getElementById('welcomeMessageDisplay');
      if (welcomeDisplay) welcomeDisplay.textContent = welcome;
    }
  }

  function setBrand(brand) {
    if (brand.name) localStorage.setItem('gymcoach_brand_name', brand.name.trim());
    if (brand.logo !== undefined) localStorage.setItem('gymcoach_brand_logo', brand.logo || '');
    if (brand.welcome !== undefined) localStorage.setItem('gymcoach_welcome_msg', brand.welcome || '');
    applyBrand(brand);
  }

  let isSyncing = false;
  async function syncFromCloud(client) {
    const sb = client || window.supabaseClient;
    if (!sb || isSyncing) return;
    isSyncing = true;
    try {
      const { data, error } = await sb.from('system_settings').select('*');
      if (!error && Array.isArray(data)) {
        const map = {};
        data.forEach(s => { map[s.key] = s.value; });
        const newBrand = {
          name: map['app_name'] || DEFAULT_BRAND_NAME,
          logo: map['app_logo'] || '',
          welcome: map['welcome_message'] || ''
        };
        setBrand(newBrand);
      }
    } catch (e) {
      // Network or offline — continue using local cache
    } finally {
      isSyncing = false;
    }
  }

  let realtimeSubscribed = false;
  function setupRealtime(client) {
    const sb = client || window.supabaseClient;
    if (!sb || !sb.channel || realtimeSubscribed) return;
    try {
      sb.channel('public:branding_system_settings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, (payload) => {
          if (payload && payload.new && ['app_name', 'app_logo', 'welcome_message'].includes(payload.new.key)) {
            syncFromCloud(sb);
          }
        })
        .subscribe();
      realtimeSubscribed = true;
    } catch (e) {
      // Realtime not supported or disabled
    }
  }

  // Initial immediate pass from cache (zero flicker before HTML rendering completes)
  applyBrand();

  // Run on DOM ready to apply to freshly parsed elements
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyBrand();
      syncFromCloud();
      setupRealtime();
    });
  } else {
    applyBrand();
    syncFromCloud();
    setupRealtime();
  }

  // Expose global API
  window.AppBranding = {
    get: getBrand,
    apply: applyBrand,
    set: setBrand,
    syncFromCloud: syncFromCloud,
    setupRealtime: setupRealtime,
    computeAcronym: computeAcronym
  };

  // ── Global Cookie Consent Banner ──────────────────────────────────
  function initCookieConsent() {
    if (localStorage.getItem('gymcoach_cookie_consent')) return;

    const banner = document.createElement('div');
    banner.id = 'cookieConsentBanner';
    // inline styles mapping to main app variables with fallbacks
    banner.style.cssText = 'position:fixed; bottom:0; left:0; right:0; background:#1e293b; color:var(--text, #e2e8f0); padding:16px 24px; display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; z-index:99999; border-top:1px solid var(--border, #334155); box-shadow: 0 -4px 12px rgba(0,0,0,0.5); font-size:14px;';
    
    banner.innerHTML = `
      <div style="flex:1; min-width:250px; margin-right:20px; margin-bottom:10px;">
        We use essential local storage to keep your workouts synced and accessible offline. We do <strong>not</strong> use tracking or advertising cookies.
        <a href="legal.html#cookies" style="color:var(--accent, #38bdf8); text-decoration:underline; white-space:nowrap;">Learn more</a>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <button id="btnAcceptCookies" style="background:var(--accent, #38bdf8); color:#000; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">Accept</button>
      </div>
    `;
    
    document.body.appendChild(banner);

    document.getElementById('btnAcceptCookies').addEventListener('click', () => {
      localStorage.setItem('gymcoach_cookie_consent', 'accepted');
      banner.style.opacity = '0';
      banner.style.transition = 'opacity 0.3s ease';
      setTimeout(() => banner.remove(), 300);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookieConsent);
  } else {
    initCookieConsent();
  }
})();
