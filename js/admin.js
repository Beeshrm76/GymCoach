// admin.js
document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabaseClient;

  // Wait for auth init
  await window.Auth.init();

  if (!window.Auth.isLoggedIn() || (window.Auth.getUser().role !== 'ADMIN' && window.Auth.getUser().role !== 'SUPER_ADMIN')) {
    document.body.innerHTML = "<h2 style='color:white;text-align:center;padding:50px;'>Access Denied. Admin only.</h2>";
    setTimeout(() => { window.location.href = "index.html"; }, 2000);
    return;
  }

  // Basic navigation
  const navItems = document.querySelectorAll(".nav-item[data-section]");
  const sections = document.querySelectorAll(".admin-section");

  // Mobile Sidebar & Swipe Logic
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const adminSidebar = document.getElementById("adminSidebar");
  const adminDrawerScrim = document.getElementById("adminDrawerScrim");
  
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
      const target = document.getElementById(sectionId);
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

  document.getElementById("adminLogoutBtn")?.addEventListener("click", () => window.Auth.logout());

  // Load data (RLS will enforce they only see assigned users)
  async function loadData() {
    try {
      const { data: users, error } = await supabase
         .from('profiles')
         .select('*')
         .eq('role', 'USER'); // RLS automatically filters to assigned users
      
      if (error) throw error;

      document.getElementById('statTotalUsers').textContent = users.length;
      document.getElementById('statActiveUsers').textContent = users.filter(u => u.status === 'ACTIVE').length;

      // Render Users
      const usersTbody = document.getElementById('usersTableBody');
      if (users.length === 0) {
        usersTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No assigned users found.</td></tr>`;
      } else {
        usersTbody.innerHTML = users.map(u => `
          <tr>
            <td>${u.username}</td>
            <td>${u.email}</td>
            <td>${u.display_name || '—'}</td>
            <td>${u.status}</td>
            <td>
               <button class="btn small-btn" onclick="viewUserWorkouts('${u.id}', '${(u.username || '').replace(/'/g, "\\'")}')">View Data</button>
            </td>
          </tr>
        `).join('');
      }

    } catch (err) {
      console.error(err);
      const usersTbody = document.getElementById('usersTableBody');
      if (usersTbody) usersTbody.innerHTML = `<tr><td colspan="5" class="empty-state error-state">Couldn't load users: ${(err?.message || 'unknown error').replace(/</g, '&lt;')}</td></tr>`;
    }
  }

  // ── Athlete Workouts & DTS Viewer ─────────────────────────
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
    const tbody = document.getElementById('athleteScoresTableBody');
    if (!tbody) return;

    let filtered = [...activeAthleteScores];
    if (activeAthleteRange !== 'all') {
      const days = activeAthleteRange === '7d' ? 7 : activeAthleteRange === '30d' ? 30 : 90;
      const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      filtered = filtered.filter(s => (s.workout_date || '') >= cutoff);
    }

    // Update KPI badges
    const totalCount = filtered.length;
    document.getElementById('athKpiWorkouts').textContent = totalCount;

    if (totalCount === 0) {
      document.getElementById('athKpiAvgDts').textContent = '—';
      document.getElementById('athKpiMaxDts').textContent = '—';
      document.getElementById('athKpiSplit').textContent = '—';
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

    document.getElementById('athKpiAvgDts').textContent = Math.round(sumDts / totalCount);
    document.getElementById('athKpiMaxDts').textContent = maxDts;
    const totalLoad = totalStr + (totalCar * 10);
    if (totalLoad > 0) {
      const pct = Math.round((totalStr / totalLoad) * 100);
      document.getElementById('athKpiSplit').textContent = `${pct}% / ${100 - pct}%`;
    } else {
      document.getElementById('athKpiSplit').textContent = '100% Strength';
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
    const modal = document.getElementById('athleteWorkoutsModal');
    if (!modal) return;
    modal.classList.add('open');

    document.getElementById('athleteModalTitle').textContent = username ? `Athlete: @${username}` : "Athlete Workout & Training Data";
    document.getElementById('athleteModalSubtitle').textContent = `User ID: ${userId}`;
    const tbody = document.getElementById('athleteScoresTableBody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading athlete training scores...</td></tr>`;

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
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state error-state">Failed to load athlete workouts: ${esc(err.message)}</td></tr>`;
    }
  };

  document.getElementById('btnCloseAthleteModal')?.addEventListener('click', () => {
    document.getElementById('athleteWorkoutsModal')?.classList.remove('open');
  });
  document.getElementById('btnDoneAthleteModal')?.addEventListener('click', () => {
    document.getElementById('athleteWorkoutsModal')?.classList.remove('open');
  });

  document.querySelectorAll('[data-ath-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ath-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAthleteRange = btn.dataset.athRange;
      renderAthleteScores();
    });
  });

  // --- SUPPORT TICKETS ---
  async function loadTickets() {
    const tbody = document.getElementById('ticketsTableBody');
    try {
      // Admin loads tickets (RLS enforces they only see tickets from assigned users)
      const { data: tickets, error } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      if (!tickets || tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No support tickets found from assigned users.</td></tr>`;
        return;
      }

      // Resolve usernames from profiles table
      const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];
      const userMap = {};
      if (userIds.length > 0) {
        try {
          const { data: profs } = await supabase.from('profiles').select('id, username').in('id', userIds);
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
          <td>${date}</td>
          <td>${username}</td>
          <td><b>${t.title}</b><br><small class="muted">${t.body}</small></td>
          <td><span class="role-badge" style="background:${t.status==='OPEN'?'var(--danger)':'var(--success)'}">${t.status}</span></td>
          <td>
            <button class="btn small-btn" onclick="replyTicket('${t.id}')">Reply</button>
          </td>
        </tr>
      `}).join('');
    } catch (err) {
      console.error(err);
      // Never leave the table stuck on "Loading..." — show what went wrong
      // instead so it's obvious this is an error, not zero tickets.
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-state error-state">Couldn't load tickets: ${(err?.message || 'unknown error').replace(/</g, '&lt;')}</td></tr>`;
    }
  }

  window.replyTicket = async (id) => {
    const response = prompt("Enter your response to this user:");
    if (!response) return;
    
    try {
      const { error } = await supabase.from('support_tickets').update({ 
        response: response, 
        status: 'CLOSED' 
      }).eq('id', id);
      
      if (error) throw error;
      loadTickets();
      toast("Reply sent.");
    } catch (err) {
      console.error(err);
      toast("Failed to send reply: " + err.message, "error");
    }
  };

  // ── AI Models Management ────────────────────────────────────
  function toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className = `admin-toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function esc(s) {
    if (!s) return "";
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

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
  let adminModelsMap = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_MODELS));

  async function loadAiModels() {
    try {
      const { data, error } = await supabase.from('system_settings').select('*').eq('key', 'ai_provider_models').single();
      if (!error && data && data.value && typeof data.value === 'object') {
        adminModelsMap = { ...DEFAULT_PROVIDER_MODELS, ...data.value };
      } else {
        const cached = localStorage.getItem('gymcoach_provider_models');
        if (cached) {
          adminModelsMap = { ...DEFAULT_PROVIDER_MODELS, ...JSON.parse(cached) };
        }
      }
    } catch (e) {
      const cached = localStorage.getItem('gymcoach_provider_models');
      if (cached) {
        try { adminModelsMap = { ...DEFAULT_PROVIDER_MODELS, ...JSON.parse(cached) }; } catch(err){}
      }
    }
    renderAdminModelTags();
  }

  function renderAdminModelTags() {
    const provider = document.getElementById('adminModelProvider')?.value || 'gemini';
    const container = document.getElementById('adminModelTagsContainer');
    if (!container) return;
    const models = adminModelsMap[provider] || [];
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
        if (adminModelsMap[prov]) {
          adminModelsMap[prov].splice(index, 1);
          renderAdminModelTags();
        }
      };
    });
  }

  document.getElementById('adminModelProvider')?.addEventListener('change', renderAdminModelTags);

  function addModelForAdmin() {
    const provider = document.getElementById('adminModelProvider')?.value || 'gemini';
    const input = document.getElementById('adminNewModelInput');
    const val = (input?.value || '').trim();
    if (!val) return toast("Enter a model name first.", "error");

    if (!adminModelsMap[provider]) adminModelsMap[provider] = [];
    if (adminModelsMap[provider].includes(val)) {
      return toast(`"${val}" is already in the list for ${provider}.`, "warning");
    }
    adminModelsMap[provider].push(val);
    input.value = '';
    renderAdminModelTags();
    toast(`Added "${val}" to ${provider}!`);
  }

  document.getElementById('btnAdminAddModel')?.addEventListener('click', addModelForAdmin);
  document.getElementById('adminNewModelInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addModelForAdmin();
    }
  });

  document.getElementById('btnAdminResetModels')?.addEventListener('click', () => {
    const provider = document.getElementById('adminModelProvider')?.value || 'gemini';
    if (!confirm(`Reset ${provider} models to default presets?`)) return;
    adminModelsMap[provider] = [...(DEFAULT_PROVIDER_MODELS[provider] || [])];
    renderAdminModelTags();
    toast(`Reset ${provider} models to defaults.`);
  });

  document.getElementById('btnAdminSaveModels')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnAdminSaveModels');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      const { error } = await supabase.from('system_settings').upsert({
        key: 'ai_provider_models',
        value: adminModelsMap
      }, { onConflict: 'key' });
      if (error) throw error;
      try { localStorage.setItem('gymcoach_provider_models', JSON.stringify(adminModelsMap)); } catch(e){}
      toast("AI Models saved successfully!");
    } catch (err) {
      toast("Failed to save models: " + err.message, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "💾 Save Model Changes";
      }
    }
  });

  loadData();
  loadTickets();
  loadAiModels();
});
