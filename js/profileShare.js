// js/profileShare.js — Profile Search, Public Profile Viewer, and Shared Plan Dashboard
// Handles searching profiles, viewing other profiles (display name, bio, height, weight),
// and viewing/importing shared workout plans and performance dashboards.

window.ProfileShare = (() => {
  const $ = id => document.getElementById(id);
  const sb = () => window.supabaseClient;

  let currentViewedProfile = null;
  let currentSharedProject = null;
  let searchDebounceTimer = null;

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function cmToFtIn(cm) {
    if (!cm || cm <= 0) return "";
    const totalInches = cm / 2.54;
    const ft = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return `${cm} cm (${ft}′${inches}″)`;
  }

  function formatProfileId(user) {
    if (!user) return "";
    if (user.profile_code) return user.profile_code;
    const uid = user.id ? String(user.id).replace(/-/g, '').slice(0, 8).toUpperCase() : '88888888';
    return `GC-${uid}`;
  }

  // ── Init & Event Binding ─────────────────────────────────────

  function init() {
    // Sidebar search input
    const sidebarInput = $("sidebarProfileSearch");
    if (sidebarInput) {
      sidebarInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          openSearchModal(sidebarInput.value.trim());
        }
      });
      sidebarInput.addEventListener("focus", () => {
        if (sidebarInput.value.trim()) {
          openSearchModal(sidebarInput.value.trim());
        }
      });
    }

    // Modal search input
    const modalInput = $("profileSearchModalInput");
    if (modalInput) {
      modalInput.addEventListener("input", () => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          performSearch(modalInput.value.trim());
        }, 300);
      });
    }

    // Shared Plan Dashboard Tabs
    const tabWorkout = $("tabSharedWorkout");
    const tabPerf = $("tabSharedPerformance");
    if (tabWorkout && tabPerf) {
      tabWorkout.addEventListener("click", () => switchSharedDashboardTab("workout"));
      tabPerf.addEventListener("click", () => switchSharedDashboardTab("performance"));
    }

    // "Use this plan" buttons
    const btnUse = $("btnUseSharedPlan");
    const btnUseFooter = $("btnUseSharedPlanFooter");
    if (btnUse) btnUse.addEventListener("click", adoptSharedPlan);
    if (btnUseFooter) btnUseFooter.addEventListener("click", adoptSharedPlan);

    // "View Shared Plan" button in other profile modal
    const btnOpenShared = $("btnOpenSharedPlan");
    if (btnOpenShared) {
      btnOpenShared.addEventListener("click", () => {
        if (currentViewedProfile) {
          openSharedPlanDashboard(currentViewedProfile);
        }
      });
    }
  }

  // ── Profile Search ──────────────────────────────────────────

  function openSearchModal(initialQuery = "") {
    if (window.UI?.openModal) {
      UI.openModal("profileSearchModal");
    }
    const modalInput = $("profileSearchModalInput");
    if (modalInput) {
      modalInput.value = initialQuery;
      modalInput.focus();
    }
    performSearch(initialQuery);
  }

  async function performSearch(query) {
    const list = $("profileSearchResultsList");
    const countLabel = $("profileSearchResultsCount");
    if (!list) return;

    if (!query || query.length < 2) {
      list.innerHTML = `
        <div style="text-align:center; padding: 24px 10px; color: var(--text-secondary); font-size: 13px;">
          Type at least 2 characters to search by name or Profile ID (e.g. <code>GC-A1B2C3D4</code>).
        </div>
      `;
      if (countLabel) countLabel.textContent = "Type to search profiles";
      return;
    }

    list.innerHTML = `
      <div style="text-align:center; padding: 20px; color: var(--text-secondary);">
        <span>🔍 Searching profiles...</span>
      </div>
    `;

    const client = sb();
    if (!client) {
      list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--danger);">Database connection not available.</div>`;
      return;
    }

    try {
      // Search by profile_code, display_name, or username (privacy: only display_name & code shown)
      const cleanQ = query.trim();
      let queryBuilder = client
        .from('profiles')
        .select('id, username, display_name, name, bio, height_cm, weight_kg, profile_code, share_plan, share_performance, shared_project_id, avatar_url')
        .or(`profile_code.ilike.%${cleanQ}%,display_name.ilike.%${cleanQ}%,name.ilike.%${cleanQ}%,username.ilike.%${cleanQ}%`)
        .limit(20);

      const { data: results, error } = await queryBuilder;

      if (error) throw error;

      if (!results || results.length === 0) {
        list.innerHTML = `
          <div style="text-align:center; padding: 24px 10px; color: var(--text-secondary); font-size: 13px;">
            No profiles found matching "<b>${esc(cleanQ)}</b>".
          </div>
        `;
        if (countLabel) countLabel.textContent = "0 profiles found";
        return;
      }

      if (countLabel) countLabel.textContent = `${results.length} profile${results.length === 1 ? '' : 's'} found`;

      list.innerHTML = results.map(p => {
        // Privacy: NEVER display username, only display name / full name
        const dName = p.display_name || p.name || "Fitness Member";
        const initial = dName.charAt(0).toUpperCase();
        const pCode = formatProfileId(p);
        const avatar = p.avatar_url 
          ? `<img src="${esc(p.avatar_url)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;" alt="Avatar">`
          : `<div style="width:40px; height:40px; border-radius:50%; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:16px;">${initial}</div>`;
        
        const hasPlan = p.share_plan === true;

        return `
          <div class="card" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; gap:12px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px;">
            <div style="display:flex; align-items:center; gap:12px; min-width:0;">
              ${avatar}
              <div style="min-width:0;">
                <div style="font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${esc(dName)}
                </div>
                <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
                  <span style="font-family:monospace; font-size:11px; background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px; color:var(--text-secondary); font-weight:700;">${pCode}</span>
                  ${hasPlan ? '<span style="font-size:11px; color:var(--accent); font-weight:500;">✓ Shared Plan</span>' : ''}
                </div>
              </div>
            </div>
            <button class="small-btn primary" data-view-profile-id="${esc(p.id)}" style="flex-shrink:0;">View Profile</button>
          </div>
        `;
      }).join("");

      // Wire view buttons
      list.querySelectorAll("[data-view-profile-id]").forEach(btn => {
        btn.addEventListener("click", () => {
          const pid = btn.dataset.viewProfileId;
          const found = results.find(r => r.id === pid);
          if (found) {
            openOtherProfile(found);
          }
        });
      });

    } catch (err) {
      console.error("Profile search error:", err);
      list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--danger);">Search failed: ${esc(err.message)}</div>`;
    }
  }

  // ── Other Profile Modal ──────────────────────────────────────

  function openOtherProfile(profile) {
    currentViewedProfile = profile;

    // Display Name ONLY (privacy requirement: no username)
    const displayName = profile.display_name || profile.name || "Fitness Member";
    if ($("otherProfileDisplayName")) $("otherProfileDisplayName").textContent = displayName;

    // Avatar
    const avatarEl = $("otherProfileAvatar");
    if (avatarEl) {
      if (profile.avatar_url) {
        avatarEl.innerHTML = `<img src="${esc(profile.avatar_url)}" style="width:100%; height:100%; object-fit:cover;" alt="Avatar">`;
      } else {
        avatarEl.innerHTML = `👤`;
      }
    }

    // Profile ID (Visible, never masked)
    if ($("otherProfileCode")) $("otherProfileCode").textContent = formatProfileId(profile);

    // Bio
    if ($("otherProfileBio")) {
      $("otherProfileBio").textContent = profile.bio ? profile.bio : "No bio provided.";
    }

    // Height
    if ($("otherProfileHeight")) {
      $("otherProfileHeight").textContent = profile.height_cm ? cmToFtIn(profile.height_cm) : "—";
    }

    // Weight
    if ($("otherProfileWeight")) {
      if (profile.weight_kg) {
        const lb = (profile.weight_kg * 2.20462).toFixed(1);
        $("otherProfileWeight").textContent = `${profile.weight_kg} kg (${lb} lb)`;
      } else {
        $("otherProfileWeight").textContent = "—";
      }
    }

    // Shared Plan Button state
    const btnPlan = $("btnOpenSharedPlan");
    if (btnPlan) {
      if (profile.share_plan) {
        btnPlan.disabled = false;
        btnPlan.innerHTML = `<span>📋 View Shared Workout Plan &amp; Dashboard</span> ➔`;
        btnPlan.style.opacity = "1";
      } else {
        btnPlan.disabled = true;
        btnPlan.innerHTML = `<span>🔒 Workout Plan Private</span>`;
        btnPlan.style.opacity = "0.5";
      }
    }

    if (window.UI?.openModal) {
      UI.openModal("otherProfileModal");
    }
  }

  // ── Shared Plan Dashboard ────────────────────────────────────

  async function openSharedPlanDashboard(profile) {
    currentViewedProfile = profile;
    currentSharedProject = null;

    // Privacy: Display Name ONLY
    const displayName = profile.display_name || profile.name || "Member";
    const profileId = formatProfileId(profile);
    if ($("sharedPlanHeaderTitle")) $("sharedPlanHeaderTitle").textContent = `${displayName}'s Workout Plan`;
    if ($("sharedPlanHeaderAuthor")) $("sharedPlanHeaderAuthor").textContent = `Created by ${displayName} · ${profileId}`;

    // Reset tabs
    switchSharedDashboardTab("workout");

    if (window.UI?.openModal) {
      UI.openModal("sharedPlanModal");
    }

    const daysList = $("sharedWorkoutDaysList");
    if (daysList) daysList.innerHTML = `<div style="text-align:center; padding:30px;" class="muted">Loading workout plan...</div>`;

    // Fetch shared project from Supabase sync_data
    const client = sb();
    if (!client) {
      if (daysList) daysList.innerHTML = `<div style="color:var(--danger); padding:20px;">Could not connect to database.</div>`;
      return;
    }

    try {
      const { data, error } = await client
        .from('sync_data')
        .select('value')
        .eq('user_id', profile.id)
        .eq('storage_key', 'gymcoach_projects_v4')
        .single();

      if (error || !data || !data.value) {
        // If not in sync_data, try user_projects relational table
        await loadFromRelationalTables(profile);
        return;
      }

      let projects = data.value;
      if (typeof projects === 'string') {
        try { projects = JSON.parse(projects); } catch (e) {}
      }

      if (!Array.isArray(projects) || projects.length === 0) {
        if (daysList) daysList.innerHTML = `<div style="text-align:center; padding:30px;" class="muted">This user has no workout projects saved yet.</div>`;
        return;
      }

      // Pick selected project or first project
      let targetProject = null;
      if (profile.shared_project_id) {
        targetProject = projects.find(p => p.id === profile.shared_project_id);
      }
      if (!targetProject) targetProject = projects[0];
      currentSharedProject = targetProject;

      // Multiple projects switcher
      const switcher = $("sharedPlanProjectSwitcher");
      const projectSelect = $("sharedPlanProjectSelect");
      const countBadge = $("sharedPlanProjectsCountBadge");

      if (projects.length > 1) {
        if (switcher) switcher.style.display = "flex";
        if (countBadge) countBadge.textContent = `${projects.length} Projects Available`;
        if (projectSelect) {
          projectSelect.innerHTML = projects.map(p => `
            <option value="${esc(p.id)}" ${p.id === currentSharedProject.id ? 'selected' : ''}>
              ${esc(p.name)} (${(p.days || []).length} days)
            </option>
          `).join("");

          projectSelect.onchange = () => {
            const selected = projects.find(p => p.id === projectSelect.value);
            if (selected) {
              currentSharedProject = selected;
              renderSharedWorkoutProject(currentSharedProject);
              renderSharedPerformancePanel(profile, currentSharedProject);
            }
          };
        }
      } else {
        if (switcher) switcher.style.display = "none";
      }

      renderSharedWorkoutProject(currentSharedProject);
      renderSharedPerformancePanel(profile, currentSharedProject);

    } catch (err) {
      console.warn("Could not load from sync_data, trying relational tables:", err);
      await loadFromRelationalTables(profile);
    }
  }

  async function loadFromRelationalTables(profile) {
    const daysList = $("sharedWorkoutDaysList");
    const client = sb();

    try {
      const { data: projects, error } = await client
        .from('user_projects')
        .select('*')
        .eq('user_id', profile.id)
        .limit(1);

      if (error || !projects || !projects.length) {
        if (daysList) daysList.innerHTML = `<div style="text-align:center; padding:30px;" class="muted">No public workout plan found for this user.</div>`;
        return;
      }

      const p = projects[0];
      // Fetch days
      const { data: days } = await client
        .from('user_days')
        .select('*')
        .eq('user_id', profile.id)
        .eq('project_id', p.id);

      // Fetch exercises
      const { data: exercises } = await client
        .from('user_exercises')
        .select('*')
        .eq('user_id', profile.id);

      const builtProject = {
        id: p.id,
        name: p.name || "Shared Workout",
        goal: p.goal || "",
        intensityBand: p.intensity_band || "Moderate",
        days: (days || []).map(d => ({
          id: d.id,
          name: d.name || "Workout Day",
          title: d.title || "",
          type: d.type || "workout",
          exercises: (exercises || []).filter(e => e.day_id === d.id).map(e => ({
            id: e.id,
            name: e.name,
            setCount: e.set_count || 3,
            targetReps: e.target_reps || "8-12",
            targetWeight: e.target_weight || "",
            weightUnit: e.weight_unit || "kg",
            intensityBand: e.intensity_band || "",
            cues: e.cues || "",
            notes: e.notes || "",
            setColumns: [{ key: "weight", label: "Weight", unit: "kg" }, { key: "reps", label: "Reps", unit: "reps" }],
            logs: []
          }))
        }))
      };

      currentSharedProject = builtProject;
      renderSharedWorkoutProject(builtProject);
      renderSharedPerformancePanel(profile, builtProject);

    } catch (err) {
      console.error("Failed to load workout from relational tables:", err);
      if (daysList) daysList.innerHTML = `<div style="color:var(--danger); padding:20px;">Failed to load workout plan: ${esc(err.message)}</div>`;
    }
  }

  function renderSharedWorkoutProject(project) {
    if (!project) return;

    if ($("sharedPlanProjectName")) $("sharedPlanProjectName").textContent = project.name || "Workout Plan";
    if ($("sharedPlanProjectGoal")) $("sharedPlanProjectGoal").textContent = project.goal ? `Goal: ${project.goal}` : "General Training";
    if ($("sharedPlanIntensityBand")) $("sharedPlanIntensityBand").textContent = project.intensityBand || "Moderate";

    const daysList = $("sharedWorkoutDaysList");
    if (!daysList) return;

    const days = project.days || [];
    if (!days.length) {
      daysList.innerHTML = `<div style="text-align:center; padding:20px;" class="muted">No workout days configured in this plan.</div>`;
      return;
    }

    daysList.innerHTML = days.map((d, dIdx) => {
      const exList = (d.exercises || []).map((ex, eIdx) => {
        const meta = [
          ex.setCount ? `${ex.setCount} sets` : null,
          ex.targetReps ? `${ex.targetReps} reps` : null,
          ex.targetWeight ? `${ex.targetWeight} ${ex.weightUnit || 'kg'}` : null,
          ex.intensityBand ? `${ex.intensityBand} Intensity` : null
        ].filter(Boolean).join(" · ");

        return `
          <div style="padding:10px 12px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:6px; margin-top:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:600; font-size:13px;">${eIdx + 1}. ${esc(ex.name)}</span>
              <span style="font-size:12px; color:var(--text-secondary);">${esc(meta)}</span>
            </div>
            ${ex.notes ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px; font-style:italic;">Notes: ${esc(ex.notes)}</div>` : ''}
            ${ex.cues ? `<div style="font-size:11px; color:var(--accent); margin-top:2px;">Cues: ${esc(ex.cues)}</div>` : ''}
          </div>
        `;
      }).join("");

      return `
        <div class="card" style="padding:14px; background:rgba(0,0,0,0.15); border:1px solid var(--border); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <b style="font-size:14px;">${esc(d.name || `Day ${dIdx + 1}`)}</b>
            <span class="muted small">${(d.exercises || []).length} exercises</span>
          </div>
          ${d.title ? `<div class="muted small" style="margin-bottom:8px;">${esc(d.title)}</div>` : ''}
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${exList || '<span class="muted small">No exercises in this day.</span>'}
          </div>
        </div>
      `;
    }).join("");
  }

  async function renderSharedPerformancePanel(profile, project) {
    const perfPanel = $("sharedPerformancePanel");
    if (!perfPanel) return;

    // Check if performance sharing is enabled
    if (!profile.share_performance) {
      perfPanel.innerHTML = `
        <div class="card" style="text-align:center; padding:36px 20px; background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:8px;">
          <div style="font-size:36px; margin-bottom:12px;">🔒</div>
          <h3 style="margin:0 0 8px;">Performance Details Kept Private</h3>
          <p class="muted" style="max-width:440px; margin:0 auto; font-size:13px; line-height:1.5;">
            ${esc(profile.display_name || 'This user')} has chosen to keep their training scores, dates, weights, sets, and reps private.
            Only their workout split and exercises are visible.
          </p>
        </div>
      `;
      return;
    }

    // Performance is visible! Fetch their DTS scores and render exercise log history
    perfPanel.innerHTML = `<div style="text-align:center; padding:30px;" class="muted">Loading performance data...</div>`;

    const client = sb();
    let dtsScores = [];
    if (client) {
      try {
        const { data } = await client
          .from('daily_training_scores')
          .select('workout_date, score, score_band, strength_component, cardio_component')
          .eq('user_id', profile.id)
          .order('workout_date', { ascending: false })
          .limit(15);
        if (data) dtsScores = data;
      } catch (e) {
        console.warn("Could not fetch shared DTS scores:", e);
      }
    }

    // Gather logged sets from project exercises
    const loggedRows = [];
    if (project && project.days) {
      project.days.forEach(d => {
        (d.exercises || []).forEach(ex => {
          (ex.logs || []).forEach((log, idx) => {
            const vals = (ex.setColumns || [])
              .map(c => (log.values && log.values[c.key]) ? `${c.label} ${log.values[c.key]}` : null)
              .filter(Boolean).join(" · ");
            if (vals || log.completed) {
              loggedRows.push({
                exercise: ex.name,
                day: d.name,
                set: idx + 1,
                date: log.date ? log.date.slice(0, 10) : "—",
                values: vals || "Completed",
                completed: log.completed
              });
            }
          });
        });
      });
    }

    // Build DTS table and Logged Sets table
    let dtsHtml = "";
    if (dtsScores.length > 0) {
      dtsHtml = `
        <div class="card" style="padding:14px; margin-bottom:14px; background:rgba(0,0,0,0.2); border:1px solid var(--border);">
          <h4 style="margin:0 0 10px; font-size:13px; color:var(--text-secondary); text-transform:uppercase;">Daily Training Scores (DTS)</h4>
          <div class="table-wrap mini-table-wrap">
            <table class="data-table mini-table" style="width:100%;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>DTS</th>
                  <th>Intensity Band</th>
                  <th>Strength</th>
                  <th>Cardio</th>
                </tr>
              </thead>
              <tbody>
                ${dtsScores.map(s => `
                  <tr>
                    <td><b>${esc(s.workout_date)}</b></td>
                    <td><b style="color:var(--accent);">${s.score}</b></td>
                    <td><span class="role-badge" style="font-size:10px;">${esc(s.score_band)}</span></td>
                    <td>${s.strength_component}</td>
                    <td>${s.cardio_component > 0 ? '+' + s.cardio_component : '0'}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    let logsHtml = "";
    if (loggedRows.length > 0) {
      logsHtml = `
        <div class="card" style="padding:14px; background:rgba(0,0,0,0.2); border:1px solid var(--border);">
          <h4 style="margin:0 0 10px; font-size:13px; color:var(--text-secondary); text-transform:uppercase;">Logged Weights, Sets &amp; Reps</h4>
          <div class="table-wrap mini-table-wrap" style="max-height:260px; overflow-y:auto;">
            <table class="data-table mini-table" style="width:100%;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Exercise</th>
                  <th>Set</th>
                  <th>Recorded Values</th>
                </tr>
              </thead>
              <tbody>
                ${loggedRows.slice(0, 30).map(r => `
                  <tr>
                    <td><small class="muted">${esc(r.date)}</small></td>
                    <td><b>${esc(r.exercise)}</b></td>
                    <td>Set ${r.set}</td>
                    <td>${esc(r.values)} ${r.completed ? '✓' : ''}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      logsHtml = `
        <div class="card" style="padding:14px; background:rgba(0,0,0,0.2); border:1px solid var(--border); text-align:center;">
          <p class="muted small" style="margin:0;">No individual set log records currently uploaded in this project.</p>
        </div>
      `;
    }

    perfPanel.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${dtsHtml}
        ${logsHtml}
      </div>
    `;
  }

  function switchSharedDashboardTab(tab) {
    const tabWorkout = $("tabSharedWorkout");
    const tabPerf = $("tabSharedPerformance");
    const panelWorkout = $("sharedWorkoutPanel");
    const panelPerf = $("sharedPerformancePanel");

    if (tab === "workout") {
      tabWorkout?.classList.add("active");
      tabPerf?.classList.remove("active");
      if (panelWorkout) panelWorkout.style.display = "block";
      if (panelPerf) panelPerf.style.display = "none";
    } else {
      tabPerf?.classList.add("active");
      tabWorkout?.classList.remove("active");
      if (panelWorkout) panelWorkout.style.display = "none";
      if (panelPerf) panelPerf.style.display = "block";
    }
  }

  // ── "Use this plan" (Clone into current user) ────────────────

  async function adoptSharedPlan() {
    if (!currentSharedProject) {
      UI.toast("No workout plan loaded to adopt.", "error");
      return;
    }

    const authorName = currentViewedProfile?.display_name || currentViewedProfile?.name || "Member";
    const confirmed = await UI.confirm(
      `Adopt "${currentSharedProject.name}"?`,
      `This will import the complete workout split and exercises from ${authorName} into your workout projects and set it as your active plan.`,
      { confirmLabel: "Use This Plan" }
    );

    if (!confirmed) return;

    try {
      const allProjects = window.Store?.all() || [];
      const newProjectId = "proj-" + Date.now();
      
      // Deep clone project and strip foreign logs
      const cloned = JSON.parse(JSON.stringify(currentSharedProject));
      cloned.id = newProjectId;
      cloned.name = `${cloned.name} (from ${authorName})`;
      
      // Reset logs for new owner
      (cloned.days || []).forEach((d, dIdx) => {
        d.id = `day-${newProjectId}-${dIdx + 1}`;
        (d.exercises || []).forEach((ex, eIdx) => {
          ex.id = `ex-${newProjectId}-${dIdx + 1}-${eIdx + 1}`;
          ex.logs = [];
        });
      });

      allProjects.push(cloned);
      localStorage.setItem("gymcoach_projects_v4", JSON.stringify(allProjects));
      localStorage.setItem("gymcoach_active_project_v4", newProjectId);

      // Trigger sync if logged in
      if (window.SyncEngine?.queueSync) {
        window.SyncEngine.queueSync("gymcoach_projects_v4");
        window.SyncEngine.queueSync("gymcoach_active_project_v4");
      }

      UI.toast(`Plan "${cloned.name}" imported and set as active!`, "success");
      UI.closeModal("sharedPlanModal");
      UI.closeModal("otherProfileModal");

      // Re-render the application
      if (window.renderAll) window.renderAll();

    } catch (err) {
      console.error("Failed to adopt plan:", err);
      UI.toast("Failed to import plan: " + err.message, "error");
    }
  }

  return {
    init,
    openSearchModal,
    openOtherProfile,
    openSharedPlanDashboard
  };
})();

// Auto-init when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.ProfileShare?.init();
});
