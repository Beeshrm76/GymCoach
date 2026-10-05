// superadmin.js — Super Admin panel for GymCoach.
// Manages admins, users, exercises (with media uploads), system settings, and support tickets.
document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabaseClient;
  const $ = id => document.getElementById(id);

  // ── Auth Guard ──────────────────────────────────────────────────
  await window.Auth.init();
  if (!window.Auth.isLoggedIn() || !window.Auth.isRole('SUPER_ADMIN')) {
    document.body.innerHTML = "<h2 style='color:white;text-align:center;padding:50px;'>Access Denied. Super Admin only.</h2>";
    setTimeout(() => { window.location.href = "index.html"; }, 2000);
    return;
  }

  // ── Navigation ──────────────────────────────────────────────────
  const navItems = document.querySelectorAll(".nav-item[data-section]");
  const sections = document.querySelectorAll(".admin-section");

  // Mobile Sidebar & Swipe Logic
  const mobileMenuBtn = $("mobileMenuBtn");
  const adminSidebar = $("adminSidebar");
  const adminDrawerScrim = $("adminDrawerScrim");
  
  function toggleAdminSidebar(force) {
    if (!adminSidebar) return;
    const open = force !== undefined ? force : !adminSidebar.classList.contains("open");
    adminSidebar.classList.toggle("open", open);
    adminDrawerScrim?.classList.toggle("show", open);
    if (open) {
      document.body.classList.add("no-scroll");
      document.documentElement.classList.add("no-scroll");
    } else {
      document.body.classList.remove("no-scroll");
      document.documentElement.classList.remove("no-scroll");
    }
  }

  mobileMenuBtn?.addEventListener("click", () => toggleAdminSidebar());
  adminDrawerScrim?.addEventListener("click", () => toggleAdminSidebar(false));

  // Close when clicking nav items on mobile
  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      navItems.forEach(n => n.classList.remove("active"));
      sections.forEach(s => s.style.display = "none");
      btn.classList.add("active");
      const sectionId = "section" + btn.dataset.section.charAt(0).toUpperCase() + btn.dataset.section.slice(1);
      const target = $(sectionId);
      if (target) target.style.display = "block";
      if (window.innerWidth <= 768) toggleAdminSidebar(false);
    });
  });

  // Swipe to open/close
  let touchStartX = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX;
    if (window.innerWidth > 768) return;
    const isDrawerOpen = adminSidebar?.classList.contains("open");
    // Swipe Right to open (only if close to left edge)
    if (!isDrawerOpen && touchStartX < 30 && touchEndX > touchStartX + 50) {
      toggleAdminSidebar(true);
    }
    // Swipe Left to close
    if (isDrawerOpen && touchEndX < touchStartX - 50) {
      toggleAdminSidebar(false);
    }
  }, { passive: true });

  $("adminLogoutBtn")?.addEventListener("click", () => window.Auth.logout());

  // ── Utility ─────────────────────────────────────────────────────
  const esc = s => {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  };

  async function saveSetting(key, value) {
    const { error } = await supabase.from('system_settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
  }

  function toast(msg, type = "success") {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;color:#fff;background:${type === "error" ? "var(--error)" : "var(--success)"};box-shadow:0 4px 24px rgba(0,0,0,.3);animation:fadeIn .3s;`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 3000);
  }

  // ════════════════════════════════════════════════════════════════
  // DASHBOARD & ADMINS & USERS
  // ════════════════════════════════════════════════════════════════

  let cachedAdmins = [];
  let cachedUsers = [];

  // Set user role (RPC set_user_role first, direct update fallback)
  async function setUserRole(userId, newRole) {
    if (!userId) throw new Error("No user specified");
    const roleUpper = (newRole || '').toUpperCase().trim();
    if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(roleUpper)) {
      throw new Error("Invalid role: " + newRole);
    }

    // 1. Try RPC set_user_role first (bypasses client RLS via SECURITY DEFINER)
    try {
      const { data, error: rpcErr } = await supabase.rpc('set_user_role', {
        target_user_id: userId,
        new_role: roleUpper
      });
      if (!rpcErr && (data?.success || data === true)) {
        return { success: true };
      }
      if (rpcErr && rpcErr.message && !rpcErr.message.includes('function') && !rpcErr.message.includes('does not exist')) {
        throw rpcErr;
      }
    } catch (e) {
      if (e?.message && !e.message.includes('function') && !e.message.includes('not found') && !e.message.includes('does not exist')) {
        throw e;
      }
    }

    // 2. Direct profiles table update fallback
    const { error } = await supabase
      .from('profiles')
      .update({ role: roleUpper })
      .eq('id', userId);

    if (error) throw error;
    return { success: true };
  }

  async function loadData() {
    try {
      const { data: users, error } = await supabase.from('profiles').select('*');
      if (error) throw error;

      cachedUsers = users || [];
      const admins = cachedUsers.filter(u => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN');
      const standardUsers = cachedUsers.filter(u => u.role !== 'ADMIN' && u.role !== 'SUPER_ADMIN');
      cachedAdmins = admins;

      $('statTotalUsers').textContent = cachedUsers.length;
      $('statAdmins').textContent = admins.length;

      const currentUserId = window.Auth?.getUser()?.id;

      // Admins table
      const adminsTbody = $('adminsTableBody');
      adminsTbody.innerHTML = admins.length === 0
        ? `<tr><td colspan="5" class="empty-state">No admins found.</td></tr>`
        : admins.map(a => {
            const isSelf = a.id === currentUserId;
            const isSuper = a.role === 'SUPER_ADMIN';
            return `
          <tr>
            <td>
              <b>${esc(a.username)}</b>
              <br><small style="font-family:monospace;color:var(--accent);cursor:pointer;" title="Click to copy Admin UUID" onclick="navigator.clipboard.writeText('${a.id}');toast('Admin ID copied to clipboard!')">📋 ${a.id.slice(0, 8)}... <span style="text-decoration:underline;">copy ID</span></small>
            </td>
            <td>${esc(a.email)}</td>
            <td><span class="role-badge role-${(a.role || 'admin').toLowerCase()}">${esc(a.role)}</span></td>
            <td>${esc(a.status || 'ACTIVE')}</td>
            <td>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                ${!isSelf ? `
                  <button class="btn small-btn primary" onclick="changeRolePrompt('${a.id}', '${a.role}', '${esc(a.username)}', '${esc(a.email)}')">Change Role</button>
                  ${!isSuper ? `<button class="btn small-btn danger" onclick="demoteAdmin('${a.id}', '${esc(a.username)}')">Demote to User</button>` : ''}
                  <button class="btn small-btn" onclick="suspendUser('${a.id}')">${a.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}</button>
                ` : `<small class="muted" style="font-weight:600;">(Current Account)</small>`}
              </div>
            </td>
          </tr>`;
          }).join('');

      // Users table
      const usersTbody = $('usersTableBody');
      usersTbody.innerHTML = standardUsers.length === 0
        ? `<tr><td colspan="5" class="empty-state">No standard users found.</td></tr>`
        : standardUsers.map(u => {
            const assignedAdmin = admins.find(a => a.id === u.admin_id);
            const adminLabel = assignedAdmin ? `@${assignedAdmin.username}` : (u.admin_id ? u.admin_id.slice(0,8)+'...' : 'None');
            return `
          <tr>
            <td>${esc(u.username)}</td>
            <td>${esc(u.email)}</td>
            <td><span class="role-badge role-${(u.role || 'user').toLowerCase()}">${esc(u.role)}</span></td>
            <td><span style="font-weight:${assignedAdmin ? '600' : 'normal'};color:${assignedAdmin ? 'var(--accent)' : 'inherit'};">${esc(adminLabel)}</span></td>
            <td>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn small-btn primary" onclick="changeRolePrompt('${u.id}', '${u.role}', '${esc(u.username)}', '${esc(u.email)}')">Assign Role</button>
                <button class="btn small-btn" onclick="assignAdminPrompt('${u.id}', '${u.admin_id || ''}')">Assign Coach</button>
                <button class="btn small-btn" onclick="viewUserWorkouts('${u.id}', '${esc(u.username)}')">View Data</button>
              </div>
            </td>
          </tr>`;
          }).join('');
    } catch (err) {
      console.error(err);
      toast("Failed to load admin data: " + (err?.message || err), "error");
    }
  }

  window.suspendUser = async (id) => {
    const u = cachedUsers.find(x => x.id === id);
    const newStatus = u?.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    if (!confirm(`${newStatus === 'SUSPENDED' ? 'Suspend' : 'Activate'} user @${u?.username || id}?`)) return;
    const { error } = await supabase.from('profiles').update({ status: newStatus }).eq('id', id);
    if (error) toast(error.message, "error");
    else {
      toast(`User ${newStatus.toLowerCase()} successfully.`);
      loadData();
    }
  };

  window.demoteAdmin = async (id, username) => {
    if (!confirm(`Demote @${username} from Admin back to standard User?`)) return;
    try {
      await setUserRole(id, 'USER');
      toast(`@${username} demoted to standard User role.`);
      loadData();
    } catch (err) {
      toast("Failed to demote admin: " + (err.message || err), "error");
    }
  };

  window.changeRolePrompt = (userId, currentRole = 'USER', username = '', email = '') => {
    const u = cachedUsers.find(x => x.id === userId) || {};
    const un = username || u.username || 'User';
    const em = email || u.email || '';

    $('assignRoleUserId').value = userId;
    $('assignRoleSelect').value = currentRole || 'USER';
    $('assignRoleUserSelectGroup').style.display = 'none';
    $('assignRoleUserInfo').style.display = 'block';
    $('assignRoleTargetUsername').textContent = '@' + un;
    $('assignRoleTargetEmail').textContent = em;
    $('assignRoleModalTitle').textContent = `Assign Role for @${un}`;
    $('assignRoleModalDesc').textContent = 'Select the account role and permissions for this user.';
    $('assignRoleModal')?.classList.add('open');
  };

  window.openCreateAdminModal = () => {
    $('assignRoleUserId').value = '';
    $('assignRoleSelect').value = 'ADMIN';
    $('assignRoleUserInfo').style.display = 'none';
    $('assignRoleUserSelectGroup').style.display = 'block';
    $('assignRoleModalTitle').textContent = 'Assign Admin Role';
    $('assignRoleModalDesc').textContent = 'Select a registered user to promote them to Administrator / Coach.';

    const sel = $('assignRoleUserSelect');
    if (sel) {
      const nonAdmins = cachedUsers.filter(u => u.role !== 'ADMIN' && u.role !== 'SUPER_ADMIN');
      if (nonAdmins.length === 0) {
        sel.innerHTML = `<option value="">No standard users found to promote</option>`;
      } else {
        sel.innerHTML = `<option value="">— Select a user to promote —</option>` +
          nonAdmins.map(u => `<option value="${u.id}">${esc(u.username)} (${esc(u.email)})</option>`).join('');
      }
    }
    $('assignRoleModal')?.classList.add('open');
  };

  $('btnCreateAdmin')?.addEventListener('click', openCreateAdminModal);

  $('btnCancelAssignRole')?.addEventListener('click', () => {
    $('assignRoleModal')?.classList.remove('open');
  });

  $('btnConfirmAssignRole')?.addEventListener('click', async () => {
    const isDropdown = $('assignRoleUserSelectGroup')?.style.display !== 'none';
    const userId = isDropdown ? $('assignRoleUserSelect')?.value : $('assignRoleUserId')?.value;
    const newRole = $('assignRoleSelect')?.value;

    if (!userId) {
      toast("Please select a user.", "error");
      return;
    }

    const btn = $('btnConfirmAssignRole');
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
      await setUserRole(userId, newRole);
      toast(`User role updated to ${newRole} successfully!`);
      $('assignRoleModal')?.classList.remove('open');
      loadData();
    } catch (err) {
      console.error(err);
      toast("Failed to update role: " + (err.message || err), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Role";
    }
  });

  window.assignAdminPrompt = (userId, currentAdminId = '') => {
    $('assignUserId').value = userId;
    const select = $('assignAdminSelect');
    if (select) {
      select.innerHTML = `<option value="">— Unassigned (None) —</option>` +
        cachedAdmins.map(a => `<option value="${a.id}" ${a.id === currentAdminId ? 'selected' : ''}>${esc(a.username)} (${esc(a.email)})</option>`).join('');
    }
    $('assignAdminModal')?.classList.add('open');
  };

  $('btnCancelAssignAdmin')?.addEventListener('click', () => {
    $('assignAdminModal')?.classList.remove('open');
  });

  $('btnConfirmAssignAdmin')?.addEventListener('click', async () => {
    const userId = $('assignUserId')?.value;
    const adminId = $('assignAdminSelect')?.value || null;
    const btn = $('btnConfirmAssignAdmin');
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const { error } = await supabase.from('profiles').update({ admin_id: adminId }).eq('id', userId);
      if (error) throw error;
      toast("Admin coach assigned successfully!");
      $('assignAdminModal')?.classList.remove('open');
      loadData();
    } catch (err) {
      toast("Failed to assign admin: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Assignment";
    }
  });

  // ════════════════════════════════════════════════════════════════
  // EXERCISES MANAGER (Phase 2)
  // ════════════════════════════════════════════════════════════════

  let defaultExercises = [];

  // ── Exercise category/muscle-group inference & normalization ──
  function normalizeKey(str) {
    return (str || '').toLowerCase().replace(/[-_]/g, ' ').trim();
  }

  function inferExerciseType(ex) {
    if (ex?.type && ex.type !== '—') return normalizeKey(ex.type);
    const name = (ex?.name || ex?.exercise_name || '').toLowerCase();
    const aliases = (ex?.aliases || []).join(' ').toLowerCase();
    const text = `${name} ${aliases}`;

    if (window.EXERCISE_DB && Array.isArray(window.EXERCISE_DB)) {
      const match = window.EXERCISE_DB.find(e => 
        e.name.toLowerCase() === name || 
        (e.aliases && e.aliases.some(a => a.toLowerCase() === name))
      );
      if (match?.type) return normalizeKey(match.type);
    }

    if (/(treadmill|running|cycling|bike|elliptical|rower|rowing|stairmaster|jump rope|jump|jumping jack|high knee|butt kick|cardio|sprint|swim|hiit)/i.test(text)) {
      return "cardio";
    }
    if (/(crunch|sit[- ]?up|plank|leg raise|knee raise|dead bug|bird dog|pallof|woodchop|twist|flutter|ab |abs |core)/i.test(text)) {
      return "core";
    }
    if (/(squat|leg press|hack squat|lunge|split squat|leg ext|leg curl|calf|calves|nordic|rdl|romanian deadlift|good morning|hip thrust|glute|donkey kick|abduction|adduction)/i.test(text)) {
      return "legs";
    }
    if (/(bench press|chest press|push[- ]?up|pec fly|dips?|shoulder press|overhead press|ohp|military press|lateral raise|front raise|tricep|skull crusher|pushdown|kickback|jm press|tate press)/i.test(text)) {
      return "push";
    }
    if (/(pull[- ]?up|chin[- ]?up|pulldown|row|curl|shrug|face pull|dead hang|wrist curl|rear delt)/i.test(text)) {
      return "pull";
    }
    return "other";
  }

  function inferExerciseBodyPart(ex) {
    if (ex?.body_part && ex.body_part !== '—') return normalizeKey(ex.body_part);
    const name = (ex?.name || ex?.exercise_name || '').toLowerCase();
    const aliases = (ex?.aliases || []).join(' ').toLowerCase();
    const text = `${name} ${aliases}`;

    if (window.EXERCISE_DB && Array.isArray(window.EXERCISE_DB)) {
      const match = window.EXERCISE_DB.find(e => 
        e.name.toLowerCase() === name || 
        (e.aliases && e.aliases.some(a => a.toLowerCase() === name))
      );
      if (match?.body_part) return normalizeKey(match.body_part);
    }

    if (/(bench press|chest|pec fly|pec deck|push[- ]?up|dip|svend|floor press)/i.test(text)) return "chest";
    if (/(pull[- ]?up|chin[- ]?up|lat pulldown|cable row|barbell row|pendlay|t-bar|dumbbell row|inverted row|hyperextension|rack pull|shrug|face pull)/i.test(text)) return "back";
    if (/(overhead press|shoulder press|lateral raise|front raise|arnold|lu raise|rear delt|band pull apart|arm circle)/i.test(text)) return "shoulders";
    if (/(bicep|curl|preacher|spider curl|bayesian)/i.test(text)) return "biceps";
    if (/(tricep|pushdown|skull crusher|jm press|tate press)/i.test(text)) return "triceps";
    if (/(wrist curl|farmer|dead hang|gripper|plate pinch|forearm)/i.test(text)) return "forearms";
    if (/(squat|leg press|hack squat|leg ext|lunge|split squat|step up|sissy)/i.test(text)) return "quads";
    if (/(deadlift|rdl|romanian deadlift|leg curl|nordic|glute ham|good morning)/i.test(text)) return "hamstrings";
    if (/(hip thrust|glute bridge|kickback|donkey kick|fire hydrant|abduction|adduction|frog pump|hip circle)/i.test(text)) return "glutes";
    if (/(calf|calves|tibialis)/i.test(text)) return "calves";
    if (/(crunch|sit[- ]?up|plank|leg raise|knee raise|ab wheel|v-up|dead bug|bird dog|pallof|woodchop|twist|flutter|core)/i.test(text)) return "core";

    return "full body";
  }

  function matchesFilter(actual, selected) {
    if (!selected) return true;
    const a = normalizeKey(actual);
    const s = normalizeKey(selected);
    if (!a) return false;
    if (a === s) return true;

    // Synonyms & flexible category mappings
    if (s === "quads" && (a === "quadriceps" || a === "quad" || a === "legs front")) return true;
    if (s === "hamstrings" && (a === "hamstring" || a === "hams" || a === "legs back")) return true;
    if (s === "calves" && (a === "calf")) return true;
    if (s === "core" && (a === "abs" || a === "abdominals" || a === "obliques")) return true;
    if (s === "full body" && (a === "full body" || a === "fullbody" || a === "compound" || a === "general")) return true;
    if (s === "legs" && (a === "legs" || a === "quads" || a === "hamstrings" || a === "glutes" || a === "calves" || a === "lower body")) return true;
    if (s === "push" && (a === "push" || a === "chest" || a === "triceps")) return true;
    if (s === "pull" && (a === "pull" || a === "back" || a === "biceps")) return true;
    return false;
  }

  function enrichExercises(list) {
    if (!Array.isArray(list)) return;
    const dbMap = new Map();
    (window.EXERCISE_DB || []).forEach(e => {
      if (e.name) dbMap.set(e.name.toLowerCase().trim(), e);
      (e.aliases || []).forEach(a => dbMap.set(a.toLowerCase().trim(), e));
    });

    list.forEach(ex => {
      const match = dbMap.get((ex.name || '').toLowerCase().trim());
      if (!ex.type || ex.type === '—') {
        ex.type = match?.type || inferExerciseType(ex);
      }
      if (!ex.body_part || ex.body_part === '—') {
        ex.body_part = match?.body_part || inferExerciseBodyPart(ex);
      }
    });
  }

  // ── Load exercises from system_settings ──
  async function loadExercises() {
    try {
      const { data, error } = await supabase.from('system_settings').select('*').eq('key', 'default_exercises').single();
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      defaultExercises = (data?.value && Array.isArray(data.value)) ? data.value : (window.EXERCISE_DB || []);
    } catch (err) {
      console.error("Failed to load exercises:", err);
      defaultExercises = window.EXERCISE_DB || [];
    }
    enrichExercises(defaultExercises);
    renderExercises();
    if ($('statExercises')) $('statExercises').textContent = defaultExercises.length;
  }

  // ── Exercise name → default path helpers ──
  function slugFromName(name) {
    if (!name) return "";
    return name.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }
  function videoPathFromName(name) {
    const slug = slugFromName(name);
    return slug ? `videos/${slug}.mp4` : "";
  }
  function imagePathFromName(name) {
    const slug = slugFromName(name);
    return slug ? `images/${slug}.jpg` : "";
  }
  function isAutoGeneratedPath(path, kind) {
    if (!path || path === 'None') return true;
    const p = path.replace(/\\/g, "/").trim();
    if (!p) return true;
    if (kind === "video") return /^videos\/[a-z0-9_]+(\.mp4)?$/i.test(p);
    if (kind === "image") return /^images\/[a-z0-9_]+(\.(?:jpg|jpeg|png|webp))?$/i.test(p);
    return false;
  }
  function updateExercisePathFieldsFromName(name) {
    const vInd = $("exModalVideoPath"), iInd = $("exModalImagePath");
    if (!vInd || !iInd) return;
    const vPath = videoPathFromName(name), iPath = imagePathFromName(name);
    if (isAutoGeneratedPath(vInd.textContent, "video")) vInd.textContent = vPath || "None";
    if (isAutoGeneratedPath(iInd.textContent, "image")) iInd.textContent = iPath || "None";
  }
  $("exModalName")?.addEventListener("input", () => {
    const val = $("exModalName").value.trim();
    updateExercisePathFieldsFromName(val);
    if (val && (!$('exModalType').value || !$('exModalBodyPart').value)) {
      const t = inferExerciseType({ name: val });
      const b = inferExerciseBodyPart({ name: val });
      if (!$('exModalType').value && t) $('exModalType').value = normalizeKey(t);
      if (!$('exModalBodyPart').value && b) $('exModalBodyPart').value = normalizeKey(b);
    }
  });


  // ── Render exercises table with search & filter ──
  function renderExercises() {
    const tbody = $('exercisesTableBody');
    if (!tbody) return;

    enrichExercises(defaultExercises);

    const searchTerm = ($('exerciseSearch')?.value || '').toLowerCase().trim();
    const filterType = $('exerciseFilterType')?.value || '';
    const filterBody = $('exerciseFilterBody')?.value || '';

    let filtered = defaultExercises;
    if (searchTerm) {
      filtered = filtered.filter(ex => {
        const text = [ex.name, ...(ex.aliases || []), ex.type || '', ex.body_part || ''].join(' ').toLowerCase();
        return text.includes(searchTerm);
      });
    }
    if (filterType) {
      filtered = filtered.filter(ex => {
        const t = ex.type || inferExerciseType(ex);
        return matchesFilter(t, filterType);
      });
    }
    if (filterBody) {
      filtered = filtered.filter(ex => {
        const b = ex.body_part || inferExerciseBodyPart(ex);
        return matchesFilter(b, filterBody);
      });
    }

    if ($('exerciseCount')) $('exerciseCount').textContent = `${filtered.length} of ${defaultExercises.length} exercises`;

    if (filtered.length === 0) {
      let emptyMsg = 'No exercises in library.';
      if (searchTerm || filterType || filterBody) {
        const parts = [];
        if (searchTerm) parts.push(`"${searchTerm}"`);
        if (filterType) parts.push(`type "${filterType}"`);
        if (filterBody) parts.push(`muscle group "${filterBody}"`);
        emptyMsg = `No matching exercises found for ${parts.join(', ')}.`;
      }
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(emptyMsg)}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(ex => {
      const origIdx = defaultExercises.indexOf(ex);
      const iconHtml = (ex.icon_url || ex.image_url)
        ? `<img src="${esc(ex.icon_url || ex.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`
        : `<div style="font-size:32px; opacity:0.5; display:flex; align-items:center; justify-content:center; width:100%; height:100%;">🖼️</div>`;
      const videoParts = [ex.video_file_url ? '✓ File' : '', ex.video_url ? '✓ URL' : ''].filter(Boolean);
      const gifParts = [ex.gif_url ? '✓ GIF' : ''].filter(Boolean);
      const imageParts = [ex.icon_url ? '✓ File' : '', ex.image_url ? '✓ URL' : ''].filter(Boolean);
      const mediaStatus = [
        ...videoParts.map(v => '🎬 ' + v),
        ...gifParts.map(g => '🎞️ ' + g),
        ...imageParts.map(i => '🖼 ' + i)
      ].join(', ') || '—';

      const rawType = ex.type || inferExerciseType(ex);
      const rawBody = ex.body_part || inferExerciseBodyPart(ex);
      const displayType = rawType ? rawType.charAt(0).toUpperCase() + rawType.slice(1) : '—';
      const displayBody = rawBody ? (rawBody === 'full body' ? 'Full Body' : rawBody.charAt(0).toUpperCase() + rawBody.slice(1)) : '—';

      return `
        <tr class="clickable-row" onclick="if(!event.target.closest('button') && !event.target.closest('input')) editExercise(${origIdx})" style="cursor:pointer;">
          <td style="width:90px;">
            <div class="ex-icon-cell" title="Click to upload icon" style="width:80px; height:80px; border-radius:12px;">
              ${iconHtml}
              <input type="file" accept="image/*" onchange="uploadExerciseIcon(${origIdx}, this)">
            </div>
          </td>
          <td><strong>${esc(ex.name)}</strong>${ex.aliases?.length ? `<br><small style="color:var(--text-muted)">${esc(ex.aliases.join(', '))}</small>` : ''}</td>
          <td><span class="role-badge" style="background:var(--bg-input);font-size:11px;font-weight:600;text-transform:capitalize;">${esc(displayType)}</span></td>
          <td style="font-weight:500;">${esc(displayBody)}</td>
          <td onclick="openMediaPreview(${origIdx})" title="Click to preview media" style="cursor:pointer;">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span>${mediaStatus}</span>
              ${(ex.video_file_url || ex.video_url || ex.gif_url || ex.icon_url || ex.image_url) ? '<small style="color:var(--accent, #00f2fe); font-size:11px;">👁️ Click to view</small>' : ''}
            </div>
          </td>
          <td>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn small-btn" style="background:rgba(0,242,254,0.12); color:var(--accent, #00f2fe); border:1px solid rgba(0,242,254,0.3); font-weight:600;" onclick="openMediaPreview(${origIdx})" title="Preview all media for this exercise">👁️ Preview</button>
              <button class="btn small-btn" onclick="editExercise(${origIdx})">Edit</button>
              <button class="btn small-btn btn-danger" onclick="deleteExercise(${origIdx})">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Wiring search & filter inputs
  $('exerciseSearch')?.addEventListener('input', renderExercises);
  $('exerciseFilterType')?.addEventListener('change', renderExercises);
  $('exerciseFilterBody')?.addEventListener('change', renderExercises);

  // ── Video URL Extraction Helper ──
  function extractVideoInfo(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    // YouTube matches (watch?v=, youtu.be/, shorts/, embed/, etc.)
    const ytMatch = trimmed.match(/(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch && ytMatch[1]) {
      const videoId = ytMatch[1];
      return {
        type: 'youtube',
        id: videoId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&enablejsapi=1`,
        url: trimmed
      };
    }

    // Vimeo
    const vimeoMatch = trimmed.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)([0-9]+)/i);
    if (vimeoMatch && vimeoMatch[1]) {
      return {
        type: 'vimeo',
        id: vimeoMatch[1],
        embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
        url: trimmed
      };
    }

    // Direct video file
    if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(trimmed) ||
        trimmed.includes('/storage/v1/object/public/app-media/exercise-videos') ||
        trimmed.startsWith('blob:') || trimmed.startsWith('data:video')) {
      return {
        type: 'direct',
        url: trimmed
      };
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return {
        type: 'direct',
        url: trimmed
      };
    }

    return null;
  }

  // ── Dynamic Video Extraction & Preview Handler ──
  function updateVideoPreview() {
    const file = $('exModalVideoFile')?.files?.[0];
    const url = ($('exModalVideoUrl')?.value || '').trim();
    const status = $('exModalVideoUrlStatus');
    const wrap = $('exModalVideoPreviewWrap');
    const iframe = $('exModalVideoIframe');
    const vid = $('exModalVideoPreview');

    // 1. Uploaded file preview has priority if selected
    if (file) {
      if (wrap) wrap.style.display = 'block';
      if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
      if (vid) { vid.src = URL.createObjectURL(file); vid.style.display = 'block'; }
      if (status) status.innerHTML = '';
      $('btnRemoveVideo').style.display = 'block';
      return;
    }

    // 2. Extract and preview video from URL
    if (url) {
      const info = extractVideoInfo(url);
      if (info && (info.type === 'youtube' || info.type === 'vimeo')) {
        if (wrap) wrap.style.display = 'block';
        if (vid) { vid.style.display = 'none'; vid.pause(); vid.src = ''; }
        if (iframe) {
          iframe.src = info.embedUrl;
          iframe.style.display = 'block';
        }
        if (status) {
          status.innerHTML = `<span style="color:var(--accent, #00f2fe);">✓ Extracted ${info.type === 'youtube' ? 'YouTube' : 'Vimeo'} Video (ID: <code>${esc(info.id)}</code>)</span>`;
        }
        return;
      } else if (info && info.type === 'direct') {
        if (wrap) wrap.style.display = 'block';
        if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
        if (vid) {
          vid.src = info.url;
          vid.style.display = 'block';
        }
        if (status) {
          status.innerHTML = `<span style="color:#10b981;">✓ Direct video URL detected</span>`;
        }
        return;
      } else {
        if (status) {
          status.innerHTML = `<span style="color:#f59e0b;">⚠️ Video could not be extracted from URL. Please check the URL format.</span>`;
        }
      }
    } else {
      if (status) status.innerHTML = '';
    }

    // 3. Saved existing video file
    const editIdx = parseInt($('exerciseEditIndex')?.value ?? '-1', 10);
    const existing = editIdx >= 0 ? defaultExercises[editIdx] : null;
    if (!window._removeExistingVideo && (existing?.video_file_url || existing?.video_path)) {
      if (wrap) wrap.style.display = 'block';
      if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
      if (vid) { vid.src = existing.video_file_url || esc(existing.video_path); vid.style.display = 'block'; }
      $('btnRemoveVideo').style.display = 'block';
      return;
    }

    // No video to preview
    if (wrap) wrap.style.display = 'none';
    if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
    if (vid) { vid.style.display = 'none'; vid.pause(); vid.src = ''; }
  }

  // ── Dynamic Custom GIF Preview Handler ──
  function updateGifPreview() {
    const file = $('exModalGifFile')?.files?.[0];
    const url = ($('exModalGifUrl')?.value || '').trim();
    const wrap = $('exModalGifPreviewWrap');
    const img = $('exModalGifPreview');
    const status = $('exModalGifFileStatus');
    const removeBtn = $('btnRemoveGif');

    if (file) {
      if (wrap) wrap.style.display = 'block';
      if (img) img.src = URL.createObjectURL(file);
      if (status) status.textContent = `✓ Selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
      if (removeBtn) removeBtn.style.display = 'block';
      window._removeExistingGif = false;
      return;
    }

    if (url) {
      if (wrap) wrap.style.display = 'block';
      if (img) img.src = url;
      if (status) status.textContent = '✓ External GIF URL attached';
      if (removeBtn) removeBtn.style.display = 'block';
      window._removeExistingGif = false;
      return;
    }

    const editIdx = parseInt($('exerciseEditIndex')?.value ?? '-1', 10);
    const existing = editIdx >= 0 ? defaultExercises[editIdx] : null;
    if (!window._removeExistingGif && existing?.gif_url) {
      if (wrap) wrap.style.display = 'block';
      if (img) img.src = existing.gif_url;
      if (status) status.textContent = '✓ Custom GIF attached to exercise';
      if (removeBtn) removeBtn.style.display = 'block';
      return;
    }

    if (wrap) wrap.style.display = 'none';
    if (img) img.removeAttribute('src');
    if (status) status.textContent = '';
    if (removeBtn) removeBtn.style.display = 'none';
  }

  // ── Exercise Modal ──
  function openExerciseModal(editIdx = -1) {
    $('exerciseEditIndex').value = editIdx;
    window._removeExistingVideo = false;
    window._removeExistingIcon = false;
    window._removeExistingGif = false;

    if (editIdx >= 0) {
      const ex = defaultExercises[editIdx];
      $('exerciseModalTitle').textContent = 'Edit Exercise';
      $('exModalName').value = ex.name || '';
      $('exModalType').value = normalizeKey(ex.type || inferExerciseType(ex));
      $('exModalBodyPart').value = normalizeKey(ex.body_part || inferExerciseBodyPart(ex));
      $('exModalAliases').value = (ex.aliases || []).join(', ');
      $('btnConfirmExercise').textContent = 'Save Changes';

      // Icon preview
      if (ex.icon_url) {
        $('exModalIconPreview').innerHTML = `<img src="${esc(ex.icon_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`;
        $('btnRemoveIcon').style.display = 'block';
      } else {
        $('exModalIconPreview').innerHTML = '';
        $('btnRemoveIcon').style.display = 'none';
      }

      // Video File Status
      $('exModalVideoFile').value = '';
      $('exModalVideoFileStatus').textContent = ex.video_file_url ? '✓ A video file is already uploaded for this exercise.' : '';
      if (ex.video_file_url) {
        $('btnRemoveVideo').style.display = 'block';
      } else {
        $('btnRemoveVideo').style.display = 'none';
      }

      // Populate Video URL & GIF URL
      $('exModalVideoUrl').value = ex.video_url || '';
      $('exModalImageUrl').value = ex.image_url || '';
      $('exModalGifUrl').value = ex.gif_url || '';
      $('exModalGifFile').value = '';

      updateVideoPreview();
      updateGifPreview();
    } else {
      $('exerciseModalTitle').textContent = 'Add Exercise';
      $('exModalName').value = '';
      $('exModalType').value = '';
      $('exModalBodyPart').value = '';
      $('exModalAliases').value = '';
      $('exModalImagePath').textContent = 'None';
      $('exModalVideoPath').textContent = 'None';
      $('exModalIcon').value = '';
      $('exModalIconPreview').innerHTML = '';
      $('exModalVideoFile').value = '';
      $('exModalVideoFileStatus').textContent = '';
      $('btnRemoveVideo').style.display = 'none';
      $('btnRemoveIcon').style.display = 'none';
      $('btnRemoveGif').style.display = 'none';
      $('exModalVideoUrl').value = '';
      $('exModalImageUrl').value = '';
      $('exModalGifUrl').value = '';
      $('exModalGifFile').value = '';

      updateVideoPreview();
      updateGifPreview();
      $('btnConfirmExercise').textContent = 'Add Exercise';
    }
    $('exerciseAddModal').style.display = 'flex';
  }

  function closeExerciseModal() {
    $('exerciseAddModal').style.display = 'none';
    if ($('exModalVideoIframe')) {
      $('exModalVideoIframe').src = '';
      $('exModalVideoIframe').style.display = 'none';
    }
    if ($('exModalVideoPreview')) {
      $('exModalVideoPreview').pause();
      $('exModalVideoPreview').src = '';
      $('exModalVideoPreview').style.display = 'none';
    }
  }

  // ── Exercise Media Preview Modal Logic ──
  window.openMediaPreview = function(origIdx) {
    const ex = defaultExercises[origIdx];
    if (!ex) return;

    if ($('mediaPreviewModalTitle')) $('mediaPreviewModalTitle').textContent = ex.name || 'Exercise Media';
    if ($('mediaPreviewModalSubtitle')) {
      const typeStr = ex.type ? ex.type.charAt(0).toUpperCase() + ex.type.slice(1) : 'Standard';
      const bodyStr = ex.body_part ? ex.body_part.charAt(0).toUpperCase() + ex.body_part.slice(1) : 'General';
      $('mediaPreviewModalSubtitle').textContent = `Type: ${typeStr}  •  Muscle Group: ${bodyStr}`;
    }

    // Reset tabs to "all"
    switchMediaPreviewTab('all');

    // 1. Video Preview
    const vidContent = $('mediaPreviewVideoContent');
    const vidBadge = $('mediaPreviewVideoBadge');
    const vidSource = $('mediaPreviewVideoSource');
    const vidUrl = ex.video_file_url || ex.video_url || '';

    if (vidUrl) {
      const info = extractVideoInfo(vidUrl);
      if (info && (info.type === 'youtube' || info.type === 'vimeo')) {
        vidContent.innerHTML = `<iframe src="${info.embedUrl}" style="width:100%;height:100%;border:0;" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        vidBadge.textContent = info.type === 'youtube' ? 'YouTube' : 'Vimeo';
        vidBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        vidBadge.style.color = '#f87171';
        vidSource.innerHTML = `Source: <a href="${esc(info.url)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">${esc(info.url.length > 55 ? info.url.slice(0, 55) + '…' : info.url)}</a>`;
      } else {
        vidContent.innerHTML = `<video src="${esc(vidUrl)}" controls muted autoplay playsinline style="width:100%;height:100%;object-fit:contain;"></video>`;
        vidBadge.textContent = ex.video_file_url ? 'Uploaded File' : 'Direct Video';
        vidBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        vidBadge.style.color = '#10b981';
        vidSource.innerHTML = `Source: <a href="${esc(vidUrl)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">${esc(vidUrl.length > 55 ? vidUrl.slice(0, 55) + '…' : vidUrl)}</a>`;
      }
    } else {
      vidContent.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;"><div style="font-size:36px; margin-bottom:6px; opacity:0.4;">🎬</div><div style="font-size:12px;">No video attached</div></div>`;
      vidBadge.textContent = 'None';
      vidBadge.style.background = 'rgba(255, 255, 255, 0.05)';
      vidBadge.style.color = 'var(--text-muted)';
      vidSource.innerHTML = '';
    }

    // 2. GIF Preview
    const gifContent = $('mediaPreviewGifContent');
    const gifBadge = $('mediaPreviewGifBadge');
    const gifSource = $('mediaPreviewGifSource');

    if (ex.gif_url) {
      gifContent.innerHTML = `<img src="${esc(ex.gif_url)}" alt="Looping GIF demo" style="max-width:100%; max-height:100%; object-fit:contain;">`;
      gifBadge.textContent = 'Looping GIF';
      gifBadge.style.background = 'rgba(0, 242, 254, 0.15)';
      gifBadge.style.color = 'var(--accent, #00f2fe)';
      gifSource.innerHTML = `Source: <a href="${esc(ex.gif_url)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">${esc(ex.gif_url.length > 55 ? ex.gif_url.slice(0, 55) + '…' : ex.gif_url)}</a>`;
    } else {
      gifContent.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;"><div style="font-size:36px; margin-bottom:6px; opacity:0.4;">🎞️</div><div style="font-size:12px;">No custom GIF uploaded</div></div>`;
      gifBadge.textContent = 'None';
      gifBadge.style.background = 'rgba(255, 255, 255, 0.05)';
      gifBadge.style.color = 'var(--text-muted)';
      gifSource.innerHTML = '';
    }

    // 3. Image / Icon Preview
    const imgContent = $('mediaPreviewImageContent');
    const imgBadge = $('mediaPreviewImageBadge');
    const imgSource = $('mediaPreviewImageSource');
    const imgUrl = ex.icon_url || ex.image_url || '';

    if (imgUrl) {
      imgContent.innerHTML = `<img src="${esc(imgUrl)}" alt="Exercise image" style="max-width:100%; max-height:100%; object-fit:contain;">`;
      imgBadge.textContent = ex.icon_url ? 'Icon Image' : 'Image URL';
      imgBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      imgBadge.style.color = '#10b981';
      imgSource.innerHTML = `Source: <a href="${esc(imgUrl)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:underline;">${esc(imgUrl.length > 55 ? imgUrl.slice(0, 55) + '…' : imgUrl)}</a>`;
    } else {
      imgContent.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:24px;"><div style="font-size:36px; margin-bottom:6px; opacity:0.4;">🖼️</div><div style="font-size:12px;">No image or icon attached</div></div>`;
      imgBadge.textContent = 'None';
      imgBadge.style.background = 'rgba(255, 255, 255, 0.05)';
      imgBadge.style.color = 'var(--text-muted)';
      imgSource.innerHTML = '';
    }

    $('exerciseMediaPreviewModal').style.display = 'flex';
  };

  window.closeMediaPreview = function() {
    $('exerciseMediaPreviewModal').style.display = 'none';
    if ($('mediaPreviewVideoContent')) $('mediaPreviewVideoContent').innerHTML = '';
    if ($('mediaPreviewGifContent')) $('mediaPreviewGifContent').innerHTML = '';
    if ($('mediaPreviewImageContent')) $('mediaPreviewImageContent').innerHTML = '';
  };

  window.switchMediaPreviewTab = function(tab) {
    const vCard = $('mediaPreviewVideoCard');
    const gCard = $('mediaPreviewGifCard');
    const iCard = $('mediaPreviewImageCard');
    const tAll = $('mediaPreviewTabAll');
    const tVid = $('mediaPreviewTabVideo');
    const tGif = $('mediaPreviewTabGif');
    const tImg = $('mediaPreviewTabImage');

    [tAll, tVid, tGif, tImg].forEach(b => {
      if (b) {
        b.classList.remove('active');
        b.style.background = '';
        b.style.color = '';
      }
    });

    if (tab === 'video') {
      if (tVid) { tVid.classList.add('active'); tVid.style.background = 'rgba(239, 68, 68, 0.2)'; tVid.style.color = '#f87171'; }
      if (vCard) vCard.style.display = 'flex';
      if (gCard) gCard.style.display = 'none';
      if (iCard) iCard.style.display = 'none';
    } else if (tab === 'gif') {
      if (tGif) { tGif.classList.add('active'); tGif.style.background = 'rgba(0, 242, 254, 0.2)'; tGif.style.color = 'var(--accent, #00f2fe)'; }
      if (vCard) vCard.style.display = 'none';
      if (gCard) gCard.style.display = 'flex';
      if (iCard) iCard.style.display = 'none';
    } else if (tab === 'image') {
      if (tImg) { tImg.classList.add('active'); tImg.style.background = 'rgba(16, 185, 129, 0.2)'; tImg.style.color = '#10b981'; }
      if (vCard) vCard.style.display = 'none';
      if (gCard) gCard.style.display = 'none';
      if (iCard) iCard.style.display = 'flex';
    } else {
      if (tAll) { tAll.classList.add('active'); tAll.style.background = 'var(--accent, #00f2fe)'; tAll.style.color = '#000'; }
      if (vCard) vCard.style.display = 'flex';
      if (gCard) gCard.style.display = 'flex';
      if (iCard) iCard.style.display = 'flex';
    }
  };

  $('btnCloseMediaPreviewModal')?.addEventListener('click', closeMediaPreview);
  $('btnCloseMediaPreviewBtn')?.addEventListener('click', closeMediaPreview);
  $('exerciseMediaPreviewModal')?.addEventListener('click', e => {
    if (e.target === $('exerciseMediaPreviewModal')) closeMediaPreview();
  });

  $('btnAddExercise')?.addEventListener('click', () => openExerciseModal(-1));
  $('btnCancelExercise')?.addEventListener('click', closeExerciseModal);
  $('exerciseAddModal')?.addEventListener('click', e => {
    if (e.target === $('exerciseAddModal')) closeExerciseModal();
  });

  // Listeners for video extraction & preview
  $('exModalVideoUrl')?.addEventListener('input', updateVideoPreview);
  $('exModalVideoUrl')?.addEventListener('change', updateVideoPreview);
  $('exModalVideoFile')?.addEventListener('change', function() {
    window._removeExistingVideo = false;
    updateVideoPreview();
  });

  // Listeners for GIF preview
  $('exModalGifUrl')?.addEventListener('input', updateGifPreview);
  $('exModalGifUrl')?.addEventListener('change', updateGifPreview);
  $('exModalGifFile')?.addEventListener('change', function() {
    window._removeExistingGif = false;
    updateGifPreview();
  });

  $('exModalIcon')?.addEventListener('change', function() {
    window._removeExistingIcon = false;
    const file = this.files[0];
    if (file) {
      $('btnRemoveIcon').style.display = 'block';
    } else {
      const editIdx = parseInt($('exerciseEditIndex').value, 10);
      $('btnRemoveIcon').style.display = (editIdx >= 0 && defaultExercises[editIdx]?.icon_url) ? 'block' : 'none';
    }
  });

  $('btnRemoveVideo')?.addEventListener('click', () => {
    window._removeExistingVideo = true;
    $('exModalVideoFile').value = '';
    $('exModalVideoFileStatus').textContent = '';
    $('exModalVideoUrl').value = '';
    updateVideoPreview();
    $('btnRemoveVideo').style.display = 'none';
  });

  $('btnRemoveGif')?.addEventListener('click', () => {
    window._removeExistingGif = true;
    $('exModalGifFile').value = '';
    $('exModalGifUrl').value = '';
    $('exModalGifFileStatus').textContent = '';
    updateGifPreview();
    $('btnRemoveGif').style.display = 'none';
  });

  $('btnRemoveIcon')?.addEventListener('click', () => {
    window._removeExistingIcon = true;
    $('exModalIcon').value = '';
    $('exModalIconPreview').innerHTML = '';
    $('btnRemoveIcon').style.display = 'none';
  });

  // ── Confirm add/edit ──
  $('btnConfirmExercise')?.addEventListener('click', async () => {
    const name = ($('exModalName')?.value || '').trim();
    if (!name) return toast("Exercise name is required.", "error");

    const type = $('exModalType')?.value || inferExerciseType({ name, aliases });
    const body_part = $('exModalBodyPart')?.value || inferExerciseBodyPart({ name, aliases });
    const aliases = ($('exModalAliases')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const editIdx = parseInt($('exerciseEditIndex')?.value ?? '-1', 10);
    const slug = slugFromName(name);
    let image_path = imagePathFromName(name);
    let video_path = videoPathFromName(name);

    // Handle icon upload if a file was selected
    let icon_url = editIdx >= 0 && !window._removeExistingIcon ? (defaultExercises[editIdx]?.icon_url || '') : '';
    const iconFile = $('exModalIcon')?.files?.[0];
    if (iconFile) {
      try {
        const ext = iconFile.name.split('.').pop().toLowerCase() || 'jpg';
        const renamed = new File([iconFile], `${slug || 'exercise'}.${ext}`, { type: iconFile.type });
        icon_url = await uploadMediaFile(renamed, 'exercise-icons');
      } catch (err) {
        toast("Icon upload failed: " + err.message, "error");
      }
    }

    // Handle uploaded video file
    let video_file_url = editIdx >= 0 && !window._removeExistingVideo ? (defaultExercises[editIdx]?.video_file_url || '') : '';
    const videoFile = $('exModalVideoFile')?.files?.[0];
    if (videoFile) {
      try {
        const renamed = new File([videoFile], `${slug || 'exercise'}.mp4`, { type: videoFile.type });
        video_file_url = await uploadMediaFile(renamed, 'exercise-videos');
      } catch (err) {
        toast("Video upload failed: " + err.message, "error");
      }
    }

    // Handle custom GIF upload (alternative to YouTube URL)
    let gif_url = editIdx >= 0 && !window._removeExistingGif ? (defaultExercises[editIdx]?.gif_url || '') : '';
    const gifFile = $('exModalGifFile')?.files?.[0];
    if (gifFile) {
      try {
        const renamed = new File([gifFile], `${slug || 'exercise'}.gif`, { type: 'image/gif' });
        gif_url = await uploadMediaFile(renamed, 'exercise-gifs');
      } catch (err) {
        toast("GIF upload failed: " + err.message, "error");
      }
    } else if ($('exModalGifUrl')?.value?.trim()) {
      gif_url = $('exModalGifUrl').value.trim();
    } else if (window._removeExistingGif) {
      gif_url = '';
    }

    // Read URL fields
    const video_url = ($('exModalVideoUrl')?.value || '').trim();
    const image_url = ($('exModalImageUrl')?.value || '').trim();

    const exerciseObj = { name, type, body_part, aliases, video_url, image_url, icon_url, image_path, video_path, video_file_url, gif_url };

    if (editIdx >= 0) {
      defaultExercises[editIdx] = exerciseObj;
    } else {
      defaultExercises.push(exerciseObj);
    }

    closeExerciseModal();
    renderExercises();
    if ($('statExercises')) $('statExercises').textContent = defaultExercises.length;
    toast(editIdx >= 0 ? "Exercise updated!" : "Exercise added!");
  });

  // ── Upload media to Supabase storage ──
  async function uploadMediaFile(file, folder = 'exercise-icons') {
    const kind = folder === 'exercise-videos' ? 'video' : (folder === 'exercise-gifs' ? 'gif' : 'image');
    if (window.Security?.validateUpload) {
      const v = await window.Security.validateUpload(file, kind);
      if (!v.valid) {
        throw new Error(v.error);
      }
    }
    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('app-media').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false
    });
    if (error) throw error;
    const { data: publicData } = supabase.storage.from('app-media').getPublicUrl(fileName);
    return publicData.publicUrl;
  }

  // ── Inline icon upload from table ──
  window.uploadExerciseIcon = async (index, input) => {
    const file = input.files?.[0];
    if (!file || index < 0 || index >= defaultExercises.length) return;
    try {
      const url = await uploadMediaFile(file, 'exercise-icons');
      defaultExercises[index].icon_url = url;
      renderExercises();
      toast("Icon uploaded!");
    } catch (err) {
      toast("Upload failed: " + err.message, "error");
    }
  };

  // ── Edit / Delete ──
  window.editExercise = (index) => openExerciseModal(index);

  window.deleteExercise = (index) => {
    if (!confirm(`Remove "${defaultExercises[index]?.name}"?`)) return;
    defaultExercises.splice(index, 1);
    renderExercises();
    if ($('statExercises')) $('statExercises').textContent = defaultExercises.length;
  };

  // ── Save All Exercises ──
  $('btnSaveExercises')?.addEventListener('click', async () => {
    const btn = $('btnSaveExercises');
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      await saveSetting('default_exercises', defaultExercises);
      toast("All exercises saved to cloud!");
    } catch (err) {
      console.error(err);
      toast("Failed to save exercises: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Save All Changes";
    }
  });

  // ════════════════════════════════════════════════════════════════
  // SYSTEM SETTINGS (Phase 3)
  // ════════════════════════════════════════════════════════════════

  let settingsMap = {};

  async function loadSettings() {
    try {
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw error;

      settingsMap = {};
      (data || []).forEach(s => { settingsMap[s.key] = s.value; });

      // App Branding
      const logoUrl = settingsMap['app_logo'] || '';
      $('currentLogoUrl').value = logoUrl;
      if (logoUrl) {
        $('logoPreview').innerHTML = `<img src="${esc(logoUrl)}" style="width:100%;height:100%;object-fit:cover;">`;
      }
      $('settingAppName').value = settingsMap['app_name'] || 'GymCoach';
      $('settingWelcomeMsg').value = settingsMap['welcome_message'] || '';

      // Maintenance & Access
      const maint = settingsMap['maintenance_mode'] === true || settingsMap['maintenance_mode'] === 'true';
      $('settingMaintenanceMode').checked = maint;
      $('maintenanceMsgGroup').style.display = maint ? 'block' : 'none';
      $('settingMaintenanceMsg').value = settingsMap['maintenance_message'] || '';
      $('settingAllowRegistrations').checked = settingsMap['allow_registrations'] !== false && settingsMap['allow_registrations'] !== 'false';
      $('settingSupportEnabled').checked = settingsMap['support_enabled'] !== false && settingsMap['support_enabled'] !== 'false';

      // AI Coach
      $('settingAiPrompt').value = settingsMap['default_ai_prompt'] || '';
      $('settingAiEnabled').checked = settingsMap['ai_enabled'] !== false && settingsMap['ai_enabled'] !== 'false';

      // AI Provider Models
      const customModels = settingsMap['ai_provider_models'];
      if (customModels && typeof customModels === 'object') {
        providerModelsMap = { ...DEFAULT_PROVIDER_MODELS, ...customModels };
      }
      renderProviderModelTags();

      // Workout Defaults
      $('settingDefaultRest').value = settingsMap['default_rest_timer'] || '';
      $('settingDefaultUnit').value = settingsMap['default_weight_unit'] || 'kg';
      $('settingMaxSets').value = settingsMap['max_sets_per_exercise'] || '';
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  // AI Provider Models Management
  const DEFAULT_PROVIDER_MODELS = {
    gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    openai: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
    anthropic: ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    groq: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    openrouter: ["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct", "google/gemini-2.0-flash-001", "deepseek/deepseek-r1"],
    xai: ["grok-2-latest", "grok-beta"],
    mistral: ["mistral-small-latest", "mistral-large-latest", "codestral-latest"],
    perplexity: ["sonar-pro", "sonar", "sonar-reasoning"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-R1"],
    cohere: ["command-r-plus", "command-r"]
  };
  let providerModelsMap = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_MODELS));

  function renderProviderModelTags() {
    const provider = $('settingModelProvider')?.value || 'gemini';
    const container = $('modelTagsContainer');
    if (!container) return;
    const models = providerModelsMap[provider] || [];
    if (!models.length) {
      container.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">No models configured for this provider.</span>`;
      return;
    }
    container.innerHTML = models.map((m, idx) => `
      <span class="model-tag">
        <span>${esc(m)}</span>
        <button type="button" class="tag-remove" data-provider="${esc(provider)}" data-index="${idx}" title="Remove model">×</button>
      </span>
    `).join('');

    container.querySelectorAll('.tag-remove').forEach(btn => {
      btn.onclick = () => {
        const prov = btn.dataset.provider;
        const index = parseInt(btn.dataset.index, 10);
        if (providerModelsMap[prov]) {
          providerModelsMap[prov].splice(index, 1);
          renderProviderModelTags();
        }
      };
    });
  }

  $('settingModelProvider')?.addEventListener('change', renderProviderModelTags);

  function addModelForCurrentProvider() {
    const provider = $('settingModelProvider')?.value || 'gemini';
    const input = $('newModelInput');
    const val = (input?.value || '').trim();
    if (!val) return toast("Enter a model name first.", "error");

    if (!providerModelsMap[provider]) providerModelsMap[provider] = [];
    if (providerModelsMap[provider].includes(val)) {
      return toast(`"${val}" is already in the list for ${provider}.`, "warning");
    }
    providerModelsMap[provider].push(val);
    input.value = '';
    renderProviderModelTags();
    toast(`Added "${val}" to ${provider}!`);
  }

  $('btnAddModel')?.addEventListener('click', addModelForCurrentProvider);
  $('newModelInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addModelForCurrentProvider();
    }
  });

  $('btnResetProviderModels')?.addEventListener('click', () => {
    const provider = $('settingModelProvider')?.value || 'gemini';
    if (!confirm(`Reset ${provider} models to default presets?`)) return;
    providerModelsMap[provider] = [...(DEFAULT_PROVIDER_MODELS[provider] || [])];
    renderProviderModelTags();
    toast(`Reset ${provider} models to defaults.`);
  });

  async function saveAiModels() {
    const btn = $('btnSaveAiModels');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      await saveSetting('ai_provider_models', providerModelsMap);
      try { localStorage.setItem('gymcoach_provider_models', JSON.stringify(providerModelsMap)); } catch (e) {}
      toast("AI Model presets saved successfully!");
    } catch (err) {
      toast("Failed to save models: " + err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "💾 Save Model Presets";
      }
    }
  }

  $('btnSaveAiModels')?.addEventListener('click', saveAiModels);

  // Toggle maintenance message visibility
  $('settingMaintenanceMode')?.addEventListener('change', () => {
    $('maintenanceMsgGroup').style.display = $('settingMaintenanceMode').checked ? 'block' : 'none';
  });

  // Upload Logo
  $('btnUploadLogo')?.addEventListener('click', async () => {
    const file = $('logoUploadInput')?.files?.[0];
    if (!file) return toast("Select an image first.", "error");

    const btn = $('btnUploadLogo');
    btn.textContent = "Uploading...";
    btn.disabled = true;
    try {
      const url = await uploadMediaFile(file, 'logos');
      $('currentLogoUrl').value = url;
      $('logoPreview').innerHTML = `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;">`;
      await saveSetting('app_logo', url);
      if (window.AppBranding) window.AppBranding.set({ logo: url });
      toast("Logo uploaded and saved!");
    } catch (err) {
      toast("Upload failed: " + err.message, "error");
    } finally {
      btn.textContent = "Upload";
      btn.disabled = false;
    }
  });

  // Save Brand Settings
  $('btnSaveBranding')?.addEventListener('click', async () => {
    const btn = $('btnSaveBranding');
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const appName = $('settingAppName')?.value?.trim() || 'GymCoach';
      const welcomeMsg = $('settingWelcomeMsg')?.value?.trim() || '';
      const logoUrl = $('currentLogoUrl')?.value?.trim() || '';

      const rows = [
        { key: 'app_name', value: appName },
        { key: 'welcome_message', value: welcomeMsg },
        { key: 'app_logo', value: logoUrl }
      ];

      const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;

      if (window.AppBranding) {
        window.AppBranding.set({
          name: appName,
          logo: logoUrl,
          welcome: welcomeMsg
        });
      }

      toast(`System rebranded to "${appName}"! All pages updated.`);
    } catch (err) {
      toast("Failed to save branding: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "🎨 Save Branding";
    }
  });

  // Save All Settings
  $('btnSaveAllSettings')?.addEventListener('click', async () => {
    const btn = $('btnSaveAllSettings');
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const settings = {
        'app_name': $('settingAppName')?.value?.trim() || 'GymCoach',
        'welcome_message': $('settingWelcomeMsg')?.value?.trim() || '',
        'maintenance_mode': $('settingMaintenanceMode')?.checked || false,
        'maintenance_message': $('settingMaintenanceMsg')?.value?.trim() || '',
        'allow_registrations': $('settingAllowRegistrations')?.checked ?? true,
        'support_enabled': $('settingSupportEnabled')?.checked ?? true,
        'default_ai_prompt': $('settingAiPrompt')?.value?.trim() || '',
        'ai_enabled': $('settingAiEnabled')?.checked ?? true,
        'ai_provider_models': providerModelsMap,
        'default_rest_timer': parseInt($('settingDefaultRest')?.value, 10) || null,
        'default_weight_unit': $('settingDefaultUnit')?.value || 'kg',
        'max_sets_per_exercise': parseInt($('settingMaxSets')?.value, 10) || null,
      };

      // Batch upsert all settings
      const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
      const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
      try { localStorage.setItem('gymcoach_provider_models', JSON.stringify(providerModelsMap)); } catch (e) {}

      if (window.AppBranding) {
        window.AppBranding.set({
          name: settings['app_name'],
          welcome: settings['welcome_message'],
          logo: $('currentLogoUrl')?.value?.trim() || ''
        });
      }

      toast("All settings saved!");
    } catch (err) {
      console.error(err);
      toast("Failed to save settings: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Save All Settings";
    }
  });

  // ════════════════════════════════════════════════════════════════
  // SUPPORT TICKETS
  // ════════════════════════════════════════════════════════════════

  async function loadTickets() {
    const tbody = $('ticketsTableBody');
    try {
      // Query support_tickets without relying on PostgREST foreign key cache
      const { data: tickets, error } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      const openCount = (tickets || []).filter(t => t.status === 'OPEN').length;
      if ($('statOpenTickets')) $('statOpenTickets').textContent = openCount;

      if (!tickets || tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No support tickets found.</td></tr>`;
        return;
      }

      // Resolve usernames from cachedUsers or profiles table
      const userMap = {};
      if (typeof cachedUsers !== 'undefined' && Array.isArray(cachedUsers)) {
        cachedUsers.forEach(u => { if (u && u.id) userMap[u.id] = u.username; });
      }
      const missingIds = [...new Set(tickets.map(t => t.user_id).filter(id => id && !userMap[id]))];
      if (missingIds.length > 0) {
        try {
          const { data: profs } = await supabase.from('profiles').select('id, username').in('id', missingIds);
          if (profs) profs.forEach(p => { userMap[p.id] = p.username; });
        } catch (e) {
          console.warn("Could not fetch profile names for tickets:", e);
        }
      }

      tbody.innerHTML = tickets.map(t => {
        const date = new Date(t.created_at).toLocaleString();
        const username = userMap[t.user_id] || 'Unknown';
        return `
        <tr>
          <td>${esc(date)}</td>
          <td>${esc(username)}</td>
          <td><b>${esc(t.title)}</b><br><small class="muted">${esc(t.body)}</small></td>
          <td><span class="role-badge" style="background:${t.status === 'OPEN' ? 'var(--error)' : 'var(--success)'}">${esc(t.status)}</span></td>
          <td><button class="btn small-btn" onclick="replyTicket('${t.id}')">Reply</button></td>
        </tr>`;
      }).join('');
    } catch (err) {
      console.error(err);
      // Never leave the table stuck on "Loading..." forever — surface the
      // actual problem (e.g. the support_tickets table not existing yet).
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-state error-state">Couldn't load tickets: ${esc(err?.message || 'unknown error')}</td></tr>`;
    }
  }

  window.replyTicket = async (id) => {
    const response = prompt("Enter your response to this user:");
    if (!response) return;
    try {
      const { error } = await supabase.from('support_tickets').update({ response, status: 'CLOSED' }).eq('id', id);
      if (error) throw error;
      loadTickets();
      toast("Reply sent.");
    } catch (err) {
      toast("Failed to send reply: " + err.message, "error");
    }
  };

  // ════════════════════════════════════════════════════════════════
  // EXERCISE SCORING CONFIGURATION (DTS)
  // ════════════════════════════════════════════════════════════════

  let cachedScoringExercises = [];

  async function loadExerciseScoring() {
    if (!window.ExerciseMetadata) return;
    try {
      await window.ExerciseMetadata.syncFromCloud(supabase);
    } catch (e) {
      console.warn("Could not sync scoring metadata from cloud:", e);
    }
    const sourceList = (defaultExercises && defaultExercises.length > 0) ? defaultExercises : (window.EXERCISE_DB || []);
    cachedScoringExercises = window.ExerciseMetadata.getAll(sourceList);
    renderScoringTable();
  }

  function renderScoringTable() {
    const tbody = $('scoringTableBody');
    if (!tbody) return;

    const searchTerm = ($('scoringSearchInput')?.value || '').toLowerCase().trim();
    const filterType = $('scoringTypeFilter')?.value || '';
    const filterPattern = $('scoringPatternFilter')?.value || '';
    const filterStatus = $('scoringStatusFilter')?.value || '';

    let filtered = cachedScoringExercises;
    if (searchTerm) {
      filtered = filtered.filter(ex => {
        const text = [ex.exercise_name || ex.name, ...(ex.aliases || [])].join(' ').toLowerCase();
        return text.includes(searchTerm);
      });
    }
    if (filterType) filtered = filtered.filter(ex => ex.exercise_type === filterType);
    if (filterPattern) filtered = filtered.filter(ex => ex.movement_pattern === filterPattern);
    if (filterStatus) filtered = filtered.filter(ex => ex.source === filterStatus);

    if ($('scoringFilteredCount')) {
      $('scoringFilteredCount').textContent = `${filtered.length} of ${cachedScoringExercises.length} exercises`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No matching exercises found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(ex => {
      const isManual = ex.source === 'MANUAL';
      const statusBadge = isManual
        ? `<span class="badge" style="background:rgba(249,115,22,0.18); color:var(--accent); font-weight:700; padding:2px 8px; border-radius:6px; font-size:11px; border:1px solid rgba(249,115,22,0.3);">MANUAL</span>`
        : `<span class="badge" style="background:rgba(34,197,94,0.15); color:var(--success); font-weight:600; padding:2px 8px; border-radius:6px; font-size:11px; border:1px solid rgba(34,197,94,0.3);">AUTO</span>`;
      
      const typeBadge = `<span class="badge" style="background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-size:11px;">${esc(ex.exercise_type)}</span>`;
      const patternBadge = `<span class="badge" style="background:rgba(255,255,255,0.04); color:var(--text-secondary); padding:2px 6px; border-radius:4px; font-size:11px;">${esc(ex.movement_pattern)}</span>`;
      const bwDisplay = (ex.bodyweight_factor !== undefined && ex.bodyweight_factor > 0) ? ex.bodyweight_factor.toFixed(2) : '—';
      const multDisplay = (ex.scoring_multiplier !== undefined) ? ex.scoring_multiplier.toFixed(2) : '1.00';

      return `
        <tr>
          <td>
            <div style="margin-bottom: 2px;"><b style="color:var(--text-primary);">${esc(ex.exercise_name || ex.name)}</b></div>
            ${ex.aliases && ex.aliases.length ? `<small class="muted" style="font-size:11px; display:inline-block; margin-top:4px;">${esc(ex.aliases.slice(0, 2).join(', '))}</small>` : ''}
          </td>
          <td>${typeBadge}</td>
          <td>${patternBadge}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${esc(ex.load_type || 'external')}</td>
          <td style="font-family:monospace; font-size:12px;">${bwDisplay}</td>
          <td style="font-family:monospace; font-size:12px; font-weight:600;">${multDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn small-btn" onclick="openScoringEditModal('${esc(ex.exercise_id)}')">Edit</button>
          </td>
        </tr>`;
    }).join('');
  }

  // Filter listeners
  $('scoringSearchInput')?.addEventListener('input', renderScoringTable);
  $('scoringTypeFilter')?.addEventListener('change', renderScoringTable);
  $('scoringPatternFilter')?.addEventListener('change', renderScoringTable);
  $('scoringStatusFilter')?.addEventListener('change', renderScoringTable);

  // Edit modal
  window.openScoringEditModal = (exerciseId) => {
    const item = cachedScoringExercises.find(e => e.exercise_id === exerciseId);
    if (!item) return;

    $('editScoringExerciseId').value = item.exercise_id;
    $('editScoringName').value = item.exercise_name || item.name;
    $('editScoringType').value = item.exercise_type || 'compound';
    $('editScoringPattern').value = item.movement_pattern || 'other';
    $('editScoringLoadType').value = item.load_type || 'external';
    $('editScoringBwFactor').value = item.bodyweight_factor !== undefined ? item.bodyweight_factor : 0;
    $('editScoringMultiplier').value = item.scoring_multiplier !== undefined ? item.scoring_multiplier : 1.0;
    $('editScoringIntensityMethod').value = item.intensity_method || 'estimated_1rm';
    $('editScoringEnabled').checked = item.enabled_for_scoring !== false;

    const btnRevert = $('btnResetScoringAuto');
    if (btnRevert) {
      btnRevert.style.display = item.source === 'MANUAL' ? 'inline-block' : 'none';
    }

    $('exerciseScoringModal')?.classList.add('open');
  };

  function closeScoringModal() {
    $('exerciseScoringModal')?.classList.remove('open');
  }

  $('btnCancelScoringModal')?.addEventListener('click', closeScoringModal);
  $('btnCancelScoringEdit')?.addEventListener('click', closeScoringModal);

  // Save manual override
  $('btnSaveScoringEdit')?.addEventListener('click', () => {
    const exerciseId = $('editScoringExerciseId')?.value;
    if (!exerciseId || !window.ExerciseMetadata) return;

    const params = {
      exercise_type: $('editScoringType').value,
      movement_pattern: $('editScoringPattern').value,
      load_type: $('editScoringLoadType').value,
      bodyweight_factor: parseFloat($('editScoringBwFactor').value) || 0,
      scoring_multiplier: parseFloat($('editScoringMultiplier').value) || 1.0,
      intensity_method: $('editScoringIntensityMethod').value,
      enabled_for_scoring: $('editScoringEnabled').checked
    };

    window.ExerciseMetadata.setOverride(exerciseId, params);
    toast("Scoring parameters overridden!");
    closeScoringModal();
    loadExerciseScoring();
  });

  // Revert override to AUTO
  $('btnResetScoringAuto')?.addEventListener('click', () => {
    const exerciseId = $('editScoringExerciseId')?.value;
    if (!exerciseId || !window.ExerciseMetadata) return;

    if (!confirm("Revert this exercise to automatic rule-based classification?")) return;
    window.ExerciseMetadata.removeOverride(exerciseId);
    toast("Reverted to automatic classification.");
    closeScoringModal();
    loadExerciseScoring();
  });

  // Save overrides to cloud
  $('btnSaveScoringToCloud')?.addEventListener('click', async () => {
    const btn = $('btnSaveScoringToCloud');
    if (!window.ExerciseMetadata) return;
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      await window.ExerciseMetadata.syncToCloud(supabase);
      toast("Scoring overrides synced to cloud!");
    } catch (err) {
      toast("Failed to sync overrides: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "💾 Save Overrides to Cloud";
    }
  });

  // ════════════════════════════════════════════════════════════════
  // ATHLETE WORKOUTS & DTS VIEWER
  // ════════════════════════════════════════════════════════════════

  let activeAthleteScores = [];
  let activeAthleteRange = 'all';

  function parseScoresFromSyncData(syncRows, userId) {
    try {
      const projRow = syncRows.find(r => r.storage_key === 'gymcoach_projects');
      if (!projRow || !projRow.value) return [];
      let projects = projRow.value;
      if (typeof projects === 'string') {
        try { projects = JSON.parse(projects); } catch { return []; }
      }
      if (!Array.isArray(projects)) return [];

      const byDate = {};
      projects.forEach(p => {
        (p.days || []).forEach(day => {
          (day.exercises || []).forEach(ex => {
            (ex.logs || []).forEach(log => {
              if (!log.date) return;
              const dKey = log.date.slice(0, 10);
              if (!byDate[dKey]) byDate[dKey] = { exercises: [], cardio: [] };
              let exEntry = byDate[dKey].exercises.find(e => e.name === ex.name);
              if (!exEntry) {
                exEntry = { name: ex.name, logs: [] };
                byDate[dKey].exercises.push(exEntry);
              }
              exEntry.logs.push(log);
            });
          });
          (day.cardio || []).forEach(c => {
            const dKey = c.date ? c.date.slice(0, 10) : "";
            if (!dKey) return;
            if (!byDate[dKey]) byDate[dKey] = { exercises: [], cardio: [] };
            byDate[dKey].cardio.push(c);
          });
        });
      });

      const dates = Object.keys(byDate).sort().reverse();
      return dates.map(dKey => {
        const dayData = byDate[dKey];
        if (window.DTS) {
          const res = window.DTS.calculateDailyScore({
            exercises: dayData.exercises,
            cardio: dayData.cardio,
            userBodyWeightKg: 75,
            getExerciseMetaFn: window.ExerciseMetadata?.get
          });
          return {
            user_id: userId,
            workout_date: dKey,
            score: res.dts,
            score_band: res.band.toUpperCase().replace(/\s+/g, '_'),
            strength_component: res.strengthComponent,
            cardio_component: res.cardioContribution,
            strength_workload: res.strengthWorkload,
            cardio_workload: res.cardioWorkload,
            details: {
              strengthDetails: res.strengthDetails,
              cardioDetails: res.cardioDetails
            }
          };
        }
        return {
          user_id: userId,
          workout_date: dKey,
          score: 0,
          score_band: 'REST',
          strength_workload: 0,
          cardio_workload: 0,
          details: {}
        };
      });
    } catch (e) {
      console.warn("Could not parse athlete scores from sync_data:", e);
      return [];
    }
  }

  function renderAthleteScores() {
    const tbody = $('athleteScoresTableBody');
    if (!tbody) return;

    let filtered = [...activeAthleteScores];
    if (activeAthleteRange !== 'all') {
      const days = activeAthleteRange === '7d' ? 7 : activeAthleteRange === '30d' ? 30 : 90;
      const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      filtered = filtered.filter(s => (s.workout_date || '') >= cutoff);
    }

    const totalCount = filtered.length;
    if ($('athKpiWorkouts')) $('athKpiWorkouts').textContent = totalCount;

    if (totalCount === 0) {
      if ($('athKpiAvgDts')) $('athKpiAvgDts').textContent = '—';
      if ($('athKpiMaxDts')) $('athKpiMaxDts').textContent = '—';
      if ($('athKpiSplit')) $('athKpiSplit').textContent = '—';
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No workout logs found for this time range.</td></tr>`;
      return;
    }

    let sumDts = 0;
    let maxDts = 0;
    let totalStr = 0;
    let totalCar = 0;

    filtered.forEach(s => {
      const sc = Number(s.score) || 0;
      sumDts += sc;
      if (sc > maxDts) maxDts = sc;
      totalStr += Number(s.strength_workload) || 0;
      totalCar += Number(s.cardio_workload) || 0;
    });

    if ($('athKpiAvgDts')) $('athKpiAvgDts').textContent = Math.round(sumDts / totalCount);
    if ($('athKpiMaxDts')) $('athKpiMaxDts').textContent = maxDts;
    const totalLoad = totalStr + (totalCar * 10);
    if ($('athKpiSplit')) {
      if (totalLoad > 0) {
        const pct = Math.round((totalStr / totalLoad) * 100);
        $('athKpiSplit').textContent = `${pct}% / ${100 - pct}%`;
      } else {
        $('athKpiSplit').textContent = '100% Strength';
      }
    }

    tbody.innerHTML = filtered.map(s => {
      const rawBand = (s.score_band || 'REST').replace(/_/g, ' ').toLowerCase();
      let badgeClass = 'badge-rest';
      if (rawBand.includes('very high')) badgeClass = 'badge-very-high';
      else if (rawBand.includes('high')) badgeClass = 'badge-high';
      else if (rawBand.includes('moderate')) badgeClass = 'badge-moderate';
      else if (rawBand.includes('low')) badgeClass = 'badge-low';

      const bandDisplay = rawBand.charAt(0).toUpperCase() + rawBand.slice(1);
      const strKg = Math.round(Number(s.strength_workload) || 0).toLocaleString();
      const carUnits = Math.round(Number(s.cardio_workload) || 0).toLocaleString();

      let summaryText = '—';
      const sets = s.details?.strengthDetails?.totalSets;
      const dur = s.details?.cardioDetails?.totalDuration;
      if (sets && dur) {
        summaryText = `${sets} sets · ${dur}m cardio`;
      } else if (sets) {
        summaryText = `${sets} sets completed`;
      } else if (dur) {
        summaryText = `${dur} min cardio`;
      }

      return `
        <tr>
          <td><b>${esc(s.workout_date)}</b></td>
          <td style="font-family:monospace; font-size:14px; font-weight:700;">${Math.round(s.score || 0)}</td>
          <td><span class="badge ${badgeClass}">${esc(bandDisplay)}</span></td>
          <td>${strKg} kg</td>
          <td>${carUnits} units</td>
          <td style="font-size:12px; color:var(--text-secondary);">${esc(summaryText)}</td>
        </tr>
      `;
    }).join('');
  }

  window.viewUserWorkouts = async (userId, username = '') => {
    const modal = $('athleteWorkoutsModal');
    if (!modal) return;
    modal.classList.add('open');

    if ($('athleteModalTitle')) $('athleteModalTitle').textContent = username ? `Athlete: @${username}` : "Athlete Workout & Training Data";
    if ($('athleteModalSubtitle')) $('athleteModalSubtitle').textContent = `User ID: ${userId}`;
    const tbody = $('athleteScoresTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading athlete training scores...</td></tr>`;

    activeAthleteScores = [];
    activeAthleteRange = 'all';
    document.querySelectorAll('[data-ath-range]').forEach(b => {
      b.classList.toggle('active', b.dataset.athRange === 'all');
    });

    try {
      let { data: scores, error } = await supabase
        .from('daily_training_scores')
        .select('*')
        .eq('user_id', userId)
        .order('workout_date', { ascending: false });

      if (error || !scores || scores.length === 0) {
        const { data: syncRows } = await supabase
          .from('sync_data')
          .select('*')
          .eq('user_id', userId);

        if (syncRows && syncRows.length > 0) {
          scores = parseScoresFromSyncData(syncRows, userId);
        }
      }

      activeAthleteScores = scores || [];
      renderAthleteScores();
    } catch (err) {
      console.error("Error loading athlete workouts:", err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty-state error-state">Failed to load athlete workouts: ${esc(err.message)}</td></tr>`;
    }
  };

  $('btnCloseAthleteModal')?.addEventListener('click', () => {
    $('athleteWorkoutsModal')?.classList.remove('open');
  });
  $('btnDoneAthleteModal')?.addEventListener('click', () => {
    $('athleteWorkoutsModal')?.classList.remove('open');
  });

  document.querySelectorAll('[data-ath-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ath-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAthleteRange = btn.dataset.athRange;
      renderAthleteScores();
    });
  });

  // ════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════

  loadData();
  loadExercises();
  loadExerciseScoring();
  loadSettings();
  loadTickets();
});
