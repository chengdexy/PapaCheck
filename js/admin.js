/**
 * admin.js - 管理端逻辑
 * 负责作业管理、商店管理、兑换管理、评级、统计、设置
 */

let adminDate = new Date();
let adminHomeworks = [];
let adminShopItems = [];
let adminRedemptions = [];
let adminRewardBox = [];
let adminCurrentTab = 'homework';
let adminEditingId = null;

const ADMIN_SUBJECTS = [
  { id: '语文', icon: '📖' },
  { id: '数学', icon: '🔢' },
  { id: '英语', icon: '🔤' },
  { id: '科学', icon: '🔬' },
  { id: '其他', icon: '📚' },
];

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

const AdminUtil = {
  dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  formatDate(d) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  },
};

// ========== Init ==========
async function initAdmin() {
  document.getElementById('adminDate').textContent = AdminUtil.formatDate(new Date());

  document.getElementById('adminModal').addEventListener('click', (e) => {
    const subjectBtn = e.target.closest('.subject-option');
    if (subjectBtn && subjectBtn.dataset.subject) {
      selectAdminSubject(subjectBtn.dataset.subject);
    }
  });

  await refreshAllData();
  switchTab('homework');

  setInterval(async () => {
    await refreshAllData();
    renderCurrentTab();
  }, 10000);
}

async function refreshAllData() {
  try {
    const data = await API.getData();
    if (data) {
      cachedData = data;
      adminHomeworks = data.homeworks?.[AdminUtil.dateKey(adminDate)] || [];
      adminShopItems = data.shopItems || [];
      adminRedemptions = data.redemptions || [];
      adminRewardBox = data.rewardBox || [];
    }
  } catch (e) {
    // Server unreachable
  }
}

// ========== Tab Switching ==========
function switchTab(tab) {
  adminCurrentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const t = btn.textContent.trim();
    btn.classList.toggle('active',
      (tab === 'homework' && t.startsWith('📋 作业')) ||
      (tab === 'shop' && t.startsWith('🏪 商店')) ||
      (tab === 'rewardBox' && t.startsWith('🎁 奖励箱')) ||
      (tab === 'redeem' && t.startsWith('📋 兑换')) ||
      (tab === 'stats' && t.startsWith('📊 统计')) ||
      (tab === 'settings' && t.startsWith('⚙️ 设置'))
    );
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  switch (adminCurrentTab) {
    case 'homework': renderHomeworkTab(); break;
    case 'shop': renderShopTab(); break;
    case 'redeem': renderRedeemTab(); break;
    case 'rewardBox': renderRewardBoxTab(); break;
    case 'stats': renderStatsTab(); break;
    case 'settings': renderSettingsTab(); break;
  }
}

