/**
 * admin.js - 管理端逻辑
 * 负责作业管理、商店管理、兑换管理、评级、统计、设置
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });
  });
}

// ========== Transition Mask ==========
function showTransitionMask(text) {
  var mask = document.getElementById('transitionMask');
  if (!mask) return;
  if (mask.style.display === 'flex') return;
  document.getElementById('transitionText').textContent = text;
  mask.style.display = 'flex';
  clearTimeout(mask._timeout);
  mask._timeout = setTimeout(function () { mask.style.display = 'none'; }, 5000);
}
function hideTransitionMask() {
  var mask = document.getElementById('transitionMask');
  if (!mask) return;
  clearTimeout(mask._timeout);
  mask.style.display = 'none';
}

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
let adminBountyTasks = [];
let adminBountySubmissions = {};
let adminBountyCompletions = {};
let adminCurrentTab = 'homework';
let adminEditingId = null;
let adminSettings = {};
let _submittingAdminRating = false;
let _fulfillingRedemption = false;
let _adjustingPoints = false;
let _editingBalance = false;
let _editingSettings = false;
let _redeemShowCount = 3;
let _ratingShowCount = 5;
let _selectedCalendarDate = null;
let _calendarYear = null;
let _calendarMonth = null;

const SETTINGS_DEFAULTS = {
  dailyBasePoints: 50,
  homeworkBonusPerTask: 10,
  homeworkDefaultSuggestedDuration: 20,
  ratingMultipliers: { '优': 2.0, '良': 1.5, '可': 1.2, '差': 0 },
  shopDefaultPoints: 50,
};

function getSetting(key) {
  const val = adminSettings[key];
  if (val !== undefined && val !== null) return val;
  return SETTINGS_DEFAULTS[key];
}

function getSettingsRatingMultipliers() {
  return adminSettings.ratingMultipliers || SETTINGS_DEFAULTS.ratingMultipliers;
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
  showTransitionMask('正在加载数据…');
  document.getElementById('adminDate').textContent = AdminUtil.formatDate(new Date());

  document.getElementById('adminModal').addEventListener('click', (e) => {
    const subjectBtn = e.target.closest('.subject-option');
    if (subjectBtn && subjectBtn.dataset.subject) {
      selectAdminSubject(subjectBtn.dataset.subject);
    }
  });

  await ConnectionManager.start();
  await refreshAllData();
  updateSettingsTabState();
  hideTransitionMask();
  // 恢复上次停留的标签页
  try { var savedTab = localStorage.getItem('adminTab'); } catch (e) { /* 非致命 */ }
  switchTab(savedTab && ['homework','shop','rewardBox','bounty','redeem','stats','settings'].indexOf(savedTab) !== -1 ? savedTab : 'homework');

  setInterval(async () => {
    await refreshAllData();
    updateSettingsTabState();
    const modal = document.getElementById('adminModal');
    if ((modal && modal.classList.contains('show')) || _editingBalance || _editingSettings) return;
    renderCurrentTab();
  }, 5000);

  try { await CRDTLog.migrateFromChangeLog(); } catch (e) { }
}

async function refreshAllData() {
  var mode = ConnectionManager.getMode();

  if (mode === 'reconnecting') return;

  if (mode === 'online') {
    try {
      var data = await API.getData();
      if (data) {
        var oldSettlements = cachedData?.dailySettlement || {};
        var newSettlements = data.dailySettlement || {};
        for (var dk of Object.keys(oldSettlements)) {
          var oldS = oldSettlements[dk];
          var newS = newSettlements[dk];
          if (oldS && oldS.rating && !(newS && newS.rating)) {
            if (!data.dailySettlement) data.dailySettlement = {};
            data.dailySettlement[dk] = oldS;
          }
        }
        cachedData = data;
        try { await DB.cacheFullData(data); } catch (e) { }
        _applyCachedData();
      }
    } catch (e) {
      var localData = await DB.getFullData();
      if (localData && Object.keys(localData).length > 0) {
        cachedData = localData;
        _applyCachedData();
      }
    }
  } else {
    var localData = await DB.getFullData();
    if (localData && Object.keys(localData).length > 0) {
      cachedData = localData;
      _applyCachedData();
    }
  }
}

function _applyCachedData() {
  API.migrateBountyCompletionsToTotal(cachedData);
  adminHomeworks = cachedData.homeworks?.[AdminUtil.dateKey(adminDate)] || [];
  adminShopItems = cachedData.shopItems || [];
  adminRedemptions = cachedData.redemptions || [];
  adminRewardBox = cachedData.rewardBox || [];
  adminBountyTasks = cachedData.bountyTasks || [];
  adminBountySubmissions = cachedData.bountySubmissions || {};
  adminBountyCompletions = cachedData.bountyCompletions || {};
  adminSettings = cachedData.settings || {};
}

// ========== Tab Switching ==========
function switchTab(tab) {
  if (tab === 'settings' && ConnectionManager.getMode() === 'offline') {
    showToast('离线模式无法修改设置');
    return;
  }
  adminCurrentTab = tab;
  // 持久化当前标签页，刷新后恢复
  try { localStorage.setItem('adminTab', tab); } catch (e) { /* 非致命 */ }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderCurrentTab();
}

function updateSettingsTabState() {
  var isOffline = ConnectionManager.getMode() === 'offline';
  document.querySelectorAll('.tab-btn[data-tab="settings"]').forEach(function(btn) {
    var icon = btn.querySelector('.tab-icon');
    if (icon) {
      icon.textContent = isOffline ? '🔒' : '⚙️';
      btn.title = isOffline ? '离线模式无法修改设置' : '';
    }
  });
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
    case 'bounty': renderBountyTab(); break;
    case 'stats': renderStatsTab(); break;
    case 'settings': renderSettingsTab(); break;
  }
}

function toggleMobileNav() {
  document.getElementById('mobileNav').classList.toggle('open');
  document.getElementById('mobileNavOverlay').classList.toggle('open');
  document.getElementById('hamburgerBtn').textContent =
    document.getElementById('mobileNav').classList.contains('open') ? '✕' : '☰';
}

