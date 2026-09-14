// superadmin.js
document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabaseClient;

  // Wait for auth init
  await window.Auth.init();

  if (!window.Auth.isLoggedIn() || !window.Auth.isRole('SUPER_ADMIN')) {
    document.body.innerHTML = "<h2 style='color:white;text-align:center;padding:50px;'>Access Denied. Super Admin only.</h2>";
    setTimeout(() => { window.location.href = "index.html"; }, 2000);
    return;
  }

  // Basic navigation
  const navItems = document.querySelectorAll(".nav-item[data-section]");
  const sections = document.querySelectorAll(".admin-section");

  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      navItems.forEach(n => n.classList.remove("active"));
      sections.forEach(s => s.style.display = "none");
      btn.classList.add("active");
      const sectionId = "section" + btn.dataset.section.charAt(0).toUpperCase() + btn.dataset.section.slice(1);
      const target = document.getElementById(sectionId);
      if (target) target.style.display = "block";
    });
  });

  document.getElementById("adminLogoutBtn")?.addEventListener("click", () => window.Auth.logout());

  // Load data
  async function loadData() {
    try {
      const { data: users, error } = await supabase.from('profiles').select('*');
      if (error) throw error;

      const admins = users.filter(u => u.role === 'ADMIN');
      const standardUsers = users.filter(u => u.role === 'USER');

      document.getElementById('statTotalUsers').textContent = users.length;
      document.getElementById('statAdmins').textContent = admins.length;

      // Render Admins
      const adminsTbody = document.getElementById('adminsTableBody');
      if (admins.length === 0) {
        adminsTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No admins found.</td></tr>`;
      } else {
        adminsTbody.innerHTML = admins.map(a => `
          <tr>
            <td>${a.username}</td>
            <td>${a.email}</td>
            <td><span class="role-badge role-${a.role.toLowerCase()}">${a.role}</span></td>
            <td>${a.status}</td>
            <td>
               <button class="btn small-btn" onclick="suspendUser('${a.id}')">Suspend</button>
            </td>
          </tr>
        `).join('');
      }

      // Render Users
      const usersTbody = document.getElementById('usersTableBody');
      if (standardUsers.length === 0) {
        usersTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No users found.</td></tr>`;
      } else {
        usersTbody.innerHTML = standardUsers.map(u => `
          <tr>
            <td>${u.username}</td>
            <td>${u.email}</td>
            <td><span class="role-badge role-${u.role.toLowerCase()}">${u.role}</span></td>
            <td>${u.admin_id || 'None'}</td>
            <td>
               <button class="btn small-btn" onclick="assignAdminPrompt('${u.id}')">Assign Admin</button>
            </td>
          </tr>
        `).join('');
      }

    } catch (err) {
      console.error(err);
      alert("Failed to load super admin data.");
    }
  }

  window.suspendUser = async (id) => {
     if(!confirm("Suspend this user?")) return;
     const { error } = await supabase.from('profiles').update({ status: 'SUSPENDED' }).eq('id', id);
     if(error) alert(error.message);
     else loadData();
  };

  window.assignAdminPrompt = async (userId) => {
     const adminId = prompt("Enter the Admin UUID to assign this user to:");
     if (adminId) {
       const { error } = await supabase.from('profiles').update({ admin_id: adminId }).eq('id', userId);
       if (error) alert(error.message);
       else loadData();
     }
  };

  document.getElementById("btnCreateAdmin")?.addEventListener("click", () => {
     alert("To create an admin, register a normal user via the UI, then assign the ADMIN role via Super Admin DB update (or build a dedicated RPC function here).");
  });

  // --- SYSTEM SETTINGS ---
  let defaultExercises = [];

  async function loadSettings() {
    try {
      const { data, error } = await supabase.from('system_settings').select('*');
      if (error) throw error;
      
      const logoSetting = data.find(s => s.key === 'app_logo');
      if (logoSetting) {
        document.getElementById('currentLogoUrl').value = logoSetting.value;
      }
      
      const exSetting = data.find(s => s.key === 'default_exercises');
      if (exSetting) {
        defaultExercises = exSetting.value || [];
      } else {
        defaultExercises = window.EXERCISE_DB || [];
      }
      renderExercises();
    } catch (err) {
      console.error(err);
    }
  }

  // Upload Logo
  document.getElementById('btnUploadLogo')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('logoUploadInput');
    const file = fileInput.files[0];
    if (!file) return alert("Please select an image file first.");
    
    const btn = document.getElementById('btnUploadLogo');
    btn.textContent = "Uploading...";
    btn.disabled = true;
    
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${Date.now()}.${fileExt}`;
      const { data, error } = await supabase.storage.from('app-media').upload(fileName, file);
      
      if (error) throw error;
      
      const { data: publicData } = supabase.storage.from('app-media').getPublicUrl(fileName);
      const url = publicData.publicUrl;
      
      document.getElementById('currentLogoUrl').value = url;
      await saveSetting('app_logo', url);
      alert("Logo uploaded and saved!");
    } catch (err) {
      console.error(err);
      alert("Failed to upload logo: " + err.message);
    } finally {
      btn.textContent = "Upload Logo";
      btn.disabled = false;
    }
  });

  // Exercises Manager
  function renderExercises() {
    const tbody = document.getElementById('exercisesTableBody');
    if (defaultExercises.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" class="empty-state">No default exercises.</td></tr>`;
      return;
    }
    tbody.innerHTML = defaultExercises.map((ex, i) => `
      <tr>
        <td>${ex.name}</td>
        <td>
          <button class="btn small-btn btn-danger" onclick="deleteExercise(${i})">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('btnAddExercise')?.addEventListener('click', () => {
    const input = document.getElementById('newExerciseName');
    const name = input.value.trim();
    if (!name) return;
    defaultExercises.push({ name, aliases: [] });
    input.value = '';
    renderExercises();
  });

  window.deleteExercise = (index) => {
    if(!confirm("Remove this exercise?")) return;
    defaultExercises.splice(index, 1);
    renderExercises();
  };

  document.getElementById('btnSaveExercises')?.addEventListener('click', async () => {
    try {
      await saveSetting('default_exercises', defaultExercises);
      alert("Exercises saved!");
    } catch (err) {
      console.error(err);
      alert("Failed to save exercises.");
    }
  });

  async function saveSetting(key, value) {
    const { error } = await supabase.from('system_settings').upsert({ key, value });
    if (error) throw error;
  }

  // --- SUPPORT TICKETS ---
  async function loadTickets() {
    try {
      // Super Admin loads all tickets
      const { data: tickets, error } = await supabase.from('support_tickets').select('*, profiles:user_id(username)').order('created_at', { ascending: false });
      if (error) throw error;
      
      const tbody = document.getElementById('ticketsTableBody');
      if (tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No support tickets found.</td></tr>`;
        return;
      }
      
      tbody.innerHTML = tickets.map(t => {
        const date = new Date(t.created_at).toLocaleString();
        const username = t.profiles?.username || 'Unknown';
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
      alert("Reply sent.");
    } catch (err) {
      console.error(err);
      alert("Failed to send reply.");
    }
  };

  loadData();
  loadSettings();
  loadTickets();
});
