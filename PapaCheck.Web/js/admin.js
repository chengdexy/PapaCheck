/**
 * admin.js - 管理端逻辑
 * 负责作业管理、商店管理、兑换管理、评级、统计、设置
 */

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let adminDate = new Date();
let adminHomeworks = [];
let adminShopItems = [];
let adminRedemptions = [];
let adminRewardBox = [];
let adminCurrentTab = 'homework';
let adminEditingId = null;
let adminSettings = {};
let _submittingAdminRating = false;
let _fulfillingRedemption = false;
let _adjustingPoints = false;
let _editingBalance = false;
let _redeemShowCount = 3;
let _selectedCalendarDate = null;
let _calendarYear = null;
let _calendarMonth = null;

const SETTINGS_DEFAULTS = {
  homeworkDefaultBasePoints: 10,
  homeworkDefaultSuggestedDuration: 20,
  ratingMultipliers: {
    challenge: { '优': 2.0, '良': 1.5, '可': 1.2, '差': 0 },
    timer: { '优': 1.5, '良': 1.2, '可': 1.0, '差': 0 }
  },
  challengeEfficiencyBonus: 5,
  shopDefaultPoints: 15,
};

function getSetting(key) {
  const val = adminSettings[key];
  if (val !== undefined && val !== null) return val;
  return SETTINGS_DEFAULTS[key];
}

function getSettingsRatingMultipliers() {
  const stored = adminSettings.ratingMultipliers;
  if (stored && stored.challenge && stored.timer) return stored;
  return SETTINGS_DEFAULTS.ratingMultipliers;
}

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

/**
 * 预生成语音 — 将文本发送给 server 提前生成 TTS 缓存
 * fire-and-forget，不阻塞管理端响应
 */
function pregenSpeech(texts) {
  const unique = [...new Set(texts)].filter(t => t && t.trim());
  if (unique.length === 0) return;
  fetch('/api/pregen-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: unique }),
  }).catch(() => { });
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
    const modal = document.getElementById('adminModal');
    if (modal && modal.classList.contains('show')) return;
    renderCurrentTab();
  }, 5000);
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
      adminSettings = data.settings || {};
    }
  } catch (e) {
    // Server unreachable
  }
}

// ========== Tab Switching ==========
function switchTab(tab) {
  adminCurrentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderCurrentTab();
}

