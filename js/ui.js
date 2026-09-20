// ui.js - shared UI plumbing: toasts, in-app dialogs (replacing alert/confirm/prompt),
// and the collapsible/scrollable panels.
//
window.UI = (() => {
  const $ = id => document.getElementById(id);

  function esc(v = "") {
    return String(v ?? "").replace(/[&<>"']/g, m =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  // ---- toasts ------------------------------------------------------------
  let toastHost = null;
  function toast(message, kind = "ok", ms = 2600) {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "toast-host";
      document.body.appendChild(toastHost);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    setTimeout(() => {
      el.classList.remove("in");
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  // ---- dialogs -----------------------------------------------------------
  function dialog({ title, body, fields = [], confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "modal open dialog-modal";
      wrap.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-card dialog-card" role="dialog" aria-modal="true">
          <div class="modal-header"><div><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div></div>
          <div class="dialog-body">
            ${fields.map((f, i) => f.type === "select"
        ? `<label>${esc(f.label)}<select data-field="${i}">${(f.options || []).map(o =>
          `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`
        : f.type === "textarea"
          ? `<label>${esc(f.label)}<textarea data-field="${i}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></label>`
          : `<label>${esc(f.label)}<input data-field="${i}" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}"></label>`
      ).join("")}
          </div>
          <div class="dialog-actions">
            <button class="btn" data-dialog-cancel>${esc(cancelLabel)}</button>
            <button class="btn ${danger ? "danger-solid" : "primary"}" data-dialog-ok>${esc(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);

      const inputs = [...wrap.querySelectorAll("[data-field]")];
      const finish = value => {
        document.removeEventListener("keydown", onKey);
        wrap.remove();
        resolve(value);
      };
      const collect = () => {
        if (!fields.length) return true;
        const out = {};
        inputs.forEach((el, i) => { out[fields[i].name || i] = el.value.trim(); });
        return out;
      };
      const onKey = e => {
        if (e.key === "Escape") finish(null);
        if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") { e.preventDefault(); finish(collect()); }
      };

      wrap.querySelector("[data-dialog-ok]").onclick = () => finish(collect());
      wrap.querySelector("[data-dialog-cancel]").onclick = () => finish(null);
      wrap.querySelector(".modal-backdrop").onclick = () => finish(null);
      document.addEventListener("keydown", onKey);
      (inputs[0] || wrap.querySelector("[data-dialog-ok]")).focus();
      if (inputs[0]?.select) inputs[0].select();
    });
  }

  const confirm = (title, body, { confirmLabel = "Delete", danger = true } = {}) =>
    dialog({ title, body, confirmLabel, danger }).then(Boolean);

  const prompt = (title, { label = "Value", value = "", placeholder = "", body = "", confirmLabel = "Save" } = {}) =>
    dialog({ title, body, confirmLabel, fields: [{ name: "value", label, value, placeholder }] })
      .then(r => (r ? r.value : null));

  // ---- scroll lock ---------------------------------------------------------
  // Shared by modals and the mobile drawer so they can't clobber each other's
  // lock/unlock. Just toggles a class — the CSS (`overflow:hidden` +
  // `overscroll-behavior:contain`) does the actual work, including stopping
  // iOS Safari from rubber-banding the page behind an overlay. No JS touch
  // interception, no position:fixed, no layout shift.
  let scrollLockCount = 0;

  // The class has to go on <html> as well as <body>: html carries
  // `overflow-x: clip`, and the viewport only inherits body's overflow when
  // html's own overflow is `visible`. With the class on body alone the page
  // kept scrolling behind the drawer/modal.
  let lockedScrollY = 0;

  function lockScroll() {
    if (scrollLockCount === 0) {
      // Pinning the root can drop the page back to the top, so remember
      // where the reader was and put them back on unlock.
      lockedScrollY = window.scrollY || window.pageYOffset || 0;
      document.documentElement.classList.add("no-scroll");
      document.body.classList.add("no-scroll");
    }
    scrollLockCount++;
  }

  function unlockScroll() {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.documentElement.classList.remove("no-scroll");
      document.body.classList.remove("no-scroll");
      // Restore synchronously, before paint, so there's no visible jump.
      window.scrollTo(0, lockedScrollY);
    }
  }

  // ---- modals ------------------------------------------------------------
  function openModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    lockScroll();
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.open")) unlockScroll();
  }

  // ---- collapsible panels ------------------------------------------------
  const LAYOUT_KEY = "gymcoach_layout_v4";
  const layout = (() => {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}"); } catch { return {}; }
  })();
  const saveLayout = () => localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));

  const shell = () => document.querySelector(".app-shell");
  const workoutLayout = () => document.querySelector(".workout-layout");

  function applyLayout() {
    // side-collapsed is a desktop-only concept. Applying it while the phone
    // drawer is in play makes the drawer inherit collapsed-desktop styling
    // it was never designed for, which is what makes opening the drawer look
    // like it's fighting with (or is coupled to) the desktop collapse state.
    const isDesktop = window.innerWidth > 900;
    shell()?.classList.toggle("side-collapsed", isDesktop && !!layout.sidebarCollapsed);
    workoutLayout()?.classList.toggle("rail-collapsed", !!layout.railCollapsed);
    // Update the topbar ☰ button title based on sidebar state
    document.querySelectorAll(".drawer-btn").forEach(b => {
      b.title = layout.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    });
    // Update the brand logo button title
    document.querySelectorAll(".brand-home-button").forEach(b => {
      b.title = layout.sidebarCollapsed ? "Expand sidebar" : "GymCoach · Home";
      b.setAttribute("aria-label", b.title);
    });
    // Update the music panel toggle button title based on rail state
    document.querySelectorAll("[data-action='toggle-rail']").forEach(b => {
      b.title = layout.railCollapsed ? "Expand music player" : "Minimize this panel";
      b.setAttribute("aria-label", b.title);
    });
  }

  function toggleSidebarCollapse(force) {
    layout.sidebarCollapsed = force === undefined ? !layout.sidebarCollapsed : !!force;
    saveLayout();
    applyLayout();
  }

  function toggleRail(force) {
    layout.railCollapsed = force === undefined ? !layout.railCollapsed : !!force;
    saveLayout();
    applyLayout();
  }

  // Mobile drawer is separate from the desktop collapse so the two can't fight.
  // Track our own open/locked state rather than re-deriving it from the DOM,
  // so we never call lockScroll()/unlockScroll() more than once for the same
  // open drawer (that would desync the shared scroll-lock counter).
  let drawerLocked = false;

  function toggleDrawer(force) {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    const open = force === undefined ? !sb.classList.contains("drawer-open") : !!force;
    sb.classList.toggle("drawer-open", open);
    document.querySelector(".drawer-scrim")?.classList.toggle("show", open);

    // Lock body scroll on mobile to prevent background scrolling when sidebar is open.
    // Shares the same lock as modals so opening a dialog from within the drawer
    // (or vice versa) can't cause one to unlock scrolling out from under the other.
    if (open && window.innerWidth <= 900) {
      if (!drawerLocked) { drawerLocked = true; lockScroll(); }
    } else if (drawerLocked) {
      drawerLocked = false;
      unlockScroll();
    }
  }

  // Ensure drawer state is cleaned up if user resizes back to desktop, and
  // re-derive side-collapsed vs drawer-open any time the breakpoint is crossed
  // in either direction (applyLayout() itself decides which applies).
  let touchStartX = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  document.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX;
    if (window.innerWidth > 900) return;
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    
    const isDrawerOpen = sb.classList.contains("drawer-open");
    // Swipe Right to open (only if close to left edge)
    if (!isDrawerOpen && touchStartX < 30 && touchEndX > touchStartX + 50) {
      toggleDrawer(true);
    }
    // Swipe Left to close
    if (isDrawerOpen && touchEndX < touchStartX - 50) {
      toggleDrawer(false);
    }
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      const sb = document.getElementById("sidebar");
      if (sb && sb.classList.contains("drawer-open")) {
        toggleDrawer(false);
      }
    }
    applyLayout();
  });

  // ---- misc --------------------------------------------------------------
  function fmtDate(iso, opts = { month: "short", day: "numeric" }) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, opts);
  }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API needs a secure context; fall back for file:// and http://.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.("copy");
      ta.remove();
      return !!ok;
    }
  }

  document.addEventListener("DOMContentLoaded", applyLayout);

  return {
    esc, toast, dialog, confirm, prompt, openModal, closeModal,
    toggleSidebarCollapse, toggleRail, toggleDrawer, applyLayout,
    lockScroll, unlockScroll,
    fmtDate, download, copy, layout
  };
})();