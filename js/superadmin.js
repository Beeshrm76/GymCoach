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

  loadData();
});
