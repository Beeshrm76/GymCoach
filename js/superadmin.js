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

  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      navItems.forEach(n => n.classList.remove("active"));
      sections.forEach(s => s.style.display = "none");
      btn.classList.add("active");
      const sectionId = "section" + btn.dataset.section.charAt(0).toUpperCase() + btn.dataset.section.slice(1);
      const target = $(sectionId);
      if (target) target.style.display = "block";
      // Close mobile sidebar
      $("adminSidebar")?.classList.remove("open");
    });
  });

  $("mobileMenuBtn")?.addEventListener("click", () => {
    $("adminSidebar")?.classList.toggle("open");
  });

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

  async function loadData() {
    try {
      const { data: users, error } = await supabase.from('profiles').select('*');
      if (error) throw error;

      const admins = users.filter(u => u.role === 'ADMIN');
      const standardUsers = users.filter(u => u.role === 'USER');

      $('statTotalUsers').textContent = users.length;
      $('statAdmins').textContent = admins.length;

      // Admins table
      const adminsTbody = $('adminsTableBody');
      adminsTbody.innerHTML = admins.length === 0
        ? `<tr><td colspan="5" class="empty-state">No admins found.</td></tr>`
        : admins.map(a => `
          <tr>
            <td>${esc(a.username)}</td>
            <td>${esc(a.email)}</td>
            <td><span class="role-badge role-${a.role.toLowerCase()}">${a.role}</span></td>
            <td>${esc(a.status)}</td>
            <td><button class="btn small-btn" onclick="suspendUser('${a.id}')">Suspend</button></td>
          </tr>`).join('');

      // Users table
      const usersTbody = $('usersTableBody');
      usersTbody.innerHTML = standardUsers.length === 0
        ? `<tr><td colspan="5" class="empty-state">No users found.</td></tr>`
        : standardUsers.map(u => `
          <tr>
            <td>${esc(u.username)}</td>
            <td>${esc(u.email)}</td>
            <td><span class="role-badge role-${u.role.toLowerCase()}">${u.role}</span></td>
            <td>${esc(u.admin_id || 'None')}</td>
            <td><button class="btn small-btn" onclick="assignAdminPrompt('${u.id}')">Assign Admin</button></td>
          </tr>`).join('');
    } catch (err) {
      console.error(err);
      toast("Failed to load admin data.", "error");
    }
  }

  window.suspendUser = async (id) => {
    if (!confirm("Suspend this user?")) return;
    const { error } = await supabase.from('profiles').update({ status: 'SUSPENDED' }).eq('id', id);
    if (error) toast(error.message, "error");
    else loadData();
  };

  window.assignAdminPrompt = async (userId) => {
    const adminId = prompt("Enter the Admin UUID to assign this user to:");
    if (adminId) {
      const { error } = await supabase.from('profiles').update({ admin_id: adminId }).eq('id', userId);
      if (error) toast(error.message, "error");
      else loadData();
    }
  };

  $("btnCreateAdmin")?.addEventListener("click", () => {
    alert("To create an admin, register a normal user via the UI, then assign the ADMIN role via the profiles table.");
  });

  // ════════════════════════════════════════════════════════════════
  // EXERCISES MANAGER (Phase 2)
  // ════════════════════════════════════════════════════════════════

  let defaultExercises = [];

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
    renderExercises();
    if ($('statExercises')) $('statExercises').textContent = defaultExercises.length;
  }

  // ── Render exercises table with search & filter ──
  function renderExercises() {
    const tbody = $('exercisesTableBody');
    const searchTerm = ($('exerciseSearch')?.value || '').toLowerCase().trim();
    const filterType = $('exerciseFilterType')?.value || '';
    const filterBody = $('exerciseFilterBody')?.value || '';

    let filtered = defaultExercises;
    if (searchTerm) {
      filtered = filtered.filter(ex => {
        const text = [ex.name, ...(ex.aliases || [])].join(' ').toLowerCase();
        return text.includes(searchTerm);
      });
    }
    if (filterType) filtered = filtered.filter(ex => (ex.type || '') === filterType);
    if (filterBody) filtered = filtered.filter(ex => (ex.body_part || '') === filterBody);

    if ($('exerciseCount')) $('exerciseCount').textContent = `${filtered.length} of ${defaultExercises.length} exercises`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${searchTerm || filterType || filterBody ? 'No matching exercises.' : 'No exercises in library.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(ex => {
      const origIdx = defaultExercises.indexOf(ex);
      const iconHtml = ex.icon_url
        ? `<img src="${esc(ex.icon_url)}" alt="" style="width:100%;height:100%;object-fit:cover;">`
        : `<span style="font-size:16px;">🏋️</span>`;
      const videoStatus = ex.video_url ? '✓ Link' : '—';
      return `
        <tr>
          <td>
            <div class="ex-icon-cell" title="Click to upload icon">
              ${iconHtml}
              <input type="file" accept="image/*" onchange="uploadExerciseIcon(${origIdx}, this)">
            </div>
          </td>
          <td><strong>${esc(ex.name)}</strong>${ex.aliases?.length ? `<br><small style="color:var(--text-muted)">${esc(ex.aliases.join(', '))}</small>` : ''}</td>
          <td><span class="role-badge" style="background:var(--bg-input);font-size:11px;">${esc(ex.type || '—')}</span></td>
          <td>${esc(ex.body_part || '—')}</td>
          <td>${videoStatus}</td>
          <td>
            <button class="btn small-btn" onclick="editExercise(${origIdx})">Edit</button>
            <button class="btn small-btn btn-danger" onclick="deleteExercise(${origIdx})">Delete</button>
          </td>
        </tr>`;
    }).join('');
  }

  // Wiring search & filter inputs
  $('exerciseSearch')?.addEventListener('input', renderExercises);
  $('exerciseFilterType')?.addEventListener('change', renderExercises);
  $('exerciseFilterBody')?.addEventListener('change', renderExercises);

  // ── Exercise Modal ──
  function openExerciseModal(editIdx = -1) {
    $('exerciseEditIndex').value = editIdx;
    if (editIdx >= 0) {
      const ex = defaultExercises[editIdx];
      $('exerciseModalTitle').textContent = 'Edit Exercise';
      $('exModalName').value = ex.name || '';
      $('exModalType').value = ex.type || '';
      $('exModalBodyPart').value = ex.body_part || '';
      $('exModalAliases').value = (ex.aliases || []).join(', ');
      $('exModalVideo').value = ex.video_url || '';
      $('btnConfirmExercise').textContent = 'Save Changes';
      // Show existing icon preview
      if (ex.icon_url) {
        $('exModalIconPreview').innerHTML = `<img src="${esc(ex.icon_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`;
      } else {
        $('exModalIconPreview').innerHTML = '';
      }
    } else {
      $('exerciseModalTitle').textContent = 'Add Exercise';
      $('exModalName').value = '';
      $('exModalType').value = '';
      $('exModalBodyPart').value = '';
      $('exModalAliases').value = '';
      $('exModalVideo').value = '';
      $('exModalIcon').value = '';
      $('exModalIconPreview').innerHTML = '';
      $('btnConfirmExercise').textContent = 'Add Exercise';
    }
    $('exerciseAddModal').style.display = 'flex';
  }

  function closeExerciseModal() {
    $('exerciseAddModal').style.display = 'none';
  }

  $('btnAddExercise')?.addEventListener('click', () => openExerciseModal(-1));
  $('btnCancelExercise')?.addEventListener('click', closeExerciseModal);
  $('exerciseAddModal')?.addEventListener('click', e => {
    if (e.target === $('exerciseAddModal')) closeExerciseModal();
  });

  // ── Confirm add/edit ──
  $('btnConfirmExercise')?.addEventListener('click', async () => {
    const name = ($('exModalName')?.value || '').trim();
    if (!name) return toast("Exercise name is required.", "error");

    const type = $('exModalType')?.value || '';
    const body_part = $('exModalBodyPart')?.value || '';
    const aliases = ($('exModalAliases')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const video_url = ($('exModalVideo')?.value || '').trim();
    const editIdx = parseInt($('exerciseEditIndex')?.value ?? '-1', 10);

    // Handle icon upload if a file was selected
    let icon_url = editIdx >= 0 ? (defaultExercises[editIdx]?.icon_url || '') : '';
    const iconFile = $('exModalIcon')?.files?.[0];
    if (iconFile) {
      try {
        icon_url = await uploadMediaFile(iconFile, 'exercise-icons');
      } catch (err) {
        toast("Icon upload failed: " + err.message, "error");
      }
    }

    const exerciseObj = { name, type, body_part, aliases, video_url, icon_url };

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

      // Workout Defaults
      $('settingDefaultRest').value = settingsMap['default_rest_timer'] || '';
      $('settingDefaultUnit').value = settingsMap['default_weight_unit'] || 'kg';
      $('settingMaxSets').value = settingsMap['max_sets_per_exercise'] || '';
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

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
      toast("Logo uploaded and saved!");
    } catch (err) {
      toast("Upload failed: " + err.message, "error");
    } finally {
      btn.textContent = "Upload";
      btn.disabled = false;
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
        'default_rest_timer': parseInt($('settingDefaultRest')?.value, 10) || null,
        'default_weight_unit': $('settingDefaultUnit')?.value || 'kg',
        'max_sets_per_exercise': parseInt($('settingMaxSets')?.value, 10) || null,
      };

      // Batch upsert all settings
      const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
      const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;

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
    try {
      const { data: tickets, error } = await supabase.from('support_tickets').select('*, profiles:user_id(username)').order('created_at', { ascending: false });
      if (error) throw error;

      const openCount = tickets.filter(t => t.status === 'OPEN').length;
      if ($('statOpenTickets')) $('statOpenTickets').textContent = openCount;

      const tbody = $('ticketsTableBody');
      if (tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No support tickets found.</td></tr>`;
        return;
      }

      tbody.innerHTML = tickets.map(t => {
        const date = new Date(t.created_at).toLocaleString();
        const username = t.profiles?.username || 'Unknown';
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
  // BOOT
  // ════════════════════════════════════════════════════════════════

  loadData();
  loadExercises();
  loadSettings();
  loadTickets();
});
