// 轮播图的标签顺序
const tabsOrder = ['kid', 'admin', 'stats'];
let currentTabIndex = 0;
let carouselInterval;

function switchTab(tab, manual = false) {
    if (manual) {
        resetCarousel();
    }
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // 找到对应的按钮
    const tabButtons = document.querySelectorAll('.tab-btn');
    let targetBtn;
    tabButtons.forEach((btn, index) => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tab)) {
            targetBtn = btn;
            currentTabIndex = index;
        }
    });

    if (targetBtn) {
        targetBtn.classList.add('active');
    }
    const targetContent = document.getElementById('tab-' + tab);
    if (targetContent) {
        targetContent.classList.add('active');
    }
}

function nextTab() {
    currentTabIndex = (currentTabIndex + 1) % tabsOrder.length;
    switchTab(tabsOrder[currentTabIndex]);
}

function startCarousel() {
    carouselInterval = setInterval(nextTab, 4000);
}

function resetCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
    }
    startCarousel();
}

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// 页面加载完成后启动轮播
window.addEventListener('DOMContentLoaded', startCarousel);

// ===== 管理面板 =====
const ADMIN_TOKEN_KEY = 'papacheck_admin_token';
const ADMIN_API_BASE = '';  // same origin

document.getElementById('nav-admin-panel')?.addEventListener('click', (e) => {
    e.preventDefault();
    const panel = document.getElementById('admin-panel');
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth' });
    checkAdminAuth();
});

// Tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById('admin-login-form').style.display = tabName === 'login' ? 'block' : 'none';
        document.getElementById('admin-register-form').style.display = tabName === 'register' ? 'block' : 'none';
    });
});

async function checkAdminAuth() {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) {
        document.getElementById('admin-auth-view').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'block';
        await loadMembers(token);
    } else {
        document.getElementById('admin-auth-view').style.display = 'block';
        document.getElementById('admin-dashboard').style.display = 'none';
    }
}

// Register
document.getElementById('admin-register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        family_name: form.querySelector('[name="family_name"]').value,
        email: form.querySelector('[name="email"]').value,
        password: form.querySelector('[name="password"]').value
    };
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            const result = await res.json();
            showModal('注册成功', `家庭已创建。<br>管理员的访问码是：<br><code style="font-size:1.2em">${result.admin_hash}</code><br><br>请务必保存此访问码！`);
            // 切换到登录
            document.querySelectorAll('.admin-tab')[0].click();
        } else {
            const err = await res.json();
            alert('注册失败: ' + (err.error || '未知错误'));
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
});

// Login
document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        email: form.querySelector('[name="email"]').value,
        password: form.querySelector('[name="password"]').value,
    };
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            const result = await res.json();
            localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
            await checkAdminAuth();
        } else {
            try {
                const err = await res.json();
                alert('登录失败: ' + (err.error || '请检查邮箱和密码'));
            } catch {
                alert('登录失败，请检查邮箱和密码');
            }
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
});

// Logout
document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    checkAdminAuth();
});