// ========== Tab 1: Homework ==========
function renderHomeworkTab() {
  const container = document.getElementById('adminContent');

  const submittedDate = AdminUtil.dateKey(adminDate);
  const settlement = cachedData?.dailySettlement?.[submittedDate];
  const needsRating = settlement && settlement.submittedAt && !settlement.rating;

  let ratingAlertHtml = '';
  if (needsRating) {
    ratingAlertHtml = `
      <div class="rating-alert">
        <span>⚠️ 待评级: 1 项</span>
        <button class="btn-rating" onclick="openRatingModal('${submittedDate}')">去评级</button>
      </div>`;
  }

  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">📋 今日作业布置 · ${AdminUtil.formatDate(adminDate)}</div>
      ${ratingAlertHtml}
      <div id="adminHwList">
        ${adminHomeworks.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无作业，点击下方添加</div>'
      : adminHomeworks.map(hw => {
        const subject = ADMIN_SUBJECTS.find(s => s.id === hw.subject) || ADMIN_SUBJECTS[4];
        const modeText = hw.mode === 'challenge'
          ? '⚔️ 挑战 · ' + hw.suggestedDuration + '分钟'
          : '⏱️ 计时';
        const statusText = hw.status === 'done' ? ' ✅' : hw.status === 'doing' ? ' 📝' : '';
        return `
              <div class="hw-admin-item">
                <div class="hw-admin-icon">${subject.icon}</div>
                <div class="hw-admin-info">
                  <div class="hw-admin-subject">${hw.subject} - ${hw.content}${statusText}</div>
                  <div class="hw-admin-meta">${modeText}${hw.actualDuration !== null ? ' · 实际' + hw.actualDuration + '分钟' : ''}</div>
                </div>
                <div class="hw-admin-actions">
                  ${hw.status === 'pending' ? `<button class="btn-sm btn-edit" onclick="openHwModal('edit', '${hw.id}')">编辑</button>` : ''}
                  ${hw.status === 'pending' ? `<button class="btn-sm btn-delete" onclick="deleteAdminHw('${hw.id}')">删除</button>` : ''}
                </div>
              </div>`;
      }).join('')}
      </div>
      <button class="btn-add" onclick="openHwModal('add')">+ 添加作业</button>
    </div>`;
}

function openHwModal(mode, hwId) {
  adminEditingId = mode === 'edit' ? hwId : null;
  const hw = adminEditingId ? adminHomeworks.find(h => h.id === adminEditingId) : null;

  const modal = document.getElementById('adminModalContent');
  modal.innerHTML = `
    <h3>${adminEditingId ? '编辑作业' : '添加作业'}</h3>
    <div class="form-group">
      <label>科目</label>
      <div class="subject-selector" id="adminSubjectSelector">
        ${ADMIN_SUBJECTS.map(s => `
          <button class="subject-option ${(hw?.subject || '语文') === s.id ? 'selected' : ''}"
            data-subject="${s.id}">${s.icon} ${s.id}</button>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>作业内容</label>
      <input type="text" id="adminHwContent" value="${hw?.content || ''}" placeholder="例如：抄写课文第3课" maxlength="30">
    </div>
    <div class="form-group">
      <label>建议时长（分钟）</label>
      <input type="number" id="adminHwDuration" value="${hw?.suggestedDuration || 20}" min="5" max="180" step="5">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
      <button class="btn-primary" onclick="saveAdminHw()">保存</button>
    </div>
  `;

  document.getElementById('adminModal').classList.add('show');
  window._adminSelectedSubject = hw?.subject || '语文';
}

function selectAdminSubject(subject) {
  window._adminSelectedSubject = subject;
  document.querySelectorAll('#adminSubjectSelector .subject-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.subject === subject);
  });
}

async function saveAdminHw() {
  const content = document.getElementById('adminHwContent').value.trim();
  if (!content) { showToast('请输入作业内容'); return; }

  const subject = window._adminSelectedSubject || '语文';
  const suggestedDuration = parseInt(document.getElementById('adminHwDuration').value) || 20;

  if (adminEditingId) {
    const hw = adminHomeworks.find(h => h.id === adminEditingId);
    if (hw) {
      hw.subject = subject;
      hw.content = content;
      hw.suggestedDuration = suggestedDuration;
    }
  } else {
    adminHomeworks.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      subject,
      content,
      mode: 'pending',
      suggestedDuration,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      actualDuration: null,
    });
  }

  await API.saveHomeworks(AdminUtil.dateKey(adminDate), adminHomeworks);
  closeAdminModal();
  await refreshAllData();
  renderHomeworkTab();
  showToast(adminEditingId ? '作业已更新' : '作业已添加');
}

async function deleteAdminHw(id) {
  adminHomeworks = adminHomeworks.filter(h => h.id !== id);
  await API.saveHomeworks(AdminUtil.dateKey(adminDate), adminHomeworks);
  await refreshAllData();
  renderHomeworkTab();
  showToast('作业已删除');
}