function renderCurrentTab() {
  if (adminCurrentTab !== 'settings') {
    _calendarYear = null;
    _calendarMonth = null;
  }
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

  const deferPending = adminHomeworks.filter(h => h.deferRequest && h.deferRequest.status === 'pending');
  const deferCount = deferPending.length;

  let ratingAlertHtml = '';
  if (needsRating) {
    ratingAlertHtml = `
      <div class="rating-alert">
        <span>⚠️ 待评级: 1 项</span>
        <button class="btn-rating" onclick="openRatingModal('${submittedDate}')">去评级</button>
      </div>`;
  }

  let deferAlertHtml = '';
  if (deferCount > 0) {
    deferAlertHtml = `
      <div class="defer-alert">
        <span>⏭️ ${deferCount} 项作业申请延后到明天</span>
      </div>`;
  }

  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">📋 今日作业布置 · ${AdminUtil.formatDate(adminDate)}</div>
      ${ratingAlertHtml}
      ${deferAlertHtml}
      ${(() => {
      const doneCount = adminHomeworks.filter(h => h.status === 'done').length;
      const totalCount = adminHomeworks.length;
      const doingCount = adminHomeworks.filter(h => h.status === 'doing').length;
      if (totalCount > 0) {
        let progressText = `完成进度: ${doneCount}/${totalCount}`;
        if (doneCount === totalCount) progressText += ' ✅ 全部完成';
        else if (doingCount > 0) progressText += ` · ${doingCount}项进行中`;
        return `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(56,189,248,0.08);border-radius:8px;font-size:14px;font-weight:600;color:var(--accent);">📊 ${progressText}</div>`;
      }
      return '';
    })()}
      <div id="adminHwList">
        ${adminHomeworks.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无作业，点击下方添加</div>'
      : [...adminHomeworks].sort((a, b) => {
        const priority = hw => {
          if (hw.deferRequest && hw.deferRequest.status === 'pending') return 0;
          if (hw.status === 'doing') return 1;
          if (hw.status === 'pending') return 2;
          return 3;
        };
        return priority(a) - priority(b);
      }).map(hw => {
        const subject = ADMIN_SUBJECTS.find(s => s.id === hw.subject) || ADMIN_SUBJECTS[4];
        const modeText = '⚔️ ' + hw.suggestedDuration + '分钟';
        const bpText = ' · ' + (hw.basePoints ?? 10) + '分';
        let elapsedText = '';
        if (hw.status === 'doing' && hw.startedAt) {
          const elapsed = Math.round((Date.now() - new Date(hw.startedAt)) / 60000);
          elapsedText = ' · 已用' + elapsed + '分钟';
        }
        const statusText = hw.status === 'done' ? ' ✅' : hw.status === 'doing' ? ' 📝' : '';
        const isDeferPending = hw.deferRequest && hw.deferRequest.status === 'pending';
        const deferBadge = isDeferPending
          ? ' <span style="background:var(--warning);color:var(--bg);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">⏭️ 申请延后</span>'
          : '';
        const deferActions = isDeferPending
          ? `<button class="btn-sm" style="background:var(--success);color:#fff;margin-right:4px;" onclick="approveDeferHomework('${hw.id}', '${hw.deferRequest.requestedAt || ''}')">批准</button>
             <button class="btn-sm" style="background:var(--danger);color:#fff;" onclick="rejectDeferHomework('${hw.id}')">拒绝</button>`
          : '';
        return `
              <div class="hw-admin-item">
                <div class="hw-admin-icon">${subject.icon}</div>
                <div class="hw-admin-info">
                  <div class="hw-admin-subject">${escapeHtml(hw.subject)} - ${escapeHtml(hw.content)}${statusText}${deferBadge}</div>
                  <div class="hw-admin-meta">${modeText}${bpText}${hw.actualDuration !== null ? ' · 实际' + hw.actualDuration + '分钟' : ''}${elapsedText}</div>
                </div>
                <div class="hw-admin-actions">
                  ${deferActions}
                  ${hw.status === 'pending' && !isDeferPending ? `<button class="btn-sm btn-edit" onclick="openHwModal('edit', '${hw.id}')">编辑</button>` : ''}
                  ${hw.status === 'pending' && !isDeferPending ? `<button class="btn-sm btn-delete" onclick="deleteAdminHw('${hw.id}')">删除</button>` : ''}
                  ${hw.status === 'done' && !hw.rejected ? `<button class="btn-sm" style="background:var(--warning);color:var(--bg);" onclick="rejectHomework('${hw.id}')">驳回</button>` : ''}
                  ${hw.status === 'done' ? `<button class="btn-sm btn-delete" onclick="deleteAdminHw('${hw.id}')">删除</button>` : ''}
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
      <input type="number" id="adminHwDuration" value="${hw?.suggestedDuration || getSetting('homeworkDefaultSuggestedDuration')}" min="5" max="180" step="5">
    </div>
    <div class="form-group">
      <label>基础分</label>
      <input type="number" id="adminHwBasePoints" value="${hw?.basePoints ?? getSetting('homeworkDefaultBasePoints')}" min="1" max="100">
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
  const basePoints = parseInt(document.getElementById('adminHwBasePoints').value) ?? 10;

  if (adminEditingId) {
    const hw = adminHomeworks.find(h => h.id === adminEditingId);
    if (hw) {
      hw.subject = subject;
      hw.content = content;
      hw.suggestedDuration = suggestedDuration;
      hw.basePoints = basePoints;
    }
  } else {
    adminHomeworks.push({
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      subject,
      content,
      mode: 'pending',
      suggestedDuration,
      basePoints,
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
  // 预生成该作业的所有相关语音
  pregenSpeech([
    '开始' + content,
    '开始' + content + '，挑战' + suggestedDuration + '分钟',
    subject + '作业完成！',
    '挑战成功！' + subject + '提前完成',
    '超时了，本次按计时模式统计，' + subject + '作业完成',
    '已用' + Math.floor(suggestedDuration / 2) + '分钟，继续加油',
  ]);
  showToast(adminEditingId ? '作业已更新' : '作业已添加');
}

async function deleteAdminHw(id) {
  adminHomeworks = adminHomeworks.filter(h => h.id !== id);
  await API.saveHomeworks(AdminUtil.dateKey(adminDate), adminHomeworks);
  await refreshAllData();
  renderHomeworkTab();
  showToast('作业已删除');
}

async function rejectHomework(hwId) {
  const hw = adminHomeworks.find(h => h.id === hwId);
  if (!hw || hw.status !== 'done' || hw.rejected) return;

  hw.status = 'pending';
  hw.rejected = true;
  hw.startedAt = null;
  hw.completedAt = null;
  hw.actualDuration = null;
  hw.mode = 'pending';

  const dateKey = AdminUtil.dateKey(adminDate);
  await API.saveHomeworks(dateKey, adminHomeworks);

  await API.saveSettlement(dateKey, {});

  await refreshAllData();
  renderHomeworkTab();
  showToast('已驳回：' + hw.subject + ' - ' + hw.content);
}

async function approveDeferHomework(hwId, requestedAt) {
  const hw = adminHomeworks.find(h => h.id === hwId);
  if (!hw || !hw.deferRequest || hw.deferRequest.status !== 'pending') return;

  const dateKey = AdminUtil.dateKey(adminDate);
  await API.deferHomework(dateKey, hwId, 'approve', requestedAt);

  await refreshAllData();
  renderHomeworkTab();
  pregenSpeech(['爸爸批准了' + hw.subject + '的延后申请，明天再做']);
  showToast('已批准延后：' + hw.subject + ' - ' + hw.content);
}

async function rejectDeferHomework(hwId) {
  const hw = adminHomeworks.find(h => h.id === hwId);
  if (!hw || !hw.deferRequest || hw.deferRequest.status !== 'pending') return;

  const dateKey = AdminUtil.dateKey(adminDate);
  await API.deferHomework(dateKey, hwId, 'reject', '');

  await refreshAllData();
  renderHomeworkTab();
  pregenSpeech(['爸爸拒绝了' + hw.subject + '的延后申请，今天完成吧']);
  showToast('已拒绝延后：' + hw.subject + ' - ' + hw.content);
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
          <span>${escapeHtml(hw.subject)} - ${escapeHtml(hw.content)}</span>
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
  if (_submittingAdminRating) return;
  const settlement = cachedData?.dailySettlement?.[dateKey];
  if (!settlement || settlement.rating) return;

  _submittingAdminRating = true;
  try {
    const multipliers = getSettingsRatingMultipliers();

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
    // 预生成评级语音
    if (finalPoints > 0) {
      pregenSpeech(['爸爸评了' + rating + '，获得' + finalPoints + '分']);
    }
    showToast(`已评级: ${rating} · 最终积分: ${finalPoints}`);
  } finally {
    _submittingAdminRating = false;
  }
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
              <div class="shop-admin-icon">${item.type === 'time' ? '🎮' : item.type === 'buff' ? '✨' : '🎁'}</div>
              <div class="shop-admin-info">
                <div class="shop-admin-name">${escapeHtml(item.name)}</div>
                <div class="shop-admin-meta">${item.points}积分 · ${item.type === 'buff' && item.buffDuration ? item.buffDuration + (item.buffUnit === 'minutes' ? '分钟' : '天') + ' · ' : ''}剩余${item.remainingQuantity ?? 0}件</div>
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
      <input type="number" id="adminItemPoints" value="${item?.points || getSetting('shopDefaultPoints')}" min="1" max="999">
    </div>
    <div class="form-group">
      <label>商品类型</label>
      <div class="mode-selector">
        <button class="mode-option ${(item?.type || 'time') === 'time' ? 'selected' : ''}"
          onclick="selectAdminItemType('time')">⏱️ 时间类</button>
        <button class="mode-option ${(item?.type || 'time') === 'item' ? 'selected' : ''}"
          onclick="selectAdminItemType('item')">🎁 物品类</button>
        <button class="mode-option ${(item?.type || 'time') === 'buff' ? 'selected' : ''}"
          onclick="selectAdminItemType('buff')">✨ Buff类</button>
      </div>
    </div>
    <div class="form-group" id="adminDurationGroup" style="display:${(item?.type || 'time') === 'item' ? 'none' : 'block'}">
      <label>${(item?.type || 'time') === 'buff' ? '持续时长' : '奖励时长（分钟）'}</label>
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="number" id="adminItemDuration" value="${(item?.type || 'time') === 'buff' ? (item?.buffDuration ?? 30) : (item?.durationMinutes || 30)}" min="1" max="180" step="1" style="width:80px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);text-align:center;">
        <div class="mode-selector" id="adminBuffUnitGroup" style="display:${(item?.type || 'time') === 'buff' ? 'flex' : 'none'};">
          <button class="mode-option ${(item?.buffUnit || 'days') === 'minutes' ? 'selected' : ''}" onclick="selectAdminBuffUnit('minutes')">分钟</button>
          <button class="mode-option ${(item?.buffUnit || 'days') === 'days' ? 'selected' : ''}" onclick="selectAdminBuffUnit('days')">天</button>
        </div>
      </div>
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
  window._adminBuffUnit = item?.buffUnit || 'days';
  document.getElementById('adminModal').classList.add('show');
}

function selectAdminItemType(type) {
  window._adminItemType = type;
  document.querySelectorAll('#adminModalContent .mode-option').forEach(btn => {
    const isTime = btn.textContent.includes('⏱️');
    const isItem = btn.textContent.includes('🎁');
    const isBuff = btn.textContent.includes('✨');
    btn.classList.toggle('selected', (type === 'time' && isTime) || (type === 'item' && isItem) || (type === 'buff' && isBuff));
  });
  document.getElementById('adminDurationGroup').style.display = type === 'item' ? 'none' : 'block';
  const durLabel = document.querySelector('#adminDurationGroup label');
  if (durLabel) durLabel.textContent = type === 'buff' ? '持续时长' : '奖励时长（分钟）';
  const unitGroup = document.getElementById('adminBuffUnitGroup');
  if (unitGroup) unitGroup.style.display = type === 'buff' ? 'flex' : 'none';
}

function selectAdminBuffUnit(unit) {
  window._adminBuffUnit = unit;
  document.querySelectorAll('#adminBuffUnitGroup .mode-option').forEach(btn => {
    const btnUnit = btn.textContent.includes('分钟') ? 'minutes' : 'days';
    btn.classList.toggle('selected', btnUnit === unit);
  });
}

async function saveShopItem() {
  const name = document.getElementById('adminItemName').value.trim();
  const points = parseInt(document.getElementById('adminItemPoints').value) || getSetting('shopDefaultPoints');
  const type = window._adminItemType || 'time';
  const durationMinutes = type === 'item' ? 0 : (parseInt(document.getElementById('adminItemDuration').value) || 30);
  const buffDuration = type === 'buff' ? (parseInt(document.getElementById('adminItemDuration').value) || 30) : 0;
  const buffUnit = type === 'buff' ? (window._adminBuffUnit || 'days') : '';
  const baseQuantity = parseInt(document.getElementById('adminItemBaseQty').value) || 3;
  if (!name) { showToast('请输入商品名称'); return; }

  if (adminEditingId) {
    const item = adminShopItems.find(i => i.id === adminEditingId);
    if (item) {
      item.name = name;
      item.points = points;
      item.type = type;
      item.durationMinutes = durationMinutes;
      item.buffDuration = buffDuration;
      item.buffUnit = buffUnit;
      item.baseQuantity = baseQuantity;
    }
  } else {
    adminShopItems.push({
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name,
      points,
      type,
      durationMinutes,
      buffDuration,
      buffUnit,
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
                <div class="shop-admin-name">${escapeHtml(item.name)}</div>
                <div class="shop-admin-meta">${item.type === 'time' && item.durationMinutes ? item.durationMinutes + '分钟' : ''}${item.type === 'time' && item.durationMinutes ? ' · ' : ''}数量${item.quantity || 0}</div>
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
  if (mode === 'edit' && item) {
    modal.innerHTML = `
      <h3>编辑奖励</h3>
      <div class="form-group">
        <label>奖励名称</label>
        <input type="text" id="adminItemName" value="${item.name}" maxlength="20">
      </div>
      <div class="form-group">
        <label>奖励类型</label>
        <div class="mode-selector">
          <button class="mode-option ${item.type === 'time' ? 'selected' : ''}"
            onclick="selectRewardBoxType('time')">⏱️ 时间类</button>
          <button class="mode-option ${item.type === 'item' ? 'selected' : ''}"
            onclick="selectRewardBoxType('item')">🎁 物品类</button>
        </div>
      </div>
      <div class="form-group" id="adminDurationGroup" style="display:${item.type === 'item' ? 'none' : 'block'}">
        <label>时长（分钟）</label>
        <input type="number" id="adminItemDuration" value="${item.durationMinutes || 30}" min="5" max="180" step="5">
      </div>
      <div class="form-group">
        <label>数量</label>
        <input type="number" id="adminItemQty" value="${item.quantity || 1}" min="1" max="99">
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
        <button class="btn-primary" onclick="saveRewardBoxItem()">保存</button>
      </div>
    `;
    window._adminItemType = item.type;
  } else {
    modal.innerHTML = `
      <h3>添加奖励 — 从积分商店选择</h3>
      <div class="form-group">
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
          ${adminShopItems.length === 0
        ? '<div style="text-align:center;color:var(--text-secondary);padding:16px;">商店暂无商品</div>'
        : adminShopItems.map(si => `
              <div style="padding:12px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);"
                onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                onmouseout="this.style.background='transparent'"
                onclick="addRewardFromShop('${escapeHtml(si.name)}','${si.type}','${si.durationMinutes || 0}')">
                <div>
                  <div style="font-weight:600;">${si.type === 'time' ? '⏱️' : '🎁'} ${escapeHtml(si.name)}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">${si.points}积分${si.type === 'time' && si.durationMinutes ? ' · ' + si.durationMinutes + '分钟' : ''}</div>
                </div>
                <span style="color:var(--accent);font-size:13px;font-weight:600;">+ 添加</span>
              </div>
            `).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
      </div>
    `;
  }

  document.getElementById('adminModal').classList.add('show');
}

async function addRewardFromShop(name, type, durationMinutes) {
  const exists = adminRewardBox.find(i => i.name === name);
  if (exists) {
    exists.quantity = (exists.quantity || 0) + 1;
  } else {
    adminRewardBox.push({
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name,
      type,
      durationMinutes: type === 'time' ? (parseInt(durationMinutes) || 0) : 0,
      quantity: 1,
    });
  }
  await API.saveRewardBox(adminRewardBox);
  closeAdminModal();
  await refreshAllData();
  renderRewardBoxTab();
  showToast('已添加：' + name);
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
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
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
  const fulfilled = adminRedemptions
    .filter(r => r.status === 'fulfilled')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const shownFulfilled = fulfilled.slice(0, _redeemShowCount);
  const hasMore = fulfilled.length > _redeemShowCount;

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
              <div class="redeem-name">${escapeHtml(r.itemName)}${r.fromRewardBox ? ' <span style="font-size:12px;color:var(--accent);">🎁 奖励箱</span>' : ''}<span style="font-size:13px;color:var(--text-secondary);margin-left:6px;">${r.points > 0 ? r.points + '积分' : ''}${r.itemType === 'time' && r.durationMinutes ? (r.points > 0 ? ' · ' : '') + r.durationMinutes + '分钟' : ''}</span></div>
              <div class="redeem-time">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            <span class="redeem-status pending">待兑现</span>
            <button class="btn-fulfill" onclick="fulfillRedemption('${r.id}')">确认兑现</button>
          </div>
        `).join('')}

      <div class="redeem-section-title">已兑现</div>
      ${fulfilled.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:12px;font-size:14px;">暂无</div>'
      : shownFulfilled.map(r => `
          <div class="redeem-item">
            <div class="redeem-info">
              <div class="redeem-name">${escapeHtml(r.itemName)}</div>
              <div class="redeem-time">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
            </div>
            <span class="redeem-status fulfilled">已兑现 ✅</span>
          </div>
        `).join('')}
      ${hasMore || _redeemShowCount > 3 || fulfilled.length > 0 ? `<div style="text-align:center;padding:12px;display:flex;gap:8px;justify-content:center;">
        ${fulfilled.length > 0 ? `<button onclick="clearRedemptionHistory()" style="padding:8px 24px;border:1px solid var(--danger);border-radius:8px;font-size:14px;color:var(--danger);background:transparent;cursor:pointer;">清空记录</button>` : ''}
        ${hasMore ? `<button class="btn-cancel" style="border:1px solid var(--text-secondary);padding:8px 24px;border-radius:8px;font-size:14px;"
          onclick="_redeemShowCount += 10; renderRedeemTab();">查看更多 (剩余${fulfilled.length - _redeemShowCount}条)</button>` : ''}
        ${_redeemShowCount > 3 ? `<button class="btn-cancel" style="border:1px solid var(--text-secondary);padding:8px 24px;border-radius:8px;font-size:14px;"
          onclick="_redeemShowCount = 3; renderRedeemTab();">收起</button>` : ''}
      </div>` : ''}
    </div>`;
}

async function _handleTimeFulfillment(redemption, durationMinutes) {
  const dateKey = AdminUtil.dateKey(adminDate);
  const freeTime = await API.getFreeTime(dateKey);
  freeTime.push({
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    name: redemption.itemName,
    durationMinutes,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    remainingSeconds: durationMinutes * 60,
  });
  await API.saveFreeTime(dateKey, freeTime);
}

async function _handleBuffFulfillment(redemption, buffDuration, buffUnit) {
  const buffs = await API.getActiveBuffs();
  buffs.push({
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    name: redemption.itemName,
    duration: buffDuration,
    unit: buffUnit,
    startDate: buffUnit === 'minutes' ? new Date().toISOString() : AdminUtil.dateKey(adminDate),
  });
  await API.saveActiveBuffs(buffs);
}

async function _fulfillFromRewardBox(redemption) {
  const rewardBox = await API.getRewardBox();
  const rbItem = rewardBox.find(rb => rb.id === redemption.rewardBoxItemId);
  if (rbItem) {
    rbItem.quantity = (rbItem.quantity || 0) - 1;
    if (rbItem.quantity <= 0) {
      const idx = rewardBox.indexOf(rbItem);
      if (idx !== -1) rewardBox.splice(idx, 1);
    }
    await API.saveRewardBox(rewardBox);
  }

  if (redemption.itemType === 'time' && redemption.durationMinutes > 0) {
    await _handleTimeFulfillment(redemption, redemption.durationMinutes);
  }

  if (redemption.itemType === 'buff') {
    const buffDuration = redemption.buffDuration ?? 30;
    const buffUnit = redemption.buffUnit || 'days';
    await _handleBuffFulfillment(redemption, buffDuration, buffUnit);
  }
}

async function _fulfillDirectRedemption(redemption) {
  const itemType = redemption.itemType;
  let durationMinutes = redemption.durationMinutes || 0;

  if ((!itemType || !durationMinutes) && redemption.itemName) {
    const shopItem = adminShopItems.find(i => i.name === redemption.itemName);
    if (shopItem) {
      if (!itemType) redemption.itemType = shopItem.type;
      if (!durationMinutes) durationMinutes = shopItem.durationMinutes || 0;
    }
  }

  if ((itemType || redemption.itemType) === 'time' && durationMinutes > 0) {
    await _handleTimeFulfillment(redemption, durationMinutes);
  }

  if ((itemType || redemption.itemType) === 'buff') {
    const shopItem = adminShopItems.find(i => i.name === redemption.itemName);
    const buffDuration = redemption.buffDuration ?? shopItem?.buffDuration ?? 30;
    const buffUnit = redemption.buffUnit || shopItem?.buffUnit || 'days';
    await _handleBuffFulfillment(redemption, buffDuration, buffUnit);
  }
}

async function fulfillRedemption(id) {
  if (_fulfillingRedemption) return;
  const redemption = adminRedemptions.find(r => r.id === id);
  if (!redemption || redemption.status !== 'pending') return;

  _fulfillingRedemption = true;
  try {
    redemption.status = 'fulfilled';
    await API.saveRedemptions(adminRedemptions);

    if (redemption.fromRewardBox) {
      await _fulfillFromRewardBox(redemption);
    } else {
      await _fulfillDirectRedemption(redemption);
    }

    await refreshAllData();
    renderRedeemTab();
    // 预生成兑现相关的语音
    const texts = [];
    const it = (redemption.itemType || 'time');
    const dm = (redemption.durationMinutes || 0);
    const nm = redemption.itemName;
    if (it === 'time' && dm > 0) {
      texts.push('开始' + nm + '，' + dm + '分钟');
      texts.push(nm + '时间到！');
      texts.push(nm + '已进行' + Math.floor(dm / 2) + '分钟');
      texts.push(nm + '还剩5分钟');
      texts.push(nm + '还剩1分钟');
      texts.push(nm + '时间到，请结束任务');
    }
    if (it === 'buff') {
      texts.push(nm + '已生效');
    }
    pregenSpeech(texts);
    showToast('已确认兑现');
  } finally {
    _fulfillingRedemption = false;
  }
}

async function clearRedemptionHistory() {
  const fulfilled = adminRedemptions.filter(r => r.status === 'fulfilled');
  if (fulfilled.length === 0) return;
  adminRedemptions = adminRedemptions.filter(r => r.status !== 'fulfilled');
  await API.saveRedemptions(adminRedemptions);
  await refreshAllData();
  renderRedeemTab();
  showToast('已清空兑换历史');
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

    const doneHw = hwList.filter(h => h.status === 'done' && h.actualDuration !== null && h.suggestedDuration > 0 && !h.rejected);
    const ratios = doneHw.map(h => h.actualDuration / h.suggestedDuration);
    const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
    efficiencyRatios.push({
      date: date.slice(5),
      value: Math.round(avgRatio * 100),
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
            <span>${s.basePoints + s.efficiencyBonus}×${s.multiplier}=${s.finalPoints}分</span>
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

  if (_calendarYear === null) {
    const base = _selectedCalendarDate || AdminUtil.dateKey(adminDate);
    const parts = base.split('-');
    _calendarYear = parseInt(parts[0]);
    _calendarMonth = parseInt(parts[1]) - 1;
  }
  if (!_selectedCalendarDate) {
    _selectedCalendarDate = AdminUtil.dateKey(adminDate);
  }

  const calHtml = buildMiniCalendar();

  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">⚙️ 积分管理</div>
      <div class="settings-row" style="display:flex;align-items:center;gap:12px;">
        <label>当前余额</label>
        <span id="balanceDisplay" style="font-size:20px;font-weight:700;color:var(--accent);cursor:pointer;border-bottom:2px dashed var(--accent);" onclick="startEditBalance()" title="点击修改积分">${balance}</span>
        <span id="balanceEdit" style="display:none;gap:6px;align-items:center;">
          <input type="number" id="pointsInput" value="" placeholder="新余额值"
            style="width:100px;padding:6px 10px;border:1px solid var(--accent);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
          <button id="btnPointsConfirm" onclick="confirmAdjustPoints()" style="padding:4px 8px;background:none;border:none;color:var(--success);font-size:20px;cursor:pointer;" title="确认">✓</button>
          <button id="btnPointsCancel" onclick="cancelAdjustPoints()" style="padding:4px 8px;background:none;border:none;color:var(--danger);font-size:20px;cursor:pointer;" title="取消">✕</button>
        </span>
      </div>
    </div>

    <div class="admin-card">
      <div class="admin-card-title">⚙️ 参数配置</div>

      <div class="settings-section">
        <div class="settings-section-title">📝 作业默认值</div>
        <div class="settings-row">
          <label>基础分</label>
          <input id="cfg_hwBasePoints" class="settings-input" type="number" min="1" max="100" value="${getSetting('homeworkDefaultBasePoints')}">
        </div>
        <div class="settings-row">
          <label>建议时长（分钟）</label>
          <input id="cfg_hwDuration" class="settings-input" type="number" min="5" max="180" step="5" value="${getSetting('homeworkDefaultSuggestedDuration')}">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">⭐ 评级倍率</div>
        ${(() => {
      const m = getSettingsRatingMultipliers();
      const ch = m.challenge;
      const ti = m.timer;
      const inputHtml = (id, val) => `<input id="${id}" class="settings-input" type="number" step="0.1" min="0" max="10" value="${val}">`;
      return `
            <div class="rating-section">
              <div class="rating-section-label">⚔️ 挑战</div>
              <div class="rating-row">
                <div class="rating-col"><span class="rating-header">优</span>${inputHtml('cfg_ch_you', ch['优'])}</div>
                <div class="rating-col"><span class="rating-header">良</span>${inputHtml('cfg_ch_liang', ch['良'])}</div>
                <div class="rating-col"><span class="rating-header">可</span>${inputHtml('cfg_ch_ke', ch['可'])}</div>
                <div class="rating-col"><span class="rating-header">差</span>${inputHtml('cfg_ch_cha', ch['差'])}</div>
              </div>
            </div>
            <div class="rating-section">
              <div class="rating-section-label">⏱️ 计时</div>
              <div class="rating-row">
                <div class="rating-col"><span class="rating-header">优</span>${inputHtml('cfg_ti_you', ti['优'])}</div>
                <div class="rating-col"><span class="rating-header">良</span>${inputHtml('cfg_ti_liang', ti['良'])}</div>
                <div class="rating-col"><span class="rating-header">可</span>${inputHtml('cfg_ti_ke', ti['可'])}</div>
                <div class="rating-col"><span class="rating-header">差</span>${inputHtml('cfg_ti_cha', ti['差'])}</div>
              </div>
            </div>`;
    })()}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🎯 积分与商品</div>
        <div class="settings-row">
          <label>挑战效率奖励</label>
          <input id="cfg_effBonus" class="settings-input" type="number" min="0" max="100" value="${getSetting('challengeEfficiencyBonus')}">
        </div>
        <div class="settings-row">
          <label>新商品默认积分</label>
          <input id="cfg_shopPoints" class="settings-input" type="number" min="1" max="999" value="${getSetting('shopDefaultPoints')}">
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;">
        <button onclick="resetSettingsToDefaults()" style="flex:1;padding:12px;border:1px solid var(--text-secondary);border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;background:transparent;color:var(--text-secondary);">恢复默认值</button>
        <button onclick="saveAllSettings()" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;background:var(--accent);color:var(--bg);">保存配置</button>
      </div>
    </div>

    <div class="admin-card">
      <div class="admin-card-title">📅 日期管理</div>
      <div style="display:flex;gap:20px;align-items:flex-start;">
        <div style="flex:0 0 auto;">
          ${calHtml}
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:20px;color:var(--accent);" id="selectedDateLabel">当前操作数据为：${AdminUtil.formatDate(adminDate)}</div>
          <button onclick="switchToSelectedDate()" style="padding:10px 20px;border:1px solid var(--accent);border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;background:transparent;color:var(--accent);align-self:stretch;">📅 切换到这一天</button>
          <button onclick="toggleHolidayForDate()" id="btnToggleHoliday" style="padding:10px 20px;border:1px solid var(--warning);border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;background:transparent;color:var(--warning);align-self:stretch;">🏖️ 标记为假日</button>
          <button onclick="resetSelectedDate()" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;align-self:stretch;">🔄 重置这一天</button>
        </div>
      </div>
    </div>
  `;

  updateHolidayButtonLabel();
}

function updateHolidayButtonLabel() {
  const btn = document.getElementById('btnToggleHoliday');
  const label = document.getElementById('selectedDateLabel');
  if (!btn || !_selectedCalendarDate) return;
  const holidays = adminSettings.customHolidays || [];
  if (holidays.includes(_selectedCalendarDate)) {
    btn.textContent = '🏢 标记为工作日';
    btn.style.color = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
  } else {
    btn.textContent = '🏖️ 标记为假日';
    btn.style.color = 'var(--warning)';
    btn.style.borderColor = 'var(--warning)';
  }
  if (label) {
    const d = new Date(_selectedCalendarDate + 'T00:00:00');
    label.textContent = '当前操作数据为：' + AdminUtil.formatDate(d);
  }
}

function selectCalendarDate(year, month, day) {
  const d = new Date(year, month, day);
  _selectedCalendarDate = AdminUtil.dateKey(d);
  _calendarYear = year;
  _calendarMonth = month;
  renderSettingsTab();
}

async function switchToSelectedDate() {
  if (!_selectedCalendarDate) return;
  const parts = _selectedCalendarDate.split('-');
  adminDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  document.getElementById('adminDate').textContent = AdminUtil.formatDate(adminDate);
  await refreshAllData();
  switchTab('homework');
  showToast('已切换到 ' + AdminUtil.formatDate(adminDate));
}

async function toggleHolidayForDate() {
  if (!_selectedCalendarDate) return;
  const holidays = adminSettings.customHolidays || [];
  const idx = holidays.indexOf(_selectedCalendarDate);
  if (idx === -1) {
    holidays.push(_selectedCalendarDate);
    holidays.sort();
    adminSettings.customHolidays = holidays;
    await API.saveSettings(adminSettings);
    await refreshAllData();
    renderSettingsTab();
    showToast('已标记为假日：' + _selectedCalendarDate);
  } else {
    holidays.splice(idx, 1);
    adminSettings.customHolidays = holidays;
    await API.saveSettings(adminSettings);
    await refreshAllData();
    renderSettingsTab();
    showToast('已标记为工作日：' + _selectedCalendarDate);
  }
}

async function resetSelectedDate() {
  if (!_selectedCalendarDate) return;
  await API.resetDate(_selectedCalendarDate);
  await refreshAllData();
  renderSettingsTab();
  showToast(_selectedCalendarDate + ' 已重置');
}

async function saveAllSettings() {
  const val = (id, parseFn) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = parseFn(el.value);
    return isNaN(v) ? null : v;
  };
  const basePoints = val('cfg_hwBasePoints', parseFloat);
  const duration = val('cfg_hwDuration', parseFloat);
  const effBonus = val('cfg_effBonus', parseFloat);
  const shopPoints = val('cfg_shopPoints', parseFloat);

  const chYou = val('cfg_ch_you', parseFloat);
  const chLiang = val('cfg_ch_liang', parseFloat);
  const chKe = val('cfg_ch_ke', parseFloat);
  const chCha = val('cfg_ch_cha', parseFloat);
  const tiYou = val('cfg_ti_you', parseFloat);
  const tiLiang = val('cfg_ti_liang', parseFloat);
  const tiKe = val('cfg_ti_ke', parseFloat);
  const tiCha = val('cfg_ti_cha', parseFloat);

  if (basePoints === null || duration === null || effBonus === null || shopPoints === null ||
    chYou === null || chLiang === null || chKe === null || chCha === null ||
    tiYou === null || tiLiang === null || tiKe === null || tiCha === null) {
    showToast('请填写所有数值');
    return;
  }

  const newSettings = {
    ...adminSettings,
    homeworkDefaultBasePoints: basePoints,
    homeworkDefaultSuggestedDuration: duration,
    ratingMultipliers: {
      challenge: { '优': chYou, '良': chLiang, '可': chKe, '差': chCha },
      timer: { '优': tiYou, '良': tiLiang, '可': tiKe, '差': tiCha }
    },
    challengeEfficiencyBonus: effBonus,
    shopDefaultPoints: shopPoints,
  };

  await API.saveSettings(newSettings);
  adminSettings = newSettings;
  renderSettingsTab();
  showToast('配置已保存');
}

async function resetSettingsToDefaults() {
  adminSettings = {};
  await API.saveSettings({});
  renderSettingsTab();
  showToast('已恢复默认值');
}

async function changeAdminDate(delta) {
  adminDate.setDate(adminDate.getDate() + delta);
  document.getElementById('adminDate').textContent = AdminUtil.formatDate(adminDate);
  await refreshAllData();
  renderCurrentTab();
}

function buildMiniCalendar() {
  const year = _calendarYear;
  const month = _calendarMonth;
  const today = new Date();
  const todayStr = AdminUtil.dateKey(today);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const dayHeaders = ['日', '一', '二', '三', '四', '五', '六'];

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span onclick="navigateCalendarMonth(-1)" style="cursor:pointer;font-size:18px;user-select:none;">◀</span>
    <span style="font-size:16px;font-weight:600;">${year} ${monthNames[month]}</span>
    <span onclick="navigateCalendarMonth(1)" style="cursor:pointer;font-size:18px;user-select:none;">▶</span>
  </div>`;
  html += '<div style="display:grid;grid-template-columns:repeat(7,44px);gap:3px;text-align:center;">';

  dayHeaders.forEach(d => {
    html += `<div style="font-size:13px;color:var(--text-secondary);padding:4px 0;">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i++) {
    html += '<div></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = AdminUtil.dateKey(d);
    const isSelected = _selectedCalendarDate && key === _selectedCalendarDate;
    const hasSettlement = cachedData?.dailySettlement?.[key];
    const hasRating = hasSettlement?.rating;
    const hasHomeworks = (cachedData?.homeworks?.[key] || []).length > 0;
    const holidays = adminSettings.customHolidays || [];

    let className = 'mini-cal-day';
    if (hasRating) {
      className += ' has-rating';
    } else if (hasHomeworks) {
      className += ' has-homeworks';
    } else if (holidays.includes(key)) {
      className += ' holiday';
    }
    if (isSelected) {
      className += ' selected';
    } else if (key === todayStr) {
      className += ' today';
    }
    if (!hasRating && !hasHomeworks && !holidays.includes(key) && !isSelected && key !== todayStr) {
      className += ' no-data';
    }

    html += `<div class="${className}" onclick="selectCalendarDate(${year},${month},${day})">${day}</div>`;
  }

  html += '</div>';
  return html;
}