async function loadMembers(token) {
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/members`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            const members = await res.json();
            const tbody = document.getElementById('member-tbody');
            tbody.innerHTML = members.map(m => `
          <tr>
            <td>${escapeHtml(m.nickname)}</td>
            <td>${m.role === 'parent' ? '家长' : '孩子'}</td>
            <td><code>${escapeHtml(m.access_hash)}</code> <button class="copy-btn" data-hash="${escapeHtml(m.access_hash)}">复制</button></td>
            <td>${m.last_login || '从未'}</td>
            <td>
              <button data-action="regenerate" data-member-id="${escapeHtml(m.id)}">重新生成</button>
              <button data-action="remove" data-member-id="${escapeHtml(m.id)}">移除</button>
            </td>
          </tr>
        `).join('');

            // Event delegation for member action buttons
            tbody.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const memberId = btn.dataset.memberId;
                const action = btn.dataset.action;
                if (action === 'regenerate') await regenerateMemberHash(memberId);
                else if (action === 'remove') await removeMember(memberId);
            });

            // Copy buttons
            tbody.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    navigator.clipboard.writeText(btn.dataset.hash).then(() => {
                        btn.textContent = '已复制';
                        setTimeout(() => { btn.textContent = '复制'; }, 2000);
                    });
                });
            });
        } else if (res.status === 401) {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            checkAdminAuth();
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('result-modal').style.display = 'flex';
}

// Add member
document.getElementById('add-member-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        role: form.querySelector('[name="role"]').value,
        nickname: form.querySelector('[name="nickname"]').value,
    };
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            const result = await res.json();
            showModal('添加成功', `${result.nickname} 的访问码是：<br><code style="font-size:1.2em">${result.access_hash}</code><br><br>请务必保存此访问码！`);
            form.reset();
            await loadMembers(token);
        } else {
            alert('添加失败');
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
});

async function regenerateMemberHash(userId) {
    if (!confirm('确定重新生成访问码？旧访问码将立即失效。')) return;
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/members/${userId}/regenerate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            const result = await res.json();
            showModal('已重新生成', `新访问码：<br><code style="font-size:1.2em">${result.access_hash}</code>`);
            await loadMembers(token);
        } else {
            alert('操作失败');
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
}

async function removeMember(userId) {
    if (!confirm('确定移除此成员？此操作不可撤销。')) return;
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/members/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            await loadMembers(token);
        } else {
            alert('移除失败');
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
}

// ===== 超级管理员 =====

// 显示/隐藏超管登录
document.getElementById('btn-super-admin')?.addEventListener('click', () => {
    const superForm = document.getElementById('super-login-form');
    const normalForm = document.getElementById('admin-login-form');
    if (superForm.style.display === 'block') {
        superForm.style.display = 'none';
        normalForm.style.display = 'block';
    } else {
        superForm.style.display = 'block';
        normalForm.style.display = 'none';
    }
});

// 超管登录
document.getElementById('super-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        username: form.querySelector('[name="super-username"]').value,
        password: form.querySelector('[name="super-password"]').value,
    };
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/super/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            const result = await res.json();
            localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
            document.getElementById('admin-auth-view').style.display = 'none';
            document.getElementById('admin-dashboard').style.display = 'none';
            document.getElementById('super-dashboard').style.display = 'block';
            await loadSuperTenants(result.token);
        } else {
            alert('超级管理员登录失败，请检查用户名和密码');
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
});

// 超管退出
document.getElementById('super-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    document.getElementById('super-dashboard').style.display = 'none';
    document.getElementById('admin-auth-view').style.display = 'block';
});

// 加载租户列表
async function loadSuperTenants(token) {
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/super/tenants`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            const tenants = await res.json();
            const tbody = document.getElementById('super-tenant-tbody');
            tbody.innerHTML = tenants.map(t => `
          <tr>
            <td>${escapeHtml(t.name)}</td>
            <td>${t.member_count}</td>
            <td>${t.is_active ? '✅ 启用' : '❌ 禁用'}</td>
            <td>${t.created_at || '-'}</td>
            <td>
              ${t.is_active
                    ? `<button data-action="toggle-tenant" data-tenant-id="${escapeHtml(t.id)}" data-active="false" class="btn-danger">禁用</button>`
                    : `<button data-action="toggle-tenant" data-tenant-id="${escapeHtml(t.id)}" data-active="true" class="btn-success">启用</button>`
                }
            </td>
          </tr>
        `).join('');

            // Event delegation for tenant action buttons
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action="toggle-tenant"]');
                if (!btn) return;
                const tenantId = btn.dataset.tenantId;
                const isActive = btn.dataset.active === 'true';
                toggleTenant(tenantId, isActive);
            });
        } else if (res.status === 401) {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            document.getElementById('super-dashboard').style.display = 'none';
            document.getElementById('admin-auth-view').style.display = 'block';
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
}

// 启用/禁用租户
async function toggleTenant(tenantId, isActive) {
    const action = isActive ? '启用' : '禁用';
    if (!confirm(`确定${action}该租户？`)) return;
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/super/tenants/${tenantId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_active: isActive }),
        });
        if (res.ok) {
            await loadSuperTenants(token);
        } else {
            alert('操作失败');
        }
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
}

// 修改 checkAdminAuth 以支持超管
const origCheckAdminAuth = checkAdminAuth;
checkAdminAuth = async function () {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) {
        document.getElementById('admin-auth-view').style.display = 'block';
        document.getElementById('admin-dashboard').style.display = 'none';
        document.getElementById('super-dashboard').style.display = 'none';
        return;
    }
    // Try normal admin first
    try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/members`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
            document.getElementById('admin-auth-view').style.display = 'none';
            document.getElementById('admin-dashboard').style.display = 'block';
            document.getElementById('super-dashboard').style.display = 'none';
            await loadMembers(token);
            return;
        }
        // Try super admin
        try {
            const superRes = await fetch(`${ADMIN_API_BASE}/api/admin/super/tenants`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (superRes.ok) {
                document.getElementById('admin-auth-view').style.display = 'none';
                document.getElementById('admin-dashboard').style.display = 'none';
                document.getElementById('super-dashboard').style.display = 'block';
                await loadSuperTenants(token);
                return;
            }
        } catch (err) {
            alert('网络错误，请检查服务器连接');
            return;
        }
        // Not authenticated
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        document.getElementById('admin-auth-view').style.display = 'block';
        document.getElementById('admin-dashboard').style.display = 'none';
        document.getElementById('super-dashboard').style.display = 'none';
    } catch (err) {
        alert('网络错误，请检查服务器连接');
    }
};