// ========== Rating Modal ==========
function openRatingModal(dateKey) {
  const settlement = cachedData?.dailySettlement?.[dateKey];
  const hwList = cachedData?.homeworks?.[dateKey] || [];
  const doneHw = hwList.filter(h => h.status === 'done');

  const modal = document.getElementById('adminModalContent');
  modal.innerHTML = `
    <h3>📝 作业评级</h3>
    <div class="rating-homework-list">
      ${doneHw.map(hw => {
    const subject = ADMIN_SUBJECTS.find(s => s.id === hw.subject) || ADMIN_SUBJECTS[4];
    let timeInfo = '';
    if (hw.mode === 'challenge' && hw.actualDuration !== null) {
      const icon = hw.actualDuration <= hw.suggestedDuration * 0.8 ? '⚡' :
        hw.actualDuration <= hw.suggestedDuration ? '✅' : '⚠️';
      timeInfo = `${hw.actualDuration}/${hw.suggestedDuration}分钟 ${icon}`;
    } else if (hw.actualDuration !== null) {
      timeInfo = `${hw.actualDuration}分钟`;
    }
    return `<div class="rating-hw-item">
          <span>${subject.icon}</span>
          <span>${hw.subject} - ${hw.content}</span>
          <span class="rating-hw-time">${timeInfo}</span>
        </div>`;
  }).join('')}
    </div>
    <div class="rating-summary">
      基础积分: ${settlement.basePoints}<br>
      效率奖励: +${settlement.efficiencyBonus}<br>
      待结算: ${settlement.basePoints + settlement.efficiencyBonus}
    </div>
    <div style="font-size:14px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">请评级：</div>
    <div class="rating-buttons">
      <button class="btn-rate-excellent" onclick="submitRating('${dateKey}', '优')">🌟 优</button>
      <button class="btn-rate-good" onclick="submitRating('${dateKey}', '良')">👍 良</button>
      <button class="btn-rate-ok" onclick="submitRating('${dateKey}', '可')">👌 可</button>
      <button class="btn-rate-poor" onclick="submitRating('${dateKey}', '差')">😢 差</button>
    </div>
    <div class="modal-actions" style="margin-top:12px;">
      <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
    </div>
  `;

  document.getElementById('adminModal').classList.add('show');
}

async function submitRating(dateKey, rating) {
  const settlement = cachedData?.dailySettlement?.[dateKey];
  if (!settlement) return;

  const multipliers = {
    'challenge': { '优': 2.0, '良': 1.5, '可': 1.2, '差': 0 },
    'timer': { '优': 1.5, '良': 1.2, '可': 1.0, '差': 0 },
  };

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let multiplier = 1.0;
  const hwList = cachedData?.homeworks?.[dateKey] || [];
  const modes = [...new Set(hwList.filter(h => h.status === 'done').map(h => h.mode))];
  if (modes.length === 1 && modes[0] === 'timer') {
    multiplier = multipliers.timer[rating];
  } else if (modes.length === 1 && modes[0] === 'challenge') {
    multiplier = multipliers.challenge[rating];
  } else {
    const challengeMult = multipliers.challenge[rating];
    const timerMult = multipliers.timer[rating];
    multiplier = (challengeMult + timerMult) / 2;
  }

  const finalPoints = rating === '差' ? 0
    : Math.round((settlement.basePoints + settlement.efficiencyBonus) * multiplier);

  settlement.rating = rating;
  settlement.multiplier = multiplier;
  settlement.finalPoints = finalPoints;
  settlement.ratedAt = timeStr;

  await API.saveSettlement(dateKey, settlement);

  if (finalPoints > 0) {
    await API.updatePoints('earn', finalPoints, `完成作业，评级${rating}`);
  }

  closeAdminModal();
  await refreshAllData();
  renderHomeworkTab();
  showToast(`已评级: ${rating} · 最终积分: ${finalPoints}`);
}