function navigateCalendarMonth(delta) {
  _calendarMonth += delta;
  if (_calendarMonth < 0) {
    _calendarMonth = 11;
    _calendarYear -= 1;
  } else if (_calendarMonth > 11) {
    _calendarMonth = 0;
    _calendarYear += 1;
  }
  renderSettingsTab();
}

function startEditBalance() {
  _editingBalance = true;
  document.getElementById('balanceDisplay').style.display = 'none';
  const edit = document.getElementById('balanceEdit');
  edit.style.display = 'flex';
  document.getElementById('pointsInput').focus();
}

function cancelAdjustPoints() {
  _editingBalance = false;
  const input = document.getElementById('pointsInput');
  if (input) input.value = '';
  document.getElementById('balanceEdit').style.display = 'none';
  document.getElementById('balanceDisplay').style.display = '';
}

async function confirmAdjustPoints() {
  const input = document.getElementById('pointsInput');
  const newBalance = parseInt(input.value);
  if (isNaN(newBalance) || newBalance < 0) {
    showToast('请输入有效的积分值');
    return;
  }
  if (_adjustingPoints) return;
  _adjustingPoints = true;
  try {
    const oldBalance = cachedData?.points?.balance ?? cachedData?.points ?? 0;
    const diff = newBalance - oldBalance;
    if (diff !== 0) {
      const action = diff > 0 ? 'earn' : 'spend';
      await API.updatePoints(action, Math.abs(diff), `爸爸调整积分至${newBalance}`);
    }
    await refreshAllData();
    renderSettingsTab();
    pregenSpeech(['积分已更新为' + newBalance + '分']);
    showToast('积分已更新为：' + newBalance);
  } finally {
    _adjustingPoints = false;
    _editingBalance = false;
  }
}

// ========== Modal ==========
function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('show');
  adminEditingId = null;
}

// ========== Init ==========
initAdmin();
