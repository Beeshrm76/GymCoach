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

  // ---- modals ------------------------------------------------------------
  function openModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.open")) document.body.classList.remove("no-scroll");
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
    shell()?.classList.toggle("side-collapsed", !!layout.sidebarCollapsed);
    workoutLayout()?.classList.toggle("rail-collapsed", !!layout.railCollapsed);
    document.querySelectorAll("[data-action='toggle-sidebar-collapse']").forEach(b => {
      b.textContent = layout.sidebarCollapsed ? "»" : "«";
      b.title = layout.sidebarCollapsed ? "Expand panel" : "Minimize panel";
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
  function toggleDrawer(force) {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    const open = force === undefined ? !sb.classList.contains("drawer-open") : !!force;
    sb.classList.toggle("drawer-open", open);
    document.querySelector(".drawer-scrim")?.classList.toggle("show", open);
  }

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
    fmtDate, download, copy, layout
  };
})();