// ========== Tab 2: Shop ==========
function renderShopTab() {
  const container = document.getElementById('adminContent');
  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">🏪 积分商店管理</div>
      <div id="adminShopList">
        ${adminShopItems.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无商品</div>'
      : adminShopItems.map(item => `
            <div class="shop-admin-item">
              <div class="shop-admin-icon">${item.type === 'time' ? '🎮' : '🎁'}</div>
              <div class="shop-admin-info">
                <div class="shop-admin-name">${item.name}</div>
                <div class="shop-admin-meta">${item.points}积分 · ${item.type === 'time' ? '时间类' : '物品类'} · 剩余${item.remainingQuantity ?? 0}件</div>
              </div>
              <div class="shop-qty-controls">
                <button class="btn-qty" onclick="adjustShopQty('${item.id}', -1)">−</button>
                <span class="qty-value">${item.remainingQuantity ?? 0}</span>
                <button class="btn-qty" onclick="adjustShopQty('${item.id}', 1)">+</button>
              </div>
              <div class="hw-admin-actions">
                <button class="btn-sm btn-edit" onclick="openShopModal('edit', '${item.id}')">编辑</button>
                <button class="btn-sm btn-delete" onclick="deleteShopItem('${item.id}')">删除</button>
              </div>
            </div>
          `).join('')}
      </div>
      <button class="btn-add" onclick="openShopModal('add')">+ 添加商品</button>
    </div>`;
}

function openShopModal(mode, itemId) {
  adminEditingId = mode === 'edit' ? itemId : null;
  const item = adminEditingId ? adminShopItems.find(i => i.id === adminEditingId) : null;

  const modal = document.getElementById('adminModalContent');
  modal.innerHTML = `
    <h3>${adminEditingId ? '编辑商品' : '添加商品'}</h3>
    <div class="form-group">
      <label>商品名称</label>
      <input type="text" id="adminItemName" value="${item?.name || ''}" placeholder="例如：游戏时间" maxlength="20">
    </div>
    <div class="form-group">
      <label>所需积分</label>
      <input type="number" id="adminItemPoints" value="${item?.points || 15}" min="1" max="999">
    </div>
    <div class="form-group">
      <label>商品类型</label>
      <div class="mode-selector">
        <button class="mode-option ${(item?.type || 'time') === 'time' ? 'selected' : ''}"
          onclick="selectAdminItemType('time')">⏱️ 时间类</button>
        <button class="mode-option ${(item?.type || 'time') === 'item' ? 'selected' : ''}"
          onclick="selectAdminItemType('item')">🎁 物品类</button>
      </div>
    </div>
    <div class="form-group" id="adminDurationGroup" style="display:${(item?.type || 'time') === 'item' ? 'none' : 'block'}">
      <label>奖励时长（分钟）</label>
      <input type="number" id="adminItemDuration" value="${item?.durationMinutes || 30}" min="5" max="180" step="5">
    </div>
    <div class="form-group">
      <label>每日数量</label>
      <input type="number" id="adminItemBaseQty" value="${item?.baseQuantity || 3}" min="0" max="99">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
      <button class="btn-primary" onclick="saveShopItem()">保存</button>
    </div>
  `;

  window._adminItemType = item?.type || 'time';
  document.getElementById('adminModal').classList.add('show');
}

function selectAdminItemType(type) {
  window._adminItemType = type;
  document.querySelectorAll('#adminModalContent .mode-option').forEach(btn => {
    const isTime = btn.textContent.includes('⏱️');
    const isItem = btn.textContent.includes('🎁');
    btn.classList.toggle('selected', (type === 'time' && isTime) || (type === 'item' && isItem));
  });
  document.getElementById('adminDurationGroup').style.display = type === 'item' ? 'none' : 'block';
}

async function saveShopItem() {
  const name = document.getElementById('adminItemName').value.trim();
  const points = parseInt(document.getElementById('adminItemPoints').value) || 15;
  const type = window._adminItemType || 'time';
  const durationMinutes = type === 'time' ? (parseInt(document.getElementById('adminItemDuration').value) || 30) : 0;
  const baseQuantity = parseInt(document.getElementById('adminItemBaseQty').value) || 3;
  if (!name) { showToast('请输入商品名称'); return; }

  if (adminEditingId) {
    const item = adminShopItems.find(i => i.id === adminEditingId);
    if (item) {
      item.name = name;
      item.points = points;
      item.type = type;
      item.durationMinutes = durationMinutes;
      item.baseQuantity = baseQuantity;
    }
  } else {
    adminShopItems.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name,
      points,
      type,
      durationMinutes,
      baseQuantity,
      remainingQuantity: baseQuantity,
    });
  }

  await API.saveShopItems(adminShopItems);
  closeAdminModal();
  await refreshAllData();
  renderShopTab();
  showToast(adminEditingId ? '商品已更新' : '商品已添加');
}

async function adjustShopQty(itemId, delta) {
  const item = adminShopItems.find(i => i.id === itemId);
  if (!item) return;
  item.remainingQuantity = Math.max(0, (item.remainingQuantity ?? 0) + delta);
  await API.saveShopItems(adminShopItems);
  await refreshAllData();
  renderShopTab();
}

async function deleteShopItem(id) {
  adminShopItems = adminShopItems.filter(i => i.id !== id);
  await API.saveShopItems(adminShopItems);
  await refreshAllData();
  renderShopTab();
  showToast('商品已删除');
}

// ========== Tab 3: Reward Box ==========
function renderRewardBoxTab() {
  const container = document.getElementById('adminContent');
  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">🎁 奖励箱管理</div>
      <div id="adminRewardBoxList">
        ${adminRewardBox.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">奖励箱为空</div>'
      : adminRewardBox.map(item => `
            <div class="shop-admin-item">
              <div class="shop-admin-icon">${item.type === 'time' ? '🎮' : '🎁'}</div>
              <div class="shop-admin-info">
                <div class="shop-admin-name">${item.name}</div>
                <div class="shop-admin-meta">${item.type === 'time' ? '时间类 · ' + (item.durationMinutes || 0) + '分钟' : '物品类'} · 数量${item.quantity || 0}</div>
              </div>
              <div class="shop-qty-controls">
                <button class="btn-qty" onclick="adjustRewardBoxQty('${item.id}', -1)">−</button>
                <span class="qty-value">${item.quantity || 0}</span>
                <button class="btn-qty" onclick="adjustRewardBoxQty('${item.id}', 1)">+</button>
              </div>
              <div class="hw-admin-actions">
                <button class="btn-sm btn-edit" onclick="openRewardBoxModal('edit', '${item.id}')">编辑</button>
                <button class="btn-sm btn-delete" onclick="deleteRewardBoxItem('${item.id}')">删除</button>
              </div>
            </div>
          `).join('')}
      </div>
      <button class="btn-add" onclick="openRewardBoxModal('add')">+ 添加奖励</button>
    </div>`;
}