function closeMobileNav() {
  document.getElementById('mobileNav').classList.remove('open');
  document.getElementById('mobileNavOverlay').classList.remove('open');
  document.getElementById('hamburgerBtn').textContent = '☰';
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
        const submittedDate = AdminUtil.dateKey(adminDate);
        const settlement = cachedData?.dailySettlement?.[submittedDate];

        const totalChallengeMinutes = adminHomeworks.reduce((sum, h) => sum + (h.suggestedDuration || 0), 0);
        const hours = Math.floor(totalChallengeMinutes / 60);
        const mins = totalChallengeMinutes % 60;
        const formattedDuration = hours > 0 ? `${hours}小时${mins > 0 ? mins + '分钟' : ''}` : `${mins}分钟`;

        const totalRewardScore = adminHomeworks.reduce((sum, h) => sum + (h.basePoints || 0), 0);

        const earnedScore = settlement?.homeworkBonus != null ? settlement.homeworkBonus :
          adminHomeworks.filter(h => h.status === 'done' && h.mode === 'challenge' && !h.rejected)
            .reduce((sum, h) => sum + (h.basePoints || 0), 0);
        const isRated = settlement?.homeworkBonus != null;

        let progressText = `完成进度: ${doneCount}/${totalCount}`;
        if (doneCount === totalCount) progressText += ' ✅ 全部完成';
        else if (doingCount > 0) progressText += ` · ${doingCount}项进行中`;

        return `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(56,189,248,0.08);border-radius:8px;font-size:14px;font-weight:600;color:var(--accent);display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <span>📋 ${progressText}</span>
          <span style="color:var(--text-secondary);margin:0 2px;">·</span>
          <span>⏱️ 挑战总时长: ${formattedDuration}</span>
          <span style="color:var(--text-secondary);margin:0 2px;">·</span>
          <span>🏆 总奖励分: ${totalRewardScore}分</span>
          <span style="color:var(--text-secondary);margin:0 2px;">·</span>
          <span>💰 ${isRated ? '已获得积分' : '预估积分'}: ${earnedScore}分</span>
        </div>`;
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
        const bpText = ' · ' + (hw.basePoints ?? 10) + '奖励分';
        let elapsedText = '';
        if (hw.status === 'doing' && hw.startedAt) {
          const elapsed = Math.round((Date.now() - new Date(hw.startedAt)) / 60000);
          elapsedText = ' · 已用' + elapsed + '分钟';
        }
        const isDeferPending = hw.deferRequest && hw.deferRequest.status === 'pending';
        const deferBadge = isDeferPending
          ? ' <span style="background:var(--warning);color:var(--bg);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">⏭️ 申请延后</span>'
          : '';
        const completedInSchoolBadge = (hw.status === 'done' && hw.completedInSchool)
          ? ' <span style="background:var(--success);color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🏫在校完成</span>'
          : '';
        const deferActions = isDeferPending
          ? `<button class="btn-sm" style="background:var(--success);color:#fff;margin-right:4px;" onclick="approveDeferHomework('${hw.id}', '${hw.deferRequest.requestedAt || ''}')">批准</button>
             <button class="btn-sm" style="background:var(--danger);color:#fff;" onclick="rejectDeferHomework('${hw.id}')">拒绝</button>`
          : '';
        let statusHtml = '';
        if (isDeferPending) {
          statusHtml = '<span class="hw-status-emoji">⏭️</span><span class="hw-status-text">待确认</span>';
        } else if (hw.status === 'doing') {
          statusHtml = '<span class="hw-status-emoji">📝</span><span class="hw-status-text">进行中</span>';
        } else if (hw.status === 'done' && hw.mode === 'challenge') {
          statusHtml = '<span class="hw-status-emoji">⚡</span><span class="hw-status-text">挑战成功</span>';
        } else if (hw.status === 'done') {
          statusHtml = '<span class="hw-status-emoji">✅</span><span class="hw-status-text">已完成</span>';
        } else if (hw.rejected) {
          statusHtml = '<span class="hw-status-emoji">↩️</span><span class="hw-status-text">已驳回</span>';
        } else {
          statusHtml = '<span class="hw-status-emoji">📋</span><span class="hw-status-text">未开始</span>';
        }
        return `
              <div class="hw-admin-item">
                <div class="hw-admin-icon">${subject.icon}</div>
                <div class="hw-admin-info">
                  <div class="hw-admin-subject">${escapeHtml(hw.subject)} - ${escapeHtml(hw.content)}${deferBadge}${completedInSchoolBadge}</div>
                  <div class="hw-admin-meta">${modeText}${bpText}${hw.actualDuration !== null ? ' · 实际' + hw.actualDuration + '分钟' : ''}${elapsedText}</div>
                </div>
                <div class="hw-admin-status">${statusHtml}</div>
                <div class="hw-admin-actions">
                  ${deferActions}
                  ${hw.status === 'pending' && !isDeferPending ? `<button class="btn-sm btn-edit" onclick="openHwModal('edit', '${hw.id}')">编辑</button>` : ''}
                  ${hw.status === 'pending' && !isDeferPending ? `<button class="btn-sm btn-delete" onclick="deleteAdminHw('${hw.id}')">删除</button>` : ''}
                  ${hw.status === 'done' && !hw.rejected && !(cachedData?.dailySettlement?.[submittedDate]?.rating) ? `<button class="btn-sm" style="background:var(--warning);color:var(--bg);" onclick="rejectHomework('${hw.id}')">驳回</button>` : ''}
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
      <label>奖励分</label>
      <input type="number" id="adminHwBasePoints" value="${hw?.basePoints ?? getSetting('homeworkBonusPerTask')}" min="1" max="100">
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
    // 编辑已有作业：只 PATCH 改动的字段，不发整条作业
    var dateKey = AdminUtil.dateKey(adminDate);
    await API.patchHomework(adminEditingId, { subject, content, suggestedDuration, basePoints }, dateKey);
  } else {
    const newHw = {
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
      completedInSchool: false,
    };
    adminHomeworks.push(newHw);
    // 新增作业：只 PUT 这一条
    await API.putHomework(newHw.id, newHw);

    const dateKey = AdminUtil.dateKey(adminDate);
    const existingSettlement = cachedData?.dailySettlement?.[dateKey];
    if (!existingSettlement || !existingSettlement.rating) {
      await API.putSettlement(dateKey, {});
    }
  }
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
  var dateKey = AdminUtil.dateKey(adminDate);
  await API.deleteHomework(id, dateKey);
  await refreshAllData();
  renderHomeworkTab();
  showToast('作业已删除');
}

async function rejectHomework(hwId) {
  const hw = adminHomeworks.find(h => h.id === hwId);
  if (!hw || hw.status !== 'done' || hw.rejected) return;

  const dateKey = AdminUtil.dateKey(adminDate);
  const settlement = cachedData?.dailySettlement?.[dateKey];
  if (settlement && settlement.rating) return;

  hw.status = 'pending';
  hw.rejected = true;
  hw.startedAt = null;
  hw.completedAt = null;
  hw.actualDuration = null;
  hw.completedInSchool = false;
  hw.mode = 'pending';

  // 只 PATCH 改动的字段，不发整条作业
  await API.patchHomework(hwId, {
    status: 'pending',
    rejected: true,
    startedAt: null,
    completedAt: null,
    actualDuration: null,
    completedInSchool: false,
    mode: 'pending',
  }, dateKey);

  await API.putSettlement(dateKey, {});

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
  pregenSpeech([hw.subject + '的延后申请已批准，明天再做']);
  showToast('已批准延后：' + hw.subject + ' - ' + hw.content);
}

async function rejectDeferHomework(hwId) {
  const hw = adminHomeworks.find(h => h.id === hwId);
  if (!hw || !hw.deferRequest || hw.deferRequest.status !== 'pending') return;

  const dateKey = AdminUtil.dateKey(adminDate);
  await API.deferHomework(dateKey, hwId, 'reject', '');

  await refreshAllData();
  renderHomeworkTab();
  pregenSpeech([hw.subject + '的延后申请未通过，今天完成吧']);
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
      每日基础分: ${settlement.dailyBase}<br>
      作业奖励: +${settlement.homeworkBonus}<br>
      待结算: ${settlement.totalBeforeRating}
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

    const multiplier = multipliers[rating];

    const finalPoints = rating === '差' ? 0
      : Math.round(settlement.totalBeforeRating * multiplier);

    settlement.rating = rating;
    settlement.multiplier = multiplier;
    settlement.finalPoints = finalPoints;
    settlement.ratedAt = timeStr;

    await API.putSettlement(dateKey, settlement);

    if (finalPoints > 0) {
      await API.updatePoints('earn', finalPoints, `完成作业，评级${rating}`);
    }

    closeAdminModal();
    await refreshAllData();
    renderHomeworkTab();
    // 预生成评级语音
    if (finalPoints > 0) {
      pregenSpeech(['今天作业获得的评价是……' + rating + '！']);
    }
    showToast(`已评级: ${rating} · 最终积分: ${finalPoints}`);
  } finally {
    _submittingAdminRating = false;
  }
}

// ========== Tab 2: Shop ==========
function renderShopTab() {
  const container = document.getElementById('adminContent');
  const sorted = [...adminShopItems].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">🏪 积分商店管理</div>
      <div id="adminShopList">
        ${adminShopItems.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无商品</div>'
      : sorted.map(item => `
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
      createdAt: Date.now(),
    });
  }

  const target = adminEditingId
    ? adminShopItems.find(i => i.id === adminEditingId)
    : adminShopItems[adminShopItems.length - 1];
  if (target) {
    await API.putShopItem(target.id, target);
  }
  closeAdminModal();
  await refreshAllData();
  renderShopTab();
  if (!adminEditingId) pregenSpeech(['积分商店上新啦']);
  showToast(adminEditingId ? '商品已更新' : '商品已添加');
}

