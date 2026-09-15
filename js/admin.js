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
               <button class="btn small-btn" onclick="viewUserWorkouts('${u.id}')">View Data</button>
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

  window.viewUserWorkouts = async (userId) => {
     alert(`Feature coming soon: Query sync_data table for user ${userId} and visualize their workouts.`);
  };

  // --- SUPPORT TICKETS ---
  async function loadTickets() {
    const tbody = document.getElementById('ticketsTableBody');
    try {
      // Admin loads tickets (RLS enforces they only see tickets from assigned users)
      const { data: tickets, error } = await supabase.from('support_tickets').select('*, profiles:user_id(username)').order('created_at', { ascending: false });
      if (error) throw error;

      if (tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No support tickets found from assigned users.</td></tr>`;
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
      alert("Reply sent.");
    } catch (err) {
      console.error(err);
      alert("Failed to send reply.");
    }
  };

  loadData();
  loadTickets();
});