function openRewardBoxModal(mode, itemId) {
  adminEditingId = mode === 'edit' ? itemId : null;
  const item = adminEditingId ? adminRewardBox.find(i => i.id === adminEditingId) : null;

  const modal = document.getElementById('adminModalContent');
  modal.innerHTML = `
    <h3>${adminEditingId ? '编辑奖励' : '添加奖励'}</h3>
    <div class="form-group">
      <label>奖励名称</label>
      <input type="text" id="adminItemName" value="${item?.name || ''}" placeholder="例如：游戏时间" maxlength="20">
    </div>
    <div class="form-group">
      <label>奖励类型</label>
      <div class="mode-selector">
        <button class="mode-option ${(item?.type || 'time') === 'time' ? 'selected' : ''}"
          onclick="selectRewardBoxType('time')">⏱️ 时间类</button>
        <button class="mode-option ${(item?.type || 'time') === 'item' ? 'selected' : ''}"
          onclick="selectRewardBoxType('item')">🎁 物品类</button>
      </div>
    </div>
    <div class="form-group" id="adminDurationGroup" style="display:${(item?.type || 'time') === 'item' ? 'none' : 'block'}">
      <label>时长（分钟）</label>
      <input type="number" id="adminItemDuration" value="${item?.durationMinutes || 30}" min="5" max="180" step="5">
    </div>
    <div class="form-group">
      <label>数量</label>
      <input type="number" id="adminItemQty" value="${item?.quantity || 1}" min="1" max="99">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
      <button class="btn-primary" onclick="saveRewardBoxItem()">保存</button>
    </div>
  `;

  window._adminItemType = item?.type || 'time';
  document.getElementById('adminModal').classList.add('show');
}