async function adjustShopQty(itemId, delta) {
  const item = adminShopItems.find(i => i.id === itemId);
  if (!item) return;
  item.remainingQuantity = Math.max(0, (item.remainingQuantity ?? 0) + delta);
  await API.putShopItem(item.id, item);
  await refreshAllData();
  renderShopTab();
}

async function deleteShopItem(id) {
  adminShopItems = adminShopItems.filter(i => i.id !== id);
  await API.deleteShopItem(id);
  await refreshAllData();
  renderShopTab();
  showToast('商品已删除');
}

// ========== Tab 3: Reward Box ==========
function renderRewardBoxTab() {
  const container = document.getElementById('adminContent');
  const sorted = [...adminRewardBox].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">🎁 奖励箱管理</div>
      <div id="adminRewardBoxList">
        ${adminRewardBox.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">奖励箱为空</div>'
      : sorted.map(item => `
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
    await API.putRewardBoxItem(exists.id, exists);
  } else {
    const newItem = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name,
      type,
      durationMinutes: type === 'time' ? (parseInt(durationMinutes) || 0) : 0,
      quantity: 1,
      createdAt: Date.now(),
    };
    adminRewardBox.push(newItem);
    await API.putRewardBoxItem(newItem.id, newItem);
  }
  closeAdminModal();
  await refreshAllData();
  renderRewardBoxTab();
  pregenSpeech(['奖励箱有新奖励，快去看看吧']);
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
      createdAt: Date.now(),
    });
  }

  const target = adminEditingId
    ? adminRewardBox.find(i => i.id === adminEditingId)
    : adminRewardBox[adminRewardBox.length - 1];
  if (target) {
    await API.putRewardBoxItem(target.id, target);
  }
  closeAdminModal();
  await refreshAllData();
  renderRewardBoxTab();
  if (!adminEditingId) pregenSpeech(['奖励箱有新奖励，快去看看吧']);
  showToast(adminEditingId ? '奖励已更新' : '奖励已添加');
}

async function adjustRewardBoxQty(itemId, delta) {
  const item = adminRewardBox.find(i => i.id === itemId);
  if (!item) return;
  item.quantity = Math.max(0, (item.quantity || 0) + delta);
  if (item.quantity <= 0) {
    adminRewardBox = adminRewardBox.filter(i => i.id !== itemId);
  }
  await API.putRewardBoxItem(item.id, item);
  await refreshAllData();
  renderRewardBoxTab();
  if (delta > 0) pregenSpeech(['奖励箱有新奖励，快去看看吧']);
}

async function deleteRewardBoxItem(id) {
  adminRewardBox = adminRewardBox.filter(i => i.id !== id);
  // 记录 CRDT 删除操作（无单独 DELETE API，服务端 applyCRDTOperation 负责删除）
  try { var op = { type: 'delete', table: 'reward_box', resourceId: id, field: null, value: null }; CRDTLog.append(op); } catch (e) { /* 非致命 */ }
  // 同步到本地 DB
  try {
    var items = await DB.getRewardBox();
    var idx = items.findIndex(function(i) { return i.id === id || i.uuid === id; });
    if (idx !== -1) {
      items.splice(idx, 1);
      await DB.saveRewardBox(items);
    }
  } catch (e) { /* 非致命 */ }
  await refreshAllData();
  renderRewardBoxTab();
  showToast('已删除');
}

// ========== Bounty Tasks ==========
function debugBounty() {
  console.log('adminBountyCompletions:', JSON.parse(JSON.stringify(adminBountyCompletions)));
  console.log('historyCounts:', window._bountyHistoryCounts);
  console.log('tasks:', adminBountyTasks.map(t => ({ id: t.id, name: t.name, type: t.type })));
}
function renderBountyTab() {
  const container = document.getElementById('adminContent');
  const dateKey = AdminUtil.dateKey(adminDate);
  const submissions = (adminBountySubmissions[dateKey] || []).filter(s => !s.isDeleted);
  const pendingSubmissions = submissions.filter(s => s.status === 'submitted');
  const pendingTaskIds = new Set(pendingSubmissions.map(s => s.taskId));
  const doingTaskIds = new Set(submissions.filter(s => s.status === 'doing').map(s => s.taskId));

  const sorted = [...adminBountyTasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const historyCounts = {};
  const totalComps = (adminBountyCompletions && adminBountyCompletions._total) || {};
  for (const tid of Object.keys(totalComps)) {
    const v = totalComps[tid];
    const delta = typeof v === 'number' ? v : (v ? 1 : 0);
    if (delta > 0) historyCounts[tid] = delta;
  }
  window._bountyHistoryCounts = historyCounts;

  const titleCount = pendingSubmissions.length > 0
    ? ` (${pendingSubmissions.length} 待审核)`
    : '';

  container.innerHTML = `
    <div class="admin-card">
      <div class="admin-card-title">💰 赏金任务管理${titleCount}</div>
      <div id="adminBountyList">
        ${adminBountyTasks.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无赏金任务</div>'
      : sorted.map(item => {
        const isPending = pendingTaskIds.has(item.id);
        const isDoing = doingTaskIds.has(item.id);
        const submission = submissions.find(s => s.taskId === item.id);
        const submitTime = submission?.submittedAt ? new Date(submission.submittedAt).toLocaleString('zh-CN') : '';
        let statusMeta = '';
        if (item.completedAt) statusMeta = ' · 已完成';
        else if (isPending) statusMeta = ' · 待审核 ' + submitTime;
        else if (isDoing) statusMeta = ' · 进行中';
        const countVal = item.type !== 'once' ? historyCounts[item.id] : 0;
        const countHtml = countVal ? `<span style="margin-left:auto;margin-right:16px;font-size:18px;font-weight:700;color:var(--accent);white-space:nowrap;">x ${countVal}</span>` : '';
        let actionsHtml = '';
        if (isPending) {
          actionsHtml = `
          <button class="btn-sm" style="background:var(--warning);color:var(--bg);" onclick="approveBountySubmission('${dateKey}', '${item.id}')">通过</button>
          <button class="btn-sm" style="background:var(--danger);color:#fff;" onclick="rejectBountySubmission('${dateKey}', '${item.id}')">拒绝</button>`;
        } else {
          actionsHtml = `
          <button class="btn-sm btn-edit" onclick="openBountyModal('edit', '${item.id}')">编辑</button>
          <button class="btn-sm btn-delete" onclick="deleteBountyTask('${item.id}')">删除</button>`;
        }
        return `
            <div class="shop-admin-item"${isPending ? ' style="border-left:3px solid var(--warning);"' : ''}>
              <div class="shop-admin-icon">${item.type === 'once' ? '🪙' : '💰'}</div>
              <div class="shop-admin-info">
                <div class="shop-admin-name">${escapeHtml(item.name)}</div>
                <div class="shop-admin-meta">+${item.points || 0}分 · ${item.type === 'once' ? '一次性' : '常驻'}${statusMeta} · ${item.enabled !== false ? '已启用' : '已禁用'}</div>
              </div>
              ${countHtml}
              <div class="hw-admin-actions">
                ${actionsHtml}
              </div>
            </div>`;
      }).join('')}
      </div>
      <button class="btn-add" onclick="openBountyModal('add')">+ 添加赏金任务</button>
    </div>`;
}

function openBountyModal(mode, itemId) {
  adminEditingId = mode === 'edit' ? itemId : null;
  const item = adminEditingId ? adminBountyTasks.find(i => i.id === adminEditingId) : null;

  const modal = document.getElementById('adminModalContent');
  modal.innerHTML = `
    <h3>${adminEditingId ? '编辑赏金任务' : '添加赏金任务'}</h3>
    <div class="form-group">
      <label>任务名称</label>
      <input type="text" id="adminBountyName" value="${item?.name || ''}" placeholder="例如：帮妈妈洗一次碗" maxlength="20">
    </div>
    <div class="form-group">
      <label>奖励分数</label>
      <input type="number" id="adminBountyPoints" value="${item?.points || 5}" min="1" max="100">
    </div>
    <div class="form-group">
      <label>任务类型</label>
      <div class="mode-selector" id="adminBountyTypeSelector">
        <button class="mode-option ${(item?.type || 'recurring') === 'recurring' ? 'selected' : ''}"
          data-type="recurring" onclick="selectBountyType('recurring')">🔄 常驻</button>
        <button class="mode-option ${(item?.type || 'recurring') === 'once' ? 'selected' : ''}"
          data-type="once" onclick="selectBountyType('once')">⚡ 一次性</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeAdminModal()">取消</button>
      <button class="btn-primary" onclick="saveBountyTask()">保存</button>
    </div>
  `;

  window._bountyType = item?.type || 'recurring';

  document.getElementById('adminModal').classList.add('show');
}

function selectBountyType(type) {
  window._bountyType = type;
  document.querySelectorAll('#adminBountyTypeSelector .mode-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.type === type);
  });
}

async function saveBountyTask() {
  const name = document.getElementById('adminBountyName').value.trim();
  const points = parseInt(document.getElementById('adminBountyPoints').value) || 5;
  const type = window._bountyType || 'recurring';
  if (!name) { showToast('请输入任务名称'); return; }

  if (adminEditingId) {
    const item = adminBountyTasks.find(i => i.id === adminEditingId);
    if (item) {
      item.name = name;
      item.points = points;
      item.type = type;
    }
  } else {
    adminBountyTasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name,
      points,
      type,
      enabled: true,
      createdAt: Date.now(),
    });
  }

  const target = adminEditingId
    ? adminBountyTasks.find(i => i.id === adminEditingId)
    : adminBountyTasks[adminBountyTasks.length - 1];
  if (target) {
    await API.putBountyTask(target.id, target);
  }
  closeAdminModal();
  await refreshAllData();
  renderBountyTab();
  showToast(adminEditingId ? '赏金任务已更新' : '赏金任务已添加');
}

async function deleteBountyTask(id) {
  await API.deleteBountyTask(id);
  await refreshAllData();
  renderBountyTab();
  showToast('赏金任务已删除');
}

let _approvingBounty = false;

async function approveBountySubmission(dateKey, taskId) {
  if (_approvingBounty) return;
  _approvingBounty = true;
  try {
    const submissions = (adminBountySubmissions[dateKey] || []).slice();
    const idx = submissions.findIndex(s => s.taskId === taskId);
    if (idx === -1) return;
    submissions.splice(idx, 1);
    for (var i = 0; i < submissions.length; i++) {
      await API.putBountySubmission(submissions[i].id, submissions[i]);
    }

    if (!adminBountyCompletions._total) adminBountyCompletions._total = {};
    adminBountyCompletions._total[taskId] = (adminBountyCompletions._total[taskId] || 0) + 1;
    await API.putBountyCompletion('_total', adminBountyCompletions._total);

    const task = adminBountyTasks.find(t => t.id === taskId);
    if (task && task.points > 0) {
      await API.updatePoints('earn', task.points, '赏金任务：' + task.name);
    }

    if (task && task.type === 'once') {
      task.completedAt = new Date().toISOString();
      await API.putBountyTask(task.id, task);
    }

    pregenSpeech([(task ? task.name : '任务') + '完成，加' + (task.points || 0) + '分！']);
    await refreshAllData();

    renderBountyTab();
    showToast('赏金任务已通过' + (task ? '：' + task.name : ''));
  } finally {
    _approvingBounty = false;
  }
}

async function rejectBountySubmission(dateKey, taskId) {
  const submissions = adminBountySubmissions[dateKey] || [];
  const submission = submissions.find(s => s.taskId === taskId);
  if (!submission || submission.status !== 'submitted') return;

  submission.status = 'doing';
  submission.submittedAt = null;
  for (var i = 0; i < submissions.length; i++) {
    await API.putBountySubmission(submissions[i].id, submissions[i]);
  }

  const task = adminBountyTasks.find(t => t.id === taskId);
  pregenSpeech([(task ? task.name : '任务') + '失败了，下次加油！']);
  await refreshAllData();
  renderBountyTab();
  showToast('赏金任务已退回' + (task ? '：' + task.name : ''));
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
        ${fulfilled.length > 0 && ConnectionManager.getMode() !== 'offline' ? `<button onclick="clearRedemptionHistory()" style="padding:8px 24px;border:1px solid var(--danger);border-radius:8px;font-size:14px;color:var(--danger);background:transparent;cursor:pointer;">清空记录</button>` : ''}
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
  const newFt = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    name: redemption.itemName,
    durationMinutes,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    remainingSeconds: durationMinutes * 60,
  };
  freeTime.push(newFt);
  await API.putFreeTimeTask(newFt.id, newFt);
}

async function _handleBuffFulfillment(redemption, buffDuration, buffUnit) {
  const buffs = await API.getActiveBuffs();
  const newBuff = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    name: redemption.itemName,
    duration: buffDuration,
    unit: buffUnit,
    startDate: buffUnit === 'minutes' ? new Date().toISOString() : AdminUtil.dateKey(adminDate),
  };
  buffs.push(newBuff);
  await API.putBuff(newBuff.id, newBuff);
}

async function _fulfillFromRewardBox(redemption) {
  const rewardBox = await API.getRewardBox();
  const rbItem = rewardBox.find(rb => rb.id === redemption.rewardBoxItemId);
  if (rbItem) {
    rbItem.quantity = (rbItem.quantity || 0) - 1;
    if (rbItem.quantity <= 0) {
      const idx = rewardBox.indexOf(rbItem);
      if (idx !== -1) rewardBox.splice(idx, 1);
      // 无单独 DELETE API，PUT 剩余物品到服务端
      for (var i = 0; i < rewardBox.length; i++) {
        await API.putRewardBoxItem(rewardBox[i].id, rewardBox[i]);
      }
    } else {
      await API.putRewardBoxItem(rbItem.id, rbItem);
    }
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
    for (var i = 0; i < adminRedemptions.length; i++) {
      await API.putRedemption(adminRedemptions[i].id, adminRedemptions[i]);
    }

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
  await API.clearRedemptionHistory();
  await refreshAllData();
  renderRedeemTab();
  showToast('已清空兑换历史');
}

// ========== SVG Chart Helpers ==========
function renderSvgLineChart(data, options) {
  const { width = 600, height = 180, color = 'var(--success)', avgColor = 'var(--accent)', unit = '', yMax } = options;
  const pad = { top: 20, right: 20, bottom: 25, left: 40 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const values = data.map(d => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const maxVal = yMax || rawMax;
  const minVal = rawMin > 0 ? Math.max(0, Math.floor(rawMin * 0.9 / 10) * 10) : 0;
  const range = maxVal - minVal || 1;
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const points = data.map((d, i) => {
    const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = pad.top + chartH - ((d.value - minVal) / range) * chartH;
    return { x, y, label: d.label, value: d.value };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const circles = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}" stroke="var(--card)" stroke-width="1.5"/>`).join('');
  const maxLabels = Math.min(points.length, 10);
  const labelStep = points.length > 1 ? (points.length - 1) / Math.max(maxLabels - 1, 1) : 1;
  const labelIndices = [];
  for (let k = 0; k < maxLabels; k++) labelIndices.push(Math.min(Math.round(k * labelStep), points.length - 1));
  const labels = labelIndices.map(i => `<text x="${points[i].x}" y="${height - 5}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${points[i].label}</text>`).join('');
  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  const valuesTxt = points.filter(p => p.value === dataMax || p.value === dataMin).map(p => `<text class="chart-value-label" x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="${color}">${p.value}</text>`).join('');
  const yLabels = [];
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round(minVal + (range / ySteps) * (ySteps - i));
    const yy = pad.top + (chartH / ySteps) * i;
    yLabels.push(`<text x="${pad.left - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${val}</text>`);
    if (i > 0) yLabels.push(`<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`);
  }

  const avgY = pad.top + chartH - ((avg - minVal) / range) * chartH;
  let avgLine = '';
  if (avg > 0 && values.length > 1) {
    avgLine = `<line x1="${pad.left}" y1="${avgY}" x2="${width - pad.right}" y2="${avgY}" stroke="${avgColor}" stroke-dasharray="4,4" stroke-width="1.5"/>
      <text x="${width - pad.right}" y="${avgY - 4}" text-anchor="end" font-size="10" fill="${avgColor}">平均 ${Math.round(avg)}${unit}</text>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;">
      ${yLabels.join('')}
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${circles}
      ${avgLine}
      ${valuesTxt}
      ${labels}
    </svg>`;
}

function renderSvgPieChart(data, total) {
  const cx = 80, cy = 70, r = 55;
  let curAngle = -90;
  const colors = { '优': 'var(--success)', '良': 'var(--accent)', '可': 'var(--warning)', '差': 'var(--danger)' };
  const segments = data.map(d => {
    const angle = (d.count / total) * 360;
    const start = curAngle;
    const end = curAngle + angle;
    curAngle = end;
    return { ...d, start, end };
  });
  const paths = segments.map(d => {
    if (d.count === 0) return '';
    const sr = (d.start * Math.PI) / 180, er = (d.end * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr);
    const x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
    const span = d.end - d.start;
    if (span >= 359.999) {
      // 360° 圆弧需拆成两段 180° 弧，否则 SVG 终点=起点时退化为空
      const mid = d.start + 180;
      const mr = (mid * Math.PI) / 180;
      const xm = cx + r * Math.cos(mr), ym = cy + r * Math.sin(mr);
      return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 1,1 ${xm},${ym} A${r},${r} 0 1,1 ${x2},${y2} Z" fill="${colors[d.rating] || 'var(--text-secondary)'}"/>`;
    }
    const large = span > 180 ? 1 : 0;
    return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${colors[d.rating] || 'var(--text-secondary)'}"/>`;
  }).join('');
  return `<svg viewBox="0 0 160 140" style="width:160px;height:140px;">${paths}</svg>`;
}

function renderStackedBarChart(data) {
  const width = 600, height = 180;
  const pad = { top: 24, right: 16, bottom: 32, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(1, ...data.map(d => d.inSchool + d.atHome));
  const yMax = Math.ceil(maxVal * 1.1);

  const yLines = [];
  const yStep = yMax <= 4 ? 1 : Math.ceil(yMax / 4);
  for (let v = 0; v <= yMax; v += yStep) yLines.push(v);
  if (yLines[yLines.length - 1] < yMax) yLines.push(yMax);

  // 柱子均匀分布
  const n = data.length;
  const barTotalWidth = plotW / n;
  const barWidth = Math.max(4, barTotalWidth * 0.7);
  const barGap = (barTotalWidth - barWidth) / 2;
  const labelInterval = n <= 14 ? 1 : n <= 31 ? 3 : Math.ceil(n / 10);

  let barsSvg = '';
  let labelsSvg = '';

  data.forEach((d, i) => {
    const total = d.inSchool + d.atHome;
    const barX = pad.left + i * barTotalWidth + barGap;
    const bottomY = pad.top + plotH;
    const totalH = total > 0 ? plotH * (total / yMax) : 0;
    const inSchoolH = total > 0 ? plotH * (d.inSchool / yMax) : 0;
    const atHomeH = totalH - inSchoolH;

    // 在校（底部，贴横轴）
    if (d.inSchool > 0) {
      barsSvg += `<rect x="${barX}" y="${bottomY - inSchoolH}" width="${barWidth}" height="${Math.max(1, inSchoolH)}" fill="var(--success)" rx="1"><title>${d.label} 在校 ${d.inSchool}项</title></rect>`;
    }
    // 在家（顶部）
    if (d.atHome > 0) {
      barsSvg += `<rect x="${barX}" y="${bottomY - inSchoolH - atHomeH}" width="${barWidth}" height="${Math.max(1, atHomeH)}" fill="var(--accent)" rx="1"><title>${d.label} 在家 ${d.atHome}项</title></rect>`;
    }

    if (i % labelInterval === 0) {
      const lx = barX + barWidth / 2;
      labelsSvg += `<text x="${lx}" y="${height - 5}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${d.label}</text>`;
    }
  });

  let gridSvg = '';
  yLines.forEach(v => {
    const y = pad.top + plotH * (1 - v / yMax);
    gridSvg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>\n`;
    gridSvg += `<text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${v}</text>\n`;
  });

  // 图例
  const legendX = pad.left;
  const legendY = 2;
  const legendSvg = `
    <rect x="${legendX}" y="${legendY}" width="10" height="10" fill="var(--success)" rx="2"/>
    <text x="${legendX + 14}" y="${legendY + 9}" font-size="10" fill="var(--text-secondary)">在校</text>
    <rect x="${legendX + 44}" y="${legendY}" width="10" height="10" fill="var(--accent)" rx="2"/>
    <text x="${legendX + 58}" y="${legendY + 9}" font-size="10" fill="var(--text-secondary)">在家</text>
  `;

  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;">${gridSvg}${barsSvg}${labelsSvg}${legendSvg}</svg>`;
}

// ========== Tab 5: Statistics ==========
let _statsRange = 'week';

function setStatsRange(range) {
  _statsRange = range;
  _ratingShowCount = 5;
  renderStatsTab();
}

function getGroupMode(dateCount) {
  if (_statsRange !== 'all') return 'day';
  if (dateCount <= 31) return 'day';
  if (dateCount <= 180) return 'week';
  return 'month';
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return mon.toISOString().slice(0, 10);
}

function formatWeekLabel(key) {
  const parts = key.split('-');
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `${d.getMonth() + 1}/${d.getDate()}-${end.getMonth() + 1}/${end.getDate()}`;
}

function aggregateDaily(data, groupMode, mode) {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map(d => ({ label: d.date.slice(5), value: d.value }));

  const groups = {};
  data.forEach((d, i) => {
    const key = groupMode === 'week' ? getWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  return Object.entries(groups).map(([key, items]) => {
    const sum = items.reduce((s, d) => s + d.value, 0);
    const value = mode === 'mean' ? Math.round(sum / items.length) : Math.round(sum);
    return {
      label: groupMode === 'week' ? formatWeekLabel(key) : key,
      value,
    };
  });
}

function aggregateCompletionData(data, groupMode) {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map(d => {
    return { label: d.date.slice(5), inSchool: d.inSchool, atHome: d.atHome };
  });

  const groups = {};
  data.forEach(d => {
    const key = groupMode === 'week' ? getWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  return Object.entries(groups).map(([key, items]) => {
    const inSchool = items.reduce((s, d) => s + d.inSchool, 0);
    const atHome = items.reduce((s, d) => s + d.atHome, 0);
    return {
      label: groupMode === 'week' ? formatWeekLabel(key) : key,
      inSchool,
      atHome,
    };
  });
}

function renderStatsTab() {
  const container = document.getElementById('adminContent');

  const allDates = Object.keys(cachedData?.dailySettlement || {}).sort();
  const maxDays = _statsRange === 'month' ? 30 : _statsRange === 'week' ? 7 : 9999;
  const dateRange = maxDays >= 9999 ? allDates : allDates.slice(-maxDays);
  const groupMode = getGroupMode(dateRange.length);

  const totalMinData = [];
  const effRatioData = [];
  const dailyPointsData = [];

  dateRange.forEach(date => {
    const hwList = cachedData?.homeworks?.[date] || [];
    const doneHw = hwList.filter(h => h.status === 'done' && !h.rejected);
    const totalMin = doneHw.reduce((sum, h) => sum + (h.actualDuration || 0), 0);
    totalMinData.push({ date, value: totalMin });

    const effHw = doneHw.filter(h => h.suggestedDuration > 0 && h.actualDuration !== null);
    const ratios = effHw.map(h => h.actualDuration / h.suggestedDuration);
    const avgRatio = ratios.length > 0 ? Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length * 100) : 0;
    effRatioData.push({ date, value: avgRatio });

    const settlement = cachedData?.dailySettlement?.[date];
    dailyPointsData.push({ date, value: settlement?.finalPoints ?? 0 });
  });

  const totalMinutes = aggregateDaily(totalMinData, groupMode, 'mean');
  const efficiencyRatios = aggregateDaily(effRatioData, groupMode, 'mean');
  const dailyPoints = aggregateDaily(dailyPointsData, groupMode);

  const ratingsList = dateRange.filter(d => cachedData?.dailySettlement?.[d]?.rating).reverse();
  const ratingCounts = {};
  const ratingColors = { '优': 'var(--success)', '良': 'var(--accent)', '可': 'var(--warning)', '差': 'var(--danger)' };
  ratingsList.forEach(d => {
    const r = cachedData?.dailySettlement?.[d]?.rating;
    if (r) ratingCounts[r] = (ratingCounts[r] || 0) + 1;
  });
  const ratingPieData = Object.entries(ratingCounts).map(([rating, count]) => ({ rating, count }));
  const ratingTotal = ratingPieData.reduce((s, d) => s + d.count, 0);

  // 在校提前完成比例
  const completedInSchoolBarData = [];
  dateRange.forEach(date => {
    const hwList = cachedData?.homeworks?.[date] || [];
    const doneHw = hwList.filter(h => h.status === 'done' && !h.rejected);
    const inSchool = doneHw.filter(h => h.completedInSchool).length;
    const atHome = doneHw.length - inSchool;
    completedInSchoolBarData.push({ date, inSchool, atHome });
  });
  const barData = aggregateCompletionData(completedInSchoolBarData, groupMode);

  const shownRatings = ratingsList.slice(0, _ratingShowCount);
  const hasMoreRatings = ratingsList.length > _ratingShowCount;

  const avgTotalMin = totalMinutes.length > 0 ? Math.round(totalMinutes.reduce((a, b) => a + b.value, 0) / totalMinutes.length) : 0;
  const avgEff = efficiencyRatios.filter(e => e.value > 0);
  const avgEffVal = avgEff.length > 0 ? Math.round(avgEff.reduce((a, b) => a + b.value, 0) / avgEff.length) : 0;

  const rangeOptions = [
    { key: 'week', label: '周' },
    { key: 'month', label: '月' },
    { key: 'all', label: '总计' },
  ];

  const dateCount = dateRange.length;
  const groupLabels = { day: '每日', week: '每周', month: '每月' };

  const makeRangeBtn = (opt) =>
    `<button class="mode-option${_statsRange === opt.key ? ' selected' : ''}" onclick="setStatsRange('${opt.key}')">${opt.label}</button>`;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-value">${avgTotalMin}分钟</div>
        <div class="stat-card-label">${groupLabels[groupMode] === '每日' ? '日均' : groupLabels[groupMode] === '每周' ? '周均' : '月均'}用时</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${avgEffVal}%</div>
        <div class="stat-card-label">平均效率比</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${dailyPoints.reduce((a, b) => a + b.value, 0)}</div>
        <div class="stat-card-label">获得积分</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${calcStreak(allDates)}</div>
        <div class="stat-card-label">连续全勤天数</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">
      ${rangeOptions.map(makeRangeBtn).join('')}
      <span style="font-size:12px;color:var(--text-secondary);margin-left:auto;">${dateCount} 天${groupMode !== 'day' ? ' · 按' + groupLabels[groupMode] + '聚合' : ''}</span>
    </div>

    <div class="chart-container">
      <div class="chart-title">📈 ${groupLabels[groupMode]}总用时（分钟）</div>
      ${totalMinutes.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无数据</div>'
      : renderSvgLineChart(totalMinutes, { color: 'var(--success)', avgColor: 'var(--accent)', unit: '分钟' })}
    </div>

    <div class="chart-container">
      <div class="chart-title">📊 ${groupLabels[groupMode]}效率比（实际/参考）</div>
      ${efficiencyRatios.length === 0 || efficiencyRatios.every(d => d.value === 0)
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无数据</div>'
      : renderSvgLineChart(efficiencyRatios, { color: 'var(--warning)', avgColor: 'var(--accent)', unit: '%' })}
    </div>

    <div class="chart-container">
      <div class="chart-title">🏫 在校提前完成比例</div>
      ${barData.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:14px;">暂无数据</div>'
      : renderStackedBarChart(barData)}
    </div>

    <div class="chart-container">
      <div class="chart-title">📅 评级历史</div>
      <div class="chart-pie-section">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
        ${ratingTotal > 0 ? renderSvgPieChart(ratingPieData, ratingTotal) : ''}
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${ratingPieData.map(d =>
        `<div style="display:flex;align-items:center;gap:8px;font-size:13px;">
              <span style="width:10px;height:10px;border-radius:2px;background:${ratingColors[d.rating] || 'var(--text-secondary)'};display:inline-block;"></span>
              ${d.rating}: ${d.count}次 (${Math.round(d.count / ratingTotal * 100)}%)
            </div>`
      ).join('')}
        </div>
      </div>
      </div>
      <div class="chart-list-section">
      ${ratingsList.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:12px;font-size:14px;">暂无评级记录</div>'
      : shownRatings.map(d => {
        const s = cachedData?.dailySettlement?.[d];
        return `<div class="rating-history-item">
              <span>${d}</span>
              <span>${s.totalBeforeRating}×${s.multiplier}=${s.finalPoints}分</span>
              <span class="rating-grade ${s.rating}">${s.rating}</span>
            </div>`;
      }).join('')}
      ${hasMoreRatings || _ratingShowCount > 5 ? `<div style="text-align:center;padding:12px;display:flex;gap:8px;justify-content:center;">
        ${hasMoreRatings ? `<button class="btn-cancel" style="border:1px solid var(--text-secondary);padding:8px 24px;border-radius:8px;font-size:14px;"
          onclick="_ratingShowCount += 10; renderStatsTab();">查看更多 (剩余${ratingsList.length - _ratingShowCount}条)</button>` : ''}
        ${_ratingShowCount > 5 ? `<button class="btn-cancel" style="border:1px solid var(--text-secondary);padding:8px 24px;border-radius:8px;font-size:14px;"
          onclick="_ratingShowCount = 5; renderStatsTab();">收起</button>` : ''}
      </div>` : ''}
      </div>
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

  // 离线时设置页不可用
  if (ConnectionManager.getMode() === 'offline') {
    container.innerHTML = `
      <div class="admin-card" style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:16px;">🔒</div>
        <div style="font-size:18px;font-weight:600;color:var(--text-secondary);">离线模式无法修改设置</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-top:8px;">请连接服务器后重试</div>
      </div>`;
    return;
  }

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
    <div class="settings-grid">
    <div class="admin-card">
      <div class="admin-card-title">📅 日期管理</div>
      <div class="date-mgmt-row" style="display:flex;flex-direction:column;gap:12px;align-items:center;">
        <div style="flex:0 0 auto;">
          ${calHtml}
        </div>
        <div class="date-mgmt-btns" style="display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:20px;color:var(--accent);" id="selectedDateLabel">当前操作数据为：${AdminUtil.formatDate(adminDate)}</div>
          <button onclick="switchToSelectedDate()" style="padding:10px 20px;border:1px solid var(--accent);border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;background:transparent;color:var(--accent);align-self:stretch;">📅 切换到这一天</button>
          <button onclick="toggleHolidayForDate()" id="btnToggleHoliday" style="padding:10px 20px;border:1px solid var(--warning);border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;background:transparent;color:var(--warning);align-self:stretch;">🏖️ 标记为假日</button>
          <button onclick="resetSelectedDate()" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;align-self:stretch;">🔄 重置这一天</button>
        </div>
      </div>
    </div>

    <div class="admin-card">
      <div class="admin-card-title">⚙️ 参数配置</div>

      <div class="settings-section">
        <div class="settings-section-title">💰 当前余额</div>
        <div class="settings-row" style="display:flex;align-items:center;gap:12px;">
          <label>余额</label>
          <span id="balanceDisplay" style="font-size:20px;font-weight:700;color:var(--accent);cursor:pointer;border-bottom:2px dashed var(--accent);" onclick="startEditBalance()" title="点击修改积分">${balance}</span>
          <span id="balanceEdit" style="display:none;gap:6px;align-items:center;">
            <input type="number" id="pointsInput" value="" placeholder="新余额值"
              style="width:100px;padding:6px 10px;border:1px solid var(--accent);border-radius:6px;font-size:14px;background:var(--bg);color:var(--text);">
            <button id="btnPointsConfirm" onclick="confirmAdjustPoints()" style="padding:4px 8px;background:none;border:none;color:var(--success);font-size:20px;cursor:pointer;" title="确认">✓</button>
            <button id="btnPointsCancel" onclick="cancelAdjustPoints()" style="padding:4px 8px;background:none;border:none;color:var(--danger);font-size:20px;cursor:pointer;" title="取消">✕</button>
          </span>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">📝 作业默认值</div>
        <div class="settings-row">
          <label>建议时长（分钟）</label>
          <input id="cfg_hwDuration" onfocus="_editingSettings=true" onblur="_editingSettings=false" class="settings-input" type="number" min="5" max="180" step="5" value="${getSetting('homeworkDefaultSuggestedDuration')}">
        </div>
        <div class="settings-row">
          <label>每项作业奖励分</label>
          <input id="cfg_hwBonusPerTask" onfocus="_editingSettings=true" onblur="_editingSettings=false" class="settings-input" type="number" min="1" max="100" value="${getSetting('homeworkBonusPerTask')}">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">⭐ 评级倍率</div>
        ${(() => {
      const m = getSettingsRatingMultipliers();
      const inputHtml = (id, val) => `<input id="${id}" onfocus="_editingSettings=true" onblur="_editingSettings=false" class="settings-input" type="number" step="0.1" min="0" max="10" value="${val}">`;
      return `
            <div class="rating-section">
              <div class="rating-row">
                <div class="rating-col"><span class="rating-header">优</span>${inputHtml('cfg_ch_you', m['优'])}</div>
                <div class="rating-col"><span class="rating-header">良</span>${inputHtml('cfg_ch_liang', m['良'])}</div>
                <div class="rating-col"><span class="rating-header">可</span>${inputHtml('cfg_ch_ke', m['可'])}</div>
                <div class="rating-col"><span class="rating-header">差</span>${inputHtml('cfg_ch_cha', m['差'])}</div>
              </div>
            </div>`;
    })()}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🎯 积分</div>
        <div class="settings-row">
          <label>每日基础分</label>
          <input id="cfg_dailyBasePoints" onfocus="_editingSettings=true" onblur="_editingSettings=false" class="settings-input" type="number" min="1" max="999" value="${getSetting('dailyBasePoints')}">
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🏪 商品</div>
        <div class="settings-row">
          <label>新商品默认积分</label>
          <input id="cfg_shopPoints" onfocus="_editingSettings=true" onblur="_editingSettings=false" class="settings-input" type="number" min="1" max="999" value="${getSetting('shopDefaultPoints')}">
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;">
        <button onclick="resetSettingsToDefaults()" style="flex:1;padding:12px;border:1px solid var(--text-secondary);border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;background:transparent;color:var(--text-secondary);">恢复默认值</button>
        <button onclick="saveAllSettings()" style="flex:1;padding:12px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;background:var(--accent);color:var(--bg);">保存配置</button>
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
  if (ConnectionManager.getMode() === 'offline') {
    showToast('离线模式暂不可用，请连接服务器后操作');
    return;
  }
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
    await API.putSettings(adminSettings);
    await refreshAllData();
    renderSettingsTab();
    showToast('已标记为假日：' + _selectedCalendarDate);
  } else {
    holidays.splice(idx, 1);
    adminSettings.customHolidays = holidays;
    await API.putSettings(adminSettings);
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
  const dailyBasePoints = val('cfg_dailyBasePoints', parseFloat);
  const homeworkBonusPerTask = val('cfg_hwBonusPerTask', parseFloat);
  const duration = val('cfg_hwDuration', parseFloat);
  const shopPoints = val('cfg_shopPoints', parseFloat);

  const chYou = val('cfg_ch_you', parseFloat);
  const chLiang = val('cfg_ch_liang', parseFloat);
  const chKe = val('cfg_ch_ke', parseFloat);
  const chCha = val('cfg_ch_cha', parseFloat);

  if (dailyBasePoints === null || homeworkBonusPerTask === null || duration === null || shopPoints === null ||
    chYou === null || chLiang === null || chKe === null || chCha === null) {
    showToast('请填写所有数值');
    return;
  }

  const newSettings = {
    ...adminSettings,
    dailyBasePoints,
    homeworkBonusPerTask,
    homeworkDefaultSuggestedDuration: duration,
    ratingMultipliers: { '优': chYou, '良': chLiang, '可': chKe, '差': chCha },
    shopDefaultPoints: shopPoints,
  };

  await API.putSettings(newSettings);
  adminSettings = newSettings;
  renderSettingsTab();
  showToast('配置已保存');
}

async function resetSettingsToDefaults() {
  adminSettings = {};
  await API.putSettings({});
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
      await API.updatePoints(action, Math.abs(diff), `积分已被调整为${newBalance}`);
      const note = diff > 0
        ? '获得奖励积分：' + diff + '分'
        : '被惩罚，扣除积分：' + Math.abs(diff) + '分';
      const s = { ...(cachedData?.settings || {}), _pointsAdjustmentNote: note };
      await API.putSettings(s);
      pregenSpeech([note]);
    }
    await refreshAllData();
    renderSettingsTab();
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