function selectRewardBoxType(type) {
  window._adminItemType = type;
  document.querySelectorAll('#adminModalContent .mode-option').forEach(btn => {
    const isTime = btn.textContent.includes('⏱️');
    const isItem = btn.textContent.includes('🎁');
    btn.classList.toggle('selected', (type === 'time' && isTime) || (type === 'item' && isItem));
  });
  document.getElementById('adminDurationGroup').style.display = type === 'item' ? 'none' : 'block';
}

async function saveRewardBoxItem() {
  const name = document.getElementById('adminItemName').value.trim();
  const type = window._adminItemType || 'time';
  const durationMinutes = type === 'time' ? (parseInt(document.getElementById('adminItemDuration').value) || 30) : 0;
  const quantity = parseInt(document.getElementById('adminItemQty').value) || 1;
  if (!name) { showToast('请输入奖励名称'); return; }

  if (adminEditingId) {
    const item = adminRewardBox.find(i => i.id === adminEditingId);
    if (item) {
      item.name = name;
      item.type = type;
      item.durationMinutes = durationMinutes;
      item.quantity = quantity;
    }
  } else {
    adminRewardBox.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name,
      type,
      durationMinutes,
      quantity,
    });
  }

  await API.saveRewardBox(adminRewardBox);
  closeAdminModal();
  await refreshAllData();
  renderRewardBoxTab();
  showToast(adminEditingId ? '奖励已更新' : '奖励已添加');
}

async function adjustRewardBoxQty(itemId, delta) {
  const item = adminRewardBox.find(i => i.id === itemId);
  if (!item) return;
  item.quantity = Math.max(0, (item.quantity || 0) + delta);
  if (item.quantity <= 0) {
    adminRewardBox = adminRewardBox.filter(i => i.id !== itemId);
  }
  await API.saveRewardBox(adminRewardBox);
  await refreshAllData();
  renderRewardBoxTab();
}

async function deleteRewardBoxItem(id) {
  adminRewardBox = adminRewardBox.filter(i => i.id !== id);
  await API.saveRewardBox(adminRewardBox);
  await refreshAllData();
  renderRewardBoxTab();
  showToast('已删除');
}

// ========== Tab 4: Redemptions ==========
function renderRedeemTab() {
  const pending = adminRedemptions.filter(r => r.status === 'pending');
  const fulfilled = adminRedemptions.filter(r => r.status === 'fulfilled');

  const container = document.getElementById('adminContent');
  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">📋 兑换管理</div>

      <div class="redeem-section-title">待兑现 (${pending.length})</div>
      ${pending.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:12px;font-size:14px;">暂无待兑现</div>'
      : pending.map(r => `
          <div class="redeem-item">
            <div class="redeem-info">
              <div class="redeem-name">${r.itemName}<span style="font-size:13px;color:var(--text-secondary);margin-left:6px;">${r.points}积分${r.itemType === 'time' && r.durationMinutes ? ' · ' + r.durationMinutes + '分钟' : ''}</span></div>
              <div class="redeem-time">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            <span class="redeem-status pending">待兑现</span>
            <button class="btn-fulfill" onclick="fulfillRedemption('${r.id}')">确认兑现</button>
          </div>
        `).join('')}

      <div class="redeem-section-title">已兑现</div>
      ${fulfilled.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:12px;font-size:14px;">暂无</div>'
      : fulfilled.map(r => `
          <div class="redeem-item">
            <div class="redeem-info">
              <div class="redeem-name">${r.itemName}</div>
              <div class="redeem-time">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            <span class="redeem-status fulfilled">已兑现 ✅</span>
          </div>
        `).join('')}
    </div>`;
}

async function fulfillRedemption(id) {
  const r = adminRedemptions.find(r => r.id === id);
  if (!r) return;
  r.status = 'fulfilled';
  await API.saveRedemptions(adminRedemptions);

  const itemType = r.itemType;
  let durationMinutes = r.durationMinutes || 0;

  if ((!itemType || !durationMinutes) && r.itemName) {
    const shopItem = adminShopItems.find(i => i.name === r.itemName);
    if (shopItem) {
      if (!itemType) r.itemType = shopItem.type;
      if (!durationMinutes) durationMinutes = shopItem.durationMinutes || 0;
    }
  }

  if ((itemType || r.itemType) === 'time' && durationMinutes > 0) {
    const dateKey = AdminUtil.dateKey(adminDate);
    const freeTime = await API.getFreeTime(dateKey);
    freeTime.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name: r.itemName,
      durationMinutes,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      remainingSeconds: durationMinutes * 60,
    });
    await API.saveFreeTime(dateKey, freeTime);
  }

  await refreshAllData();
  renderRedeemTab();
  showToast('已确认兑现');
}

// ========== Tab 5: Statistics ==========
function renderStatsTab() {
  const container = document.getElementById('adminContent');

  const allDates = Object.keys(cachedData?.dailySettlement || {}).sort();
  const recentDates = allDates.slice(-7);

  const completionRates = [];
  const efficiencyRatios = [];
  const dailyPoints = [];

  recentDates.forEach(date => {
    const hwList = cachedData?.homeworks?.[date] || [];
    const doneCount = hwList.filter(h => h.status === 'done').length;
    const totalCount = hwList.length;
    completionRates.push({
      date: date.slice(5),
      value: totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0,
    });

    const effData = cachedData?.efficiencyHistory?.[date];
    efficiencyRatios.push({
      date: date.slice(5),
      value: effData?.averageRatio ? Math.round(effData.averageRatio * 100) : 0,
    });

    const settlement = cachedData?.dailySettlement?.[date];
    dailyPoints.push({
      date: date.slice(5),
      value: settlement?.finalPoints ?? 0,
    });
  });

  const ratingsList = allDates.slice(-10).reverse()
    .filter(d => cachedData?.dailySettlement?.[d]?.rating);

  const streakDays = calcStreak(allDates);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-value">${completionRates.length > 0 ? Math.round(completionRates.reduce((a, b) => a + b.value, 0) / completionRates.length) : 0}%</div>
        <div class="stat-card-label">平均完成率</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${efficiencyRatios.length > 0 ? Math.round(efficiencyRatios.filter(e => e.value > 0).reduce((a, b) => a + b.value, 0) / Math.max(1, efficiencyRatios.filter(e => e.value > 0).length)) : 0}%</div>
        <div class="stat-card-label">平均效率比</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${dailyPoints.reduce((a, b) => a + b.value, 0)}</div>
        <div class="stat-card-label">近期获得积分</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${streakDays}</div>
        <div class="stat-card-label">连续全勤天数</div>
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-title">📈 每日完成率趋势</div>
      <div class="chart-bars">
        ${completionRates.map(d => `
          <div class="chart-bar-wrap">
            <div class="chart-bar-value">${d.value}%</div>
            <div class="chart-bar completion" style="height:${d.value}px;"></div>
            <div class="chart-bar-label">${d.date}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-title">📊 效率比（实际/参考）</div>
      <div class="chart-bars">
        ${efficiencyRatios.map(d => `
          <div class="chart-bar-wrap">
            <div class="chart-bar-value">${d.value}%</div>
            <div class="chart-bar efficiency" style="height:${Math.min(100, d.value)}px;"></div>
            <div class="chart-bar-label">${d.date}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-title">📅 评级历史</div>
      ${ratingsList.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:12px;font-size:14px;">暂无评级记录</div>'
      : ratingsList.map(d => {
        const s = cachedData?.dailySettlement?.[d];
        return `<div class="rating-history-item">
            <span>${d}</span>
            <span>${s.finalPoints}分 (×${s.multiplier})</span>
            <span class="rating-grade ${s.rating}">${s.rating}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function calcStreak(allDates) {
  if (allDates.length === 0) return 0;

  const sorted = [...allDates].sort().reverse();
  let streak = 0;
  const today = AdminUtil.dateKey(new Date());

  const todaySettlement = cachedData?.dailySettlement?.[today];
  let checkDate = new Date();

  if (todaySettlement?.rating) {
    streak = 1;
    checkDate.setDate(checkDate.getDate() - 1);
  } else {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (streak < 365) {
    const dk = AdminUtil.dateKey(checkDate);
    const s = cachedData?.dailySettlement?.[dk];
    if (s?.rating && s.rating !== '差') {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ========== Tab 6: Settings ==========
function renderSettingsTab() {
  const container = document.getElementById('adminContent');
  const balance = cachedData?.points?.balance ?? cachedData?.points ?? 0;

  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">⚙️ 积分管理</div>
      <div class="settings-row">
        <label>当前余额</label>
        <span style="font-size:20px;font-weight:700;color:var(--accent);">${balance}</span>
      </div>
      <div class="settings-actions">
        <button class="btn-points-add" onclick="adjustPoints(10, '奖励')">+10</button>
        <button class="btn-points-add" onclick="adjustPoints(50, '奖励')">+50</button>
        <button class="btn-points-sub" onclick="adjustPoints(-10, '惩罚')">-10</button>
        <button class="btn-points-sub" onclick="adjustPoints(-50, '惩罚')">-50</button>
        <button class="btn-points-sub" style="background:#dc2626;" onclick="clearAllPoints()">清零</button>
      </div>
    </div>

    <div class="admin-card">
      <div class="admin-card-title">📅 日期选择</div>
      <div class="date-nav">
        <button onclick="changeAdminDate(-1)">◀ 前一天</button>
        <span>${AdminUtil.formatDate(adminDate)}</span>
        <button onclick="changeAdminDate(1)">后一天 ▶</button>
      </div>
      <button class="btn-add" style="background:var(--danger);margin-top:12px;" onclick="resetCurrentDate()">🔄 重置这一天</button>
    </div>

    <div class="admin-card">
      <div class="admin-card-title">💾 数据管理</div>
      <div class="settings-actions">
        <button class="btn-primary" onclick="exportData()">导出数据</button>
        <button class="btn-cancel" style="border:1px solid var(--text-secondary);" onclick="document.getElementById('importFileInput').click()">导入数据</button>
        <input type="file" id="importFileInput" style="display:none;" accept=".json" onchange="importData(event)">
      </div>
    </div>`;
}

async function adjustPoints(amount, label) {
  const action = amount > 0 ? 'earn' : 'spend';
  const absAmount = Math.abs(amount);
  await API.updatePoints(action, absAmount, '爸爸' + label + ': ' + absAmount + '分');
  await refreshAllData();
  renderSettingsTab();
  showToast((amount > 0 ? '奖励' : '惩罚') + absAmount + '分');
}

async function clearAllPoints() {
  const balance = cachedData?.points?.balance ?? cachedData?.points ?? 0;
  if (balance > 0) {
    await API.updatePoints('spend', balance, '清零积分');
  }
  await refreshAllData();
  renderSettingsTab();
  showToast('积分已清零');
}

async function resetCurrentDate() {
  const dateKey = AdminUtil.dateKey(adminDate);

  await API._fetch('/api/reset-date', {
    method: 'POST',
    body: JSON.stringify({ date: dateKey }),
  });

  adminHomeworks = [];
  await refreshAllData();
  renderCurrentTab();
  showToast(AdminUtil.formatDate(adminDate) + ' 已重置');
}

async function changeAdminDate(delta) {
  adminDate.setDate(adminDate.getDate() + delta);
  document.getElementById('adminDate').textContent = AdminUtil.formatDate(adminDate);
  await refreshAllData();
  renderCurrentTab();
}

function exportData() {
  const data = cachedData;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tinyschedule_backup_' + AdminUtil.dateKey(new Date()) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await API._fetch('/api/data', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await refreshAllData();
    renderCurrentTab();
    showToast('数据已导入');
  } catch (e) {
    showToast('导入失败，请检查文件格式');
  }
}

// ========== Modal ==========
function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('show');
  adminEditingId = null;
}

// ========== Init ==========
initAdmin();
