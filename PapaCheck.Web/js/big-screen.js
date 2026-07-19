/**
 * big-screen.js - 大屏模式渲染逻辑
 * 负责当前任务、作业卡片（含计时器）、结算页面、统计的渲染
 */

function getSubject(subjectName) {
  const subs = cachedData?.settings?.subjects || DEFAULT_SUBJECTS;
  const found = subs.find(s => s.id === subjectName);
  return found || { icon: null, color: null };
}

const PAGE = { MAIN: 'main', SHOP: 'shop', SETTLEMENT: 'settlement', RATED: 'rated' };
let currentPage = PAGE.MAIN;
let needsFullRender = true;
let forceMainPage = false;
let _updatingBigScreen = false; // 防止递归调用
let _redeemingItem = false;
let _redeemingRewardBox = false;
let _requestingDefer = false;
let _startingBounty = false;
let _submittingBounty = false;

/**
 * 在线守卫：CloudBase 迁移后始终在线，保留接口兼容
 */
function guardOnline() {
  return true;
}

function isTomorrowHoliday() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.getDay();
  if (day === 0 || day === 6) return true;
  const holidays = cachedData?.settings?.customHolidays || [];
  const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  return holidays.includes(key);
}

// ---- Lightweight per-second tick: active timers ----
function tickFrame() {
  if (isAnyTaskPaused()) return;

  const activeHw = getActiveHomework();
  if (activeHw && !activeHw.paused) {
    checkReminders(activeHw);
  }

  const activeFt = getActiveFreeTime();
  if (activeFt) {
    checkFreeTimeReminders(activeFt);
  }

  if (currentPage !== PAGE.MAIN) return;
  if (needsFullRender) {
    needsFullRender = false;
    updateMainPage();
    updateStats();
    return;
  }

  tickActiveTimers(activeHw);
}

function tickActiveTimers(activeHw) {
  const now = new Date();

  // Current task card
  const activeFt = getActiveFreeTime();
  const active = activeFt || activeHw;

  if (active) {
    const taskEl = document.getElementById('currentTaskDisplay');
    const timerEl = taskEl && taskEl.querySelector('[data-role="ct-timer"]');
    const pbarEl = taskEl && taskEl.querySelector('[data-role="ct-pbar"]');
    const labelEl = taskEl && taskEl.querySelector('[data-role="ct-label"]');
    const startedAt = new Date(active.startedAt);
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);

    if (activeFt) {
      const totalSeconds = activeFt.durationMinutes * 60;
      const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
      const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

      if (timerEl) timerEl.textContent = remainingSeconds > 0
        ? '剩余: ' + Util.formatDuration(remainingSeconds)
        : '时间到！';

      let cls = 'homework-timer countdown';
      if (remainingSeconds <= 0) cls = 'homework-timer overtime';
      else if (remainingSeconds < 120) cls = 'homework-timer warning';
      if (timerEl) timerEl.className = cls;

      if (pbarEl) {
        pbarEl.style.width = progress + '%';
        pbarEl.className = 'homework-progress-fill' + (progress >= 100 ? ' overtime' : progress >= 90 ? ' warning' : '');
      }
      if (labelEl) labelEl.textContent = progress + '%';
    } else if (activeHw) {
      if (activeHw.mode === 'challenge') {
        const totalSeconds = activeHw.suggestedDuration * 60;
        const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
        const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

        if (timerEl) timerEl.textContent = remainingSeconds > 0
          ? '倒计时: ' + Util.formatDuration(remainingSeconds)
          : '超时 ' + Util.formatDuration(elapsedSeconds - totalSeconds);

        let cls = 'homework-timer countdown';
        if (progress >= 100) cls = 'homework-timer overtime';
        else if (progress >= 80) cls = 'homework-timer warning';
        if (timerEl) timerEl.className = cls;

        if (pbarEl) {
          pbarEl.style.width = progress + '%';
          pbarEl.className = 'homework-progress-fill' + (progress >= 100 ? ' overtime' : progress >= 80 ? ' warning' : '');
        }
        if (labelEl) labelEl.textContent = progress + '%';
      } else {
        if (timerEl) {
          timerEl.textContent = '已用: ' + Util.formatDuration(elapsedSeconds);
          timerEl.className = 'homework-timer elapsed';
        }
      }
    }
  }

  // Homework grid cards
  const cards = document.querySelectorAll('.homework-card[data-hw-id]');
  cards.forEach(card => {
    const hwId = card.getAttribute('data-hw-id');
    const hw = homeworks.find(h => h.id === hwId);
    if (!hw || hw.status !== 'doing') return;

    const startedAt = new Date(hw.startedAt);
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);
    const timerEl = card.querySelector('[data-role="hw-timer"]');
    const pbarEl = card.querySelector('[data-role="hw-pbar"]');
    const statusEl = card.querySelector('[data-role="hw-status"]');

    if (hw.mode === 'challenge') {
      const totalSeconds = hw.suggestedDuration * 60;
      const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
      const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

      if (timerEl) {
        timerEl.textContent = remainingSeconds > 0
          ? '剩余 ' + Util.formatDuration(remainingSeconds)
          : '超时 ' + Util.formatDuration(elapsedSeconds - totalSeconds);
        let tcls = 'homework-timer countdown';
        if (progress >= 100) tcls = 'homework-timer overtime';
        else if (progress >= 80) tcls = 'homework-timer warning';
        timerEl.className = tcls;
      }
      if (pbarEl) {
        pbarEl.style.width = progress + '%';
        let pcls = 'homework-progress-fill';
        if (progress >= 100) pcls += ' overtime';
        else if (progress >= 80) pcls += ' warning';
        pbarEl.className = pcls;
      }
    } else {
      if (timerEl) {
        timerEl.textContent = '已用 ' + Util.formatDuration(elapsedSeconds);
        timerEl.className = 'homework-timer elapsed';
      }
    }
    if (statusEl) statusEl.textContent = '进行中';
  });

  // FreeTime grid cards
  const ftCards = document.querySelectorAll('.homework-card[data-ft-id]');
  ftCards.forEach(card => {
    const ftId = card.getAttribute('data-ft-id');
    const ft = freeTimeTasks.find(t => t.id === ftId);
    if (!ft || ft.status !== 'doing') return;

    const startedAt = new Date(ft.startedAt);
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);
    const remainingSeconds = Math.max(0, ft.durationMinutes * 60 - elapsedSeconds);
    const progress = Math.min(100, Math.round(elapsedSeconds / (ft.durationMinutes * 60) * 100));

    const timerEl = card.querySelector('[data-role="ft-timer"]');
    const pbarEl = card.querySelector('[data-role="ft-pbar"]');

    if (timerEl) {
      timerEl.textContent = remainingSeconds > 0
        ? '剩余 ' + Util.formatDuration(remainingSeconds)
        : '时间到！';
      let tcls = 'homework-timer countdown';
      if (remainingSeconds <= 0) tcls = 'homework-timer overtime';
      else if (remainingSeconds < 120) tcls = 'homework-timer warning';
      timerEl.className = tcls;
    }
    if (pbarEl) {
      pbarEl.style.width = progress + '%';
      let pcls = 'homework-progress-fill';
      if (progress >= 100) pcls += ' overtime';
      else if (progress >= 90) pcls += ' warning';
      pbarEl.className = pcls;
    }

    if (remainingSeconds <= 0) {
      completeFreeTime(ft.id);
    }
  });
}

function markNeedsRender() {
  needsFullRender = true;
}

// ---- Full render (called on data/state changes) ----
function updateBigScreen() {
  if (_updatingBigScreen) return; // 防止递归
  _updatingBigScreen = true;
  try {
    const now = new Date();
    document.getElementById('bigDate').textContent = Util.formatDate(now);
    document.getElementById('bigTime').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const activeHw = getActiveHomework();
    if (activeHw && !activeHw.paused) {
      checkReminders(activeHw);
    }

    if (currentPage === PAGE.SHOP) {
      updateShopPage();
      return;
    }

    const settlement = getSettlementData();
    if (!forceMainPage && settlement && settlement.rating && !settlement.viewedAt) {
      updateRatedPage();
      return;
    }
    if (!forceMainPage && !getActiveBounty() && settlement && settlement.submittedAt && !settlement.rating) {
      updateSettlementPage();
      return;
    }
    if (!forceMainPage && !getActiveBounty() && settlement && settlement.dailyBase !== undefined && !settlement.submittedAt && !settlement.rating) {
      window._settlement = settlement;
      updateSettlementPage();
      return;
    }

    // [诊断+防御] 全部作业已完成但结算页面未显示时记录日志并尝试修复
    if (homeworks.length > 0 && homeworks.every(h => h.status === 'done')) {
      const key = Util.dateKey(currentDate);
      console.warn('[Settlement] 全部完成但未显示结算界面, state:', {
        settlement: JSON.stringify(settlement),
        window_settlement: JSON.stringify(window._settlement),
        cachedData_settlement: cachedData?.dailySettlement?.[key],
        cachedData_settlement_keys: cachedData?.dailySettlement ? Object.keys(cachedData.dailySettlement) : null,
        cachedData_has_settlement: cachedData?.dailySettlement ? key in cachedData.dailySettlement : false,
        forceMainPage,
        activeBounty: getActiveBounty() ? 'yes' : 'no',
        currentPage,
        _calculatingSettlement: typeof _calculatingSettlement !== 'undefined' ? _calculatingSettlement : 'N/A'
      });
      // 防御重算：如果 window._settlement 有数据但条件未通过，强制显示结算页
      // 注意：已查看过评级的结算不再强制显示，否则孩子点击"回到首页"后会被拉回结算页
      if (window._settlement && window._settlement.dailyBase !== undefined && !settlement?.viewedAt) {
        console.warn('[Settlement] 防御触发: window._settlement 存在但未显示, 强制显示');
        updateSettlementPage();
        return;
      }
      if (!_calculatingSettlement && !settlement?.viewedAt) {
        console.warn('[Settlement] 防御触发: 触发重新计算');
        calculateSettlement();
        return;
      }
    }

    updateMainPage();
    updateStats();
    needsFullRender = false;
    forceMainPage = false;
  } finally {
    _updatingBigScreen = false;
  }
}

function getSettlementData() {
  if (cachedData && cachedData.dailySettlement) {
    var serverData = cachedData.dailySettlement[Util.dateKey(currentDate)];
    if (serverData) {
      // 防御：serverData 存在但没有 dailyBase（可能为空对象或数据异常），不受理
      if (serverData.dailyBase !== undefined) return serverData;
      console.warn('[Settlement] serverData 缺少 dailyBase, 跳过:', JSON.stringify(serverData));
    }
  }
  if (cachedData && cachedData._settlement) {
    if (cachedData._settlement.dailyBase !== undefined) return cachedData._settlement;
    console.warn('[Settlement] cachedData._settlement 缺少 dailyBase, 跳过:', JSON.stringify(cachedData._settlement));
  }
  if (window._settlement) {
    if (window._settlement.dailyBase !== undefined) return window._settlement;
    console.warn('[Settlement] window._settlement 缺少 dailyBase, 跳过:', JSON.stringify(window._settlement));
  }
  return null;
}

// ========== Main Page ==========
function updateMainPage() {
  currentPage = PAGE.MAIN;

  document.getElementById('bigHeader').style.display = '';
  renderBuffBar();
  updateCurrentTask();
  updateHomeworkGrid();
  updateFreeTimeGrid();

  document.getElementById('settlementContainer').style.display = 'none';
  document.getElementById('ratedContainer').style.display = 'none';
  document.getElementById('shopContainer').style.display = 'none';
  document.getElementById('bigContent').style.display = '';
  document.getElementById('bigStats').style.display = '';
}

function renderBuffBar() {
  const buffBar = document.getElementById('buffBar');
  if (!buffBar) return;
  const buffs = cachedData?.activeBuffs || [];
  if (buffs.length === 0) {
    buffBar.style.display = 'none';
    return;
  }
  buffBar.style.display = 'flex';
  buffBar.innerHTML = buffs.map(b => {
    return `<span style="font-size:16px;font-weight:600;color:var(--accent);">✨ ${escapeHtml(b.name)}</span>`;
  }).join('');
}

function updateCurrentTask() {
  const display = document.getElementById('currentTaskDisplay');
  const activeHw = getActiveHomework();
  const activeFt = getActiveFreeTime();

  if (activeFt) {
    renderActiveFreeTimeInCurrentTask(display, activeFt);
    return;
  }

  if (activeHw) {
    renderActiveHomeworkInCurrentTask(display, activeHw);
    return;
  }

  {
    const activeBounty = getActiveBounty();
    if (activeBounty) {
      const bountyTasks = cachedData?.bountyTasks || [];
      const task = bountyTasks.find(t => t.id === activeBounty.taskId);
      if (task) {
        const allC = cachedData?.bountyCompletions || {};
        const totalComps = allC._total || {};
        const v = totalComps[task.id];
        const cCount = typeof v === 'number' ? v : (v ? 1 : 0);
        const cBadge = task.type !== 'once' && cCount > 0 ? ' <span style="font-size:18px;font-weight:700;color:var(--accent);">x' + cCount + '</span>' : '';
        display.innerHTML = `
          <div class="current-task-icon">${task.type === 'once' ? '🪙' : '💰'}</div>
          <div class="current-task-name">赏金任务：${escapeHtml(task.name)}</div>
          <div class="current-task-time">进行中 · +${task.points || 0}分 · ${task.type === 'once' ? '一次性' : '常驻'}${cBadge}</div>
          <div class="task-actions" style="margin-top:12px;display:flex;gap:8px;justify-content:center;">
            <button onclick="abandonBountyTask('${task.id}')" style="padding:10px 28px;border:1px solid var(--danger);border-radius:12px;background:transparent;color:var(--danger);font-size:18px;font-weight:600;cursor:pointer;">放弃</button>
            <button onclick="submitBountyTask('${task.id}')" style="padding:10px 28px;border:none;border-radius:12px;background:var(--accent);color:var(--bg);font-size:18px;font-weight:600;cursor:pointer;">完成</button>
          </div>
        `;
        return;
      }
    }
  }

  {
    const dateKey = Util.dateKey(currentDate);
    const submissions = (cachedData?.bountySubmissions?.[dateKey] || []).filter(s => !s.isDeleted);
    const submittedBounty = submissions.find(s => s.status === 'submitted');
    if (submittedBounty) {
      const task = (cachedData?.bountyTasks || []).find(t => t.id === submittedBounty.taskId);
      if (task) {
        display.innerHTML = `
          <div class="current-task-icon">⏳</div>
          <div class="current-task-name">${escapeHtml(task.name)}</div>
          <div class="current-task-time">等待审核中...</div>
        `;
        return;
      }
    }
  }

  const settlement = getSettlementData();
  const isRated = settlement && settlement.rating;

  if (isRated) {
    const ratingEmoji = { '优': '🌟', '良': '👍', '可': '👌', '差': '💪' };
    display.innerHTML = `
        <div class="current-task-icon">${ratingEmoji[settlement.rating] || '🎉'}</div>
        <div class="current-task-name">今日获得 ${settlement.finalPoints} 积分</div>
        <div class="current-task-time">评级结果：${settlement.rating} · 倍率 x${settlement.multiplier}</div>
      `;
    return;
  }

  const pendingCount = homeworks.filter(h => h.status === 'pending').length;
  if (pendingCount > 0) {
    display.innerHTML = `
        <div class="current-task-icon">📋</div>
        <div class="current-task-name">${pendingCount} 项作业待完成</div>
        <div class="current-task-time">点击作业卡片开始吧！</div>
      `;
  } else if (homeworks.length === 0) {
    display.innerHTML = `
        <div class="current-task-icon">🌟</div>
        <div class="current-task-name">今天没有作业</div>
        <div class="current-task-time">去玩吧！</div>
      `;
  } else {
    display.innerHTML = `
        <div class="current-task-icon">🎉</div>
        <div class="current-task-name">全部完成</div>
        <div class="current-task-time">等待评级中...</div>
      `;
  }
}

function renderActiveHomeworkInCurrentTask(display, hw) {
  const subject = getSubject(hw.subject);
  const now = new Date();
  const elapsedSeconds = hw.paused && hw._pausedElapsed != null
    ? hw._pausedElapsed
    : Math.floor((now - new Date(hw.startedAt)) / 1000);

  let timerHtml = '';
  let progressHtml = '';
  let timerClass = '';

  if (hw.mode === 'challenge') {
    const totalSeconds = hw.suggestedDuration * 60;
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
    const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

    if (remainingSeconds > 0) {
      timerHtml = '倒计时: ' + Util.formatDuration(remainingSeconds);
    } else {
      timerHtml = '超时 ' + Util.formatDuration(elapsedSeconds - totalSeconds);
    }

    let progressBarClass = '';
    let timerClassVal = 'countdown';
    if (progress >= 100) {
      progressBarClass = 'overtime';
      timerClassVal = 'overtime';
    } else if (progress >= 80) {
      progressBarClass = 'warning';
      timerClassVal = 'warning';
    }

    progressHtml = `
      <div class="homework-progress-bar" style="width:100%;max-width:400px;">
        <div class="homework-progress-fill ${progressBarClass}" data-role="ct-pbar" style="width:${progress}%"></div>
      </div>
      <div style="font-size:18px;color:var(--text-secondary);margin:4px 0;" data-role="ct-label">${progress}%</div>
    `;
    timerClass = timerClassVal;
  } else {
    timerHtml = '已用: ' + Util.formatDuration(elapsedSeconds);
    timerClass = 'elapsed';
  }

  display.innerHTML = `
    ${subject.icon ? `<div class="current-task-icon">${subject.icon}</div>` : ''}
    <div class="current-task-name">${escapeHtml(hw.subject)} · ${escapeHtml(hw.content)}</div>
    <div class="homework-timer ${timerClass}" data-role="ct-timer" style="flex-shrink:0;">${timerHtml}</div>
    ${progressHtml}
    <div class="task-actions">
       ${hw.paused
      ? '<button class="btn-resume" onclick="resumeActiveTask()">继 续</button>'
      : (hw.wasPaused ? ''
        : '<button class="btn-pause" onclick="pauseActiveTask()">暂 停</button>')
    }
        <button class="btn-complete" onclick="completeHomework('${hw.id}')">完 成</button>
     </div>
  `;
}

function renderActiveFreeTimeInCurrentTask(display, ft) {
  const now = new Date();
  const startedAt = new Date(ft.startedAt);
  const elapsedSeconds = Math.floor((now - startedAt) / 1000);
  const totalSeconds = ft.durationMinutes * 60;
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

  let timerHtml = '';
  let progressBarClass = '';
  let timerClassVal = 'countdown';

  if (remainingSeconds > 0) {
    timerHtml = '剩余: ' + Util.formatDuration(remainingSeconds);
    if (remainingSeconds < 120) { timerClassVal = 'warning'; progressBarClass = 'warning'; }
  } else {
    timerHtml = '时间到！';
    timerClassVal = 'overtime';
    progressBarClass = 'overtime';
  }

  const progressHtml = `
    <div class="homework-progress-bar" style="width:100%;max-width:400px;">
      <div class="homework-progress-fill ${progressBarClass}" data-role="ct-pbar" style="width:${progress}%"></div>
    </div>
    <div style="font-size:18px;color:var(--text-secondary);margin:4px 0;" data-role="ct-label">${progress}%</div>
  `;

  display.innerHTML = `
    <div class="current-task-icon">🎮</div>
    <div class="current-task-name">${ft.name}</div>
    <div class="homework-timer ${timerClassVal}" data-role="ct-timer" style="flex-shrink:0;">${timerHtml}</div>
    ${progressHtml}
    <div class="task-actions">
       ${ft.paused
      ? '<button class="btn-resume" onclick="resumeActiveTask()">继 续</button>'
      : (ft.wasPaused ? ''
        : '<button class="btn-pause" onclick="pauseActiveTask()">暂 停</button>')
    }
        <button class="btn-complete" onclick="completeFreeTime('${ft.id}')">完 成</button>
     </div>
  `;
}

function updateHomeworkGrid() {
  const grid = document.getElementById('homeworkGrid');
  const card = document.getElementById('homeworkCard');

  const pendingHomeworks = homeworks.filter(h => h.status !== 'done');

  if (pendingHomeworks.length === 0) {

    const dateKey = Util.dateKey(currentDate);
    const bountyTasks = cachedData?.bountyTasks || [];
    const submissions = (cachedData?.bountySubmissions?.[dateKey] || []).filter(s => !s.isDeleted);
    const allCompletions = cachedData?.bountyCompletions || {};

    const historyCounts = {};
    const totalComps = allCompletions._total || {};
    for (const tid of Object.keys(totalComps)) {
      const v = totalComps[tid];
      const delta = typeof v === 'number' ? v : (v ? 1 : 0);
      if (delta > 0) historyCounts[tid] = delta;
    }

    const typeLabel = (t) => ' <span style="font-size:13px;color:var(--text-secondary);">+' + (t.points || 0) + '分 · ' + (t.type === 'once' ? '一次性' : '常驻') + '</span>';
    const bountyEmoji = (t) => t.type === 'once' ? '🪙' : '💰';

    const availableBounty = bountyTasks.filter(task => {
      if (task.enabled === false) return false;
      if (task.type === 'once' && task.completedAt) return false;
      // 常驻型任务：仅当有进行中或待审核的提交时才不可领取（放弃的不算）
      if (task.type !== 'once' && submissions.some(s => s.taskId === task.id && s.status !== 'abandoned')) return false;
      return true;
    });
    const doingSubs = submissions.filter(s => s.status === 'doing');
    const submittedSubs = submissions.filter(s => s.status === 'submitted');

    const bountyCards = [];
    bountyCards.push(...submittedSubs.map(sub => {
      const task = bountyTasks.find(t => t.id === sub.taskId);
      if (!task) return '';
      return '<div class="homework-card" style="border-left:3px solid var(--warning);opacity:0.8;"><div class="homework-card-row"><span style="font-size:28px;flex-shrink:0;">⏳</span><div class="homework-card-info"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:18px;font-weight:600;">' + escapeHtml(task.name) + typeLabel(task) + '</span>' + (historyCounts[task.id] ? '<span style="font-size:18px;font-weight:700;color:var(--accent);">x' + historyCounts[task.id] + '</span>' : '') + '</div><div style="font-size:13px;color:var(--warning);margin-top:2px;">等待审核中...</div></div></div></div>';
    }));
    bountyCards.push(...doingSubs.map(sub => {
      const task = bountyTasks.find(t => t.id === sub.taskId);
      if (!task) return '';
      return '<div class="homework-card" style="border-left:3px solid var(--accent);"><div class="homework-card-row"><span style="font-size:28px;flex-shrink:0;">' + bountyEmoji(task) + '</span><div class="homework-card-info"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:18px;font-weight:600;">' + escapeHtml(task.name) + typeLabel(task) + '</span>' + (historyCounts[task.id] ? '<span style="font-size:18px;font-weight:700;color:var(--accent);">x' + historyCounts[task.id] + '</span>' : '') + '</div><div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">进行中</div></div></div></div>';
    }));
    bountyCards.push(...availableBounty
      .filter(t => !doingSubs.some(s => s.taskId === t.id) && !submittedSubs.some(s => s.taskId === t.id))
      .map(task => {
        return '<div class="homework-card" onclick="confirmStartBounty(\'' + task.id + '\')" style="cursor:pointer;"><div class="homework-card-row"><span style="font-size:28px;flex-shrink:0;">' + bountyEmoji(task) + '</span><div class="homework-card-info"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:18px;font-weight:600;">' + escapeHtml(task.name) + typeLabel(task) + '</span>' + (historyCounts[task.id] ? '<span style="font-size:18px;font-weight:700;color:var(--accent);">x' + historyCounts[task.id] + '</span>' : '') + '</div></div></div></div>';
      }));

    const titleEl = document.querySelector('#homeworkCard .big-card-title');
    if (bountyCards.length > 0) {
      if (titleEl) titleEl.textContent = '💰 赏金任务';
      grid.innerHTML = bountyCards.join('');
    } else {
      if (titleEl) titleEl.textContent = '📝 今日作业';
      grid.innerHTML = '';
    }
    return;
  }

  {
    const titleEl = document.querySelector('#homeworkCard .big-card-title');
    if (titleEl) titleEl.textContent = '📝 今日作业';
  }

  grid.innerHTML = pendingHomeworks.map(hw => {
    const subject = getSubject(hw.subject);
    const isActive = hw.status === 'doing';
    const isDone = hw.status === 'done';
    const statusClass = isDone ? 'completed' : isActive ? 'active' : '';

    let statusText = '';
    let statusClassName = '';
    let rightSection = '';
    let progressHtml = '';

    if (isDone) {
      statusText = '已完成';
      statusClassName = 'done';
      if (hw.actualDuration !== null) {
        statusText += ' · ' + hw.actualDuration + '分钟';
        if (hw.mode === 'challenge' && hw.suggestedDuration > 0) {
          const ratio = hw.suggestedDuration / hw.actualDuration;
          let effText = '';
          if (ratio >= 1.25) effText = '效率优秀';
          else if (ratio >= 1.0) effText = '效率良好';
          else effText = '略微超时';
          statusText += ' · ' + effText;
        }
      }
      progressHtml = '<div class="homework-progress-bar"><div class="homework-progress-fill" style="width:100%;background:var(--success);"></div></div>';
      rightSection = '<div class="homework-status ' + statusClassName + '">' + statusText + '</div>';

    } else if (isActive) {
      statusText = '进行中';
      statusClassName = 'doing';

      const now = new Date();
      const elapsedSeconds = hw.paused && hw._pausedElapsed != null
        ? hw._pausedElapsed
        : Math.floor((now - new Date(hw.startedAt)) / 1000);

      if (hw.mode === 'challenge') {
        const totalSeconds = hw.suggestedDuration * 60;
        const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
        const progress = Math.min(100, Math.round(elapsedSeconds / totalSeconds * 100));

        let timerClass = 'countdown';
        let pbarClass = '';
        let label = '';

        if (remainingSeconds > 0) {
          label = '剩余 ' + Util.formatDuration(remainingSeconds);
        } else {
          label = '超时 ' + Util.formatDuration(elapsedSeconds - totalSeconds);
          timerClass = 'overtime';
          pbarClass = 'overtime';
        }
        if (progress >= 80 && remainingSeconds > 0) {
          pbarClass = 'warning';
          timerClass = 'warning';
        }

        rightSection = '<div style="text-align:right;flex-shrink:0;">' +
          '<div class="homework-timer ' + timerClass + '" data-role="hw-timer">' + label + '</div>' +
          '<div class="homework-status ' + statusClassName + '" data-role="hw-status" style="margin-top:2px;">' + statusText + '</div>' +
          '</div>';

        progressHtml = '<div class="homework-progress-bar">' +
          '<div class="homework-progress-fill ' + pbarClass + '" data-role="hw-pbar" style="width:' + progress + '%"></div>' +
          '</div>';
      } else {
        rightSection = '<div style="text-align:right;flex-shrink:0;">' +
          '<div class="homework-timer elapsed" data-role="hw-timer">已用 ' + Util.formatDuration(elapsedSeconds) + '</div>' +
          '<div class="homework-status ' + statusClassName + '" data-role="hw-status" style="margin-top:2px;">' + statusText + '</div>' +
          '</div>';
      }
    } else if (hw.deferRequest && hw.deferRequest.status === 'pending') {
      statusText = '⏳ 等待确认...';
      statusClassName = 'deferred';

      rightSection = '<div class="homework-status ' + statusClassName + '" style="flex-shrink:0;">' + statusText + '</div>';

      if (hw.mode === 'challenge') {
        rightSection = '<div style="text-align:right;flex-shrink:0;">' +
          '<div class="homework-timer" style="color:var(--accent);font-weight:600;font-size:16px;">' + hw.suggestedDuration + '分钟</div>' +
          '<div class="homework-status ' + statusClassName + '" style="margin-top:2px;">' + statusText + '</div>' +
          '</div>';
        progressHtml = '<div class="homework-progress-bar">' +
          '<div class="homework-progress-fill" style="width:0%;background:var(--warning);opacity:0.3;"></div>' +
          '</div>';
      }
    } else {
      statusText = hw.rejected ? '被驳回' : '未开始';
      statusClassName = hw.rejected ? 'rejected' : 'pending';

      rightSection = '<div class="homework-status ' + statusClassName + '" style="flex-shrink:0;">' + statusText + '</div>';

      if (hw.mode === 'challenge' && !hw.rejected) {
        rightSection = '<div style="text-align:right;flex-shrink:0;">' +
          '<div class="homework-timer" style="color:var(--accent);font-weight:600;font-size:16px;">' + hw.suggestedDuration + '分钟</div>' +
          '<div class="homework-status ' + statusClassName + '" style="margin-top:2px;">' + statusText + '</div>' +
          '</div>';
        progressHtml = '<div class="homework-progress-bar">' +
          '<div class="homework-progress-fill" style="width:0%;background:var(--accent);opacity:0.3;"></div>' +
          '</div>';
      }
    }

    const bpText = ' · ' + (hw.basePoints ?? 10) + '奖励分';
    const modeLabel = hw.rejected ? '⏱️ 不计时' + bpText : ('⚔️ ' + (hw.suggestedDuration || 0) + '分钟' + bpText);
    const clickAction = isDone ? '' : isActive ? '' : (hw.deferRequest && hw.deferRequest.status === 'pending') ? '' : `onclick="confirmStartTask('${hw.id}')"`;

    return `
      <div class="homework-card ${statusClass} ${isDone && hw._animClass ? hw._animClass : ''}" data-hw-id="${hw.id}" ${clickAction}>
        <div class="homework-card-row">
          ${subject.icon ? `<span style="font-size:28px;flex-shrink:0;">${subject.icon}</span>` : ''}
          <div class="homework-card-info">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:18px;font-weight:600;">${escapeHtml(hw.subject)}</span>
              <span style="font-size:12px;color:var(--text-secondary);">${modeLabel}</span>
            </div>
            <div style="font-size:15px;color:var(--text-secondary);">${escapeHtml(hw.content)}</div>
          </div>
          ${rightSection}
        </div>
        ${progressHtml}
      </div>
    `;
  }).join('');

  homeworks.forEach(h => { if (h._animClass) delete h._animClass; });
}

function updateFreeTimeGrid() {
  const card = document.getElementById('freeTimeCard');
  const grid = document.getElementById('freeTimeGrid');
  if (!card || !grid) return;

  const pendingFreeTime = freeTimeTasks.filter(ft => ft.status !== 'done');

  if (pendingFreeTime.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';

  grid.innerHTML = pendingFreeTime.map(ft => {
    const isActive = ft.status === 'doing';
    const isDone = ft.status === 'done';
    const statusClass = isDone ? 'completed' : isActive ? 'active' : '';

    let rightSection = '';
    let progressHtml = '';

    if (isDone) {
      progressHtml = '<div class="homework-progress-bar"><div class="homework-progress-fill" style="width:100%;background:var(--success);"></div></div>';
      rightSection = '<div class="homework-status done">已完成</div>';
    } else if (isActive) {
      const now = new Date();
      const startedAt = new Date(ft.startedAt);
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      const remainingSeconds = Math.max(0, ft.durationMinutes * 60 - elapsedSeconds);
      const progress = Math.min(100, Math.round(elapsedSeconds / (ft.durationMinutes * 60) * 100));

      let tcls = 'countdown';
      let pcls = '';
      let label = '';
      if (remainingSeconds > 0) {
        label = '剩余 ' + Util.formatDuration(remainingSeconds);
        if (remainingSeconds < 120) { tcls = 'warning'; pcls = ' warning'; }
      } else {
        label = '时间到！';
        tcls = 'overtime';
        pcls = ' overtime';
      }

      rightSection = '<div style="text-align:right;flex-shrink:0;">' +
        '<div class="homework-timer ' + tcls + '" data-role="ft-timer">' + label + '</div>' +
        '<div class="homework-status doing" style="margin-top:2px;">进行中</div>' +
        '</div>';

      progressHtml = '<div class="homework-progress-bar">' +
        '<div class="homework-progress-fill' + pcls + '" data-role="ft-pbar" style="width:' + progress + '%"></div>' +
        '</div>';
    } else {
      rightSection = '<div style="text-align:right;flex-shrink:0;">' +
        '<div class="homework-timer" style="color:var(--accent);font-size:16px;">' + ft.durationMinutes + '分钟</div>' +
        '<div class="homework-status pending" style="margin-top:2px;">未开始</div>' +
        '</div>';
      progressHtml = '<div class="homework-progress-bar">' +
        '<div class="homework-progress-fill" style="width:0%;background:var(--accent);opacity:0.3;"></div>' +
        '</div>';
    }

    const clickAction = isDone ? '' : isActive ? '' : `onclick="confirmStartFreeTime('${ft.id}')"`;

    return `
      <div class="homework-card ${statusClass}" data-ft-id="${ft.id}" ${clickAction}>
        <div class="homework-card-row">
          <span style="font-size:28px;flex-shrink:0;">🎮</span>
          <div class="homework-card-info">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:18px;font-weight:600;">${ft.name}</span>
              <span style="font-size:12px;color:var(--text-secondary);">⏱️ ${ft.durationMinutes}分钟</span>
            </div>
          </div>
          ${rightSection}
        </div>
        ${progressHtml}
      </div>
    `;
  }).join('');
}

async function startBountyTask(taskId) {
  if (_startingBounty) return;
  if (!guardOnline()) return;
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }
  _startingBounty = true;
  try {
    const dateKey = Util.dateKey(currentDate);
    const submissions = await API.getBountySubmissions(dateKey) || [];
    // 检查是否已有进行中或待审核的提交（放弃的可以重新开始）
    const existingAbandoned = submissions.find(s => s.taskId === taskId && s.status === 'abandoned');
    if (existingAbandoned) {
      // 复用已放弃的提交，恢复为进行中
      existingAbandoned.status = 'doing';
      existingAbandoned.startedAt = new Date().toISOString();
      existingAbandoned.submittedAt = null;
      await API.putBountySubmission(existingAbandoned.id, existingAbandoned);
      if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
      cachedData.bountySubmissions[dateKey] = submissions;
      const task = (cachedData?.bountyTasks || []).find(t => t.id === taskId);
      Voice.clear();
      Voice.speak('开始' + (task ? task.name : '') + '！');
      needsFullRender = true;
      updateBigScreen();
      return;
    }
    // 存在非 abandoned 状态的提交时阻止重复创建（abandoned 已在上面被复用处理）
    if (submissions.some(s => s.taskId === taskId && s.status !== 'abandoned')) return;
    const newSubmission = { id: Util.genId(), taskId, status: 'doing', startedAt: new Date().toISOString(), submittedAt: null };
    submissions.push(newSubmission);
    await API.putBountySubmission(newSubmission.id, newSubmission);
    if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
    cachedData.bountySubmissions[dateKey] = submissions;
    const task = (cachedData?.bountyTasks || []).find(t => t.id === taskId);
    Voice.clear();
    Voice.speak('开始' + (task ? task.name : '') + '！');
    needsFullRender = true;
    updateBigScreen();
  } finally {
    _startingBounty = false;
  }
}

async function abandonBountyTask(taskId) {
  if (_submittingBounty) return;
  if (!guardOnline()) return;
  _submittingBounty = true;
  try {
    const dateKey = Util.dateKey(currentDate);
    const submissions = await API.getBountySubmissions(dateKey) || [];
    const sub = submissions.find(s => s.taskId === taskId);
    if (!sub) {
      console.warn('abandonBountyTask: submission not found for taskId', taskId);
      showToast('未找到任务记录，请刷新后重试');
      return;
    }
    sub.status = 'abandoned';
    await API.putBountySubmission(sub.id, sub);
    if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
    cachedData.bountySubmissions[dateKey] = submissions;
    needsFullRender = true;
    updateBigScreen();
  } finally {
    _submittingBounty = false;
  }
}

async function submitBountyTask(taskId) {
  if (_submittingBounty) return;
  _submittingBounty = true;
  try {
    const dateKey = Util.dateKey(currentDate);
    const submissions = await API.getBountySubmissions(dateKey) || [];
    const sub = submissions.find(s => s.taskId === taskId);
    if (!sub || sub.status !== 'doing') {
      console.warn('submitBountyTask: submission not found for taskId', taskId, 'sub:', sub);
      if (!sub) showToast('未找到任务记录，请刷新后重试');
      return;
    }
    sub.status = 'submitted';
    sub.submittedAt = new Date().toISOString();
    await API.putBountySubmission(sub.id, sub);
    if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
    cachedData.bountySubmissions[dateKey] = submissions;
    Voice.clear();
    Voice.speak('已提交');
    needsFullRender = true;
    updateBigScreen();
    showToast('赏金任务已完成');
    if (typeof backToMain === 'function') backToMain();
  } finally {
    _submittingBounty = false;
  }
}

// ========== Settlement Page ==========
function updateSettlementPage() {
  currentPage = PAGE.SETTLEMENT;
  document.getElementById('bigHeader').style.display = 'none';
  document.getElementById('bigContent').style.display = 'none';
  document.getElementById('bigStats').style.display = 'none';
  document.getElementById('shopContainer').style.display = 'none';
  document.getElementById('ratedContainer').style.display = 'none';

  const settlement = window._settlement || { basePoints: 0, efficiencyBonus: 0, totalBeforeRating: 0 };
  const container = document.getElementById('settlementContainer');
  container.style.display = 'flex';

  const settlementData = getSettlementData();
  const isSubmitted = settlementData && settlementData.submittedAt;
  const isRated = settlementData && settlementData.rating;

  if (isRated) {
    updateRatedPage();
    return;
  }

  container.innerHTML = `
    <div class="settlement-card">
      <div class="settlement-title">全部作业完成！</div>
      <div class="settlement-summary">
        <div class="settlement-item">
          <span>每日基础分</span>
          <span class="settlement-val">+${settlement.dailyBase}</span>
        </div>
        <div class="settlement-item">
          <span>挑战奖励 (${settlement.doneCount}项作业)</span>
          <span class="settlement-val">+${settlement.homeworkBonus}</span>
        </div>
        <div class="settlement-item total">
          <span>待结算</span>
          <span class="settlement-val">${settlement.totalBeforeRating} 分</span>
        </div>
      </div>
      ${isSubmitted
      ? '<div class="settlement-waiting">作业已提交，等待评级...</div><div class="settlement-spinner"></div>'
      : '<button class="btn-submit-rating" onclick="submitForRating()">提交等待评级</button>'
    }
      <div class="settlement-homeworks">
        ${homeworks.filter(h => h.status === 'done').map(hw => {
      const subject = getSubject(hw.subject);
      let timeInfo = '';
      if (hw.mode === 'challenge' && hw.actualDuration !== null) {
        const icon = hw.actualDuration <= hw.suggestedDuration * 0.8 ? '提前' :
          hw.actualDuration <= hw.suggestedDuration ? '准时' : '超时';
        timeInfo = `${hw.actualDuration}/${hw.suggestedDuration}分钟 ${icon}`;
      } else if (hw.actualDuration !== null) {
        timeInfo = `${hw.actualDuration}分钟`;
      }
      const iconHtml = subject.icon ? subject.icon + ' ' : '';
      return '<div class="settlement-hw-item">' + iconHtml + escapeHtml(hw.subject) + ' - ' + escapeHtml(hw.content) + ' ' + timeInfo + '</div>';
    }).join('')}
      </div>
    </div >
    `;
}

// ========== Rated Page ==========
function updateRatedPage() {
  currentPage = PAGE.RATED;
  document.getElementById('bigHeader').style.display = 'none';
  document.getElementById('bigContent').style.display = 'none';
  document.getElementById('bigStats').style.display = 'none';
  document.getElementById('settlementContainer').style.display = 'none';
  document.getElementById('shopContainer').style.display = 'none';

  const settlement = getSettlementData();
  if (!settlement || !settlement.rating) return;

  const container = document.getElementById('ratedContainer');
  container.style.display = 'flex';

  const encouragement = {
    '优': '太棒了！继续保持！',
    '良': '做得不错，下次争取更优秀！',
    '可': '继续加油，你可以做得更好！',
    '差': '别灰心，明天重新开始！'
  };

  container.innerHTML = `
    <div class="settlement-card">
      <div class="settlement-title">评级已完成</div>
      <div class="rated-grade">${settlement.rating}</div>
      <div class="rated-multiplier">倍率 x${settlement.multiplier}</div>
      <div class="settlement-summary">
        <div class="settlement-item">
          <span>每日基础分 + 挑战奖励</span>
          <span class="settlement-val">${settlement.totalBeforeRating}</span>
        </div>
        <div class="settlement-item">
          <span>评级倍率</span>
          <span class="settlement-val">x${settlement.multiplier}</span>
        </div>
        <div class="settlement-item total">
          <span>最终积分</span>
          <span class="settlement-val" style="font-size:40px;">${settlement.finalPoints}</span>
        </div>
      </div>
      <div class="rated-encouragement">${encouragement[settlement.rating] || ''}</div>
      <button class="btn-submit-rating" onclick="backToMain()" style="margin-top:16px;margin-bottom:0;background:var(--bg);color:var(--text);border:1px solid var(--text-secondary);">← 回到首页</button>
    </div >
    `;
}

// ========== My Rewards ==========
function showMyRewards() {
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }
  const overlay = document.getElementById('myRewardsOverlay');
  const content = document.getElementById('myRewardsContent');
  const rewardBox = cachedData?.rewardBox || [];
  const redemptions = cachedData?.redemptions || [];
  const now = Date.now();
  const sorted = [...rewardBox].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // 保存滚动位置，防止重建 DOM 时回弹
  const card = overlay.querySelector('.my-rewards-card');
  const savedScrollTop = card ? card.scrollTop : 0;

  if (sorted.length === 0) {
    content.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:18px;">你还没有获得奖励，<br>快去获取积分兑换吧！</div>';
  } else {
    const available = sorted.filter(r => (r.quantity || 0) > 0);
    if (available.length === 0) {
      content.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:18px;">你还没有获得奖励，<br>快去获取积分兑换吧！</div>';
    } else {
      content.innerHTML = available.map(r => {
        const qty = r.quantity || 0;
        const pendingR = redemptions.find(rd => rd.rewardBoxItemId === r.id && rd.status === 'pending');
        const metaStr = r.type === 'time'
          ? (r.durationMinutes || 0) + '分钟'
          : r.type === 'buff'
            ? (r.buffDuration ?? 0) + (r.buffUnit === 'minutes' ? '分钟' : '天')
            : '';
        const isNew = (r.createdAt && now - r.createdAt < 86400000) || (window._recentNewRewardIds && window._recentNewRewardIds.has(r.id));
        return `
    <div class="reward-item">
          <div class="reward-item-info">
            <div class="reward-item-name">${r.name}${isNew ? ' <span class="new-badge">NEW</span>' : ''}</div>
            <div class="reward-item-meta">${metaStr}</div>
          </div>
          <span class="reward-qty">× ${qty}</span>
          ${pendingR
            ? `<span style="font-size:12px;color:var(--warning);font-weight:600;">已提交</span>
               <button onclick="cancelRedemption('${pendingR.id}')" style="padding:8px 16px;font-size:14px;border-radius:8px;border:1px solid var(--text-secondary);background:transparent;color:var(--text-secondary);cursor:pointer;">撤回</button>`
            : `<button class="btn-redeem-sm" onclick="redeemFromRewardBox('${r.id}')">兑换</button>`
          }
        </div >
    `;
      }).join('');
    }
  }

  // 恢复滚动位置
  const newCard = overlay.querySelector('.my-rewards-card');
  if (newCard && savedScrollTop > 0) {
    newCard.scrollTop = savedScrollTop;
  }

  overlay.style.display = 'flex';
}

function hideMyRewards() {
  document.getElementById('myRewardsOverlay').style.display = 'none';
}

async function redeemFromRewardBox(itemId) {
  if (_redeemingRewardBox) return;
  if (!guardOnline()) return;
  const rewardBox = cachedData?.rewardBox || [];
  const item = rewardBox.find(i => i.id === itemId);
  if (!item || (item.quantity || 0) <= 0) {
    showToast('已用光');
    return;
  }

  const redemptions = cachedData?.redemptions || [];
  const alreadyPending = redemptions.find(rd => rd.rewardBoxItemId === itemId && rd.status === 'pending');
  if (alreadyPending) {
    showToast('已提交过，等待确认');
    return;
  }

  _redeemingRewardBox = true;
  try {
    const newRedemption = {
      id: Util.genId(),
      itemName: item.name,
      itemType: item.type || 'item',
      durationMinutes: item.durationMinutes || 0,
      buffDuration: item.buffDuration ?? 0,
      buffUnit: item.buffUnit || '',
      points: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      fromRewardBox: true,
      rewardBoxItemId: item.id,
    };
    redemptions.push(newRedemption);
    await API.putRedemption(newRedemption.id, newRedemption);

    cachedData = await API.getData();
    showMyRewards();
    showToast('已提交，等待确认');
    Voice.speak('已提交申请，等待确认');
  } finally {
    _redeemingRewardBox = false;
  }
}

async function cancelRedemption(redemptionId) {
  if (_redeemingRewardBox) return;
  if (!guardOnline()) return;
  _redeemingRewardBox = true;
  try {
    const redemptions = cachedData?.redemptions || [];
    const r = redemptions.find(r => r.id === redemptionId);
    if (!r || r.status !== 'pending') {
      showToast('无法撤回');
      return;
    }

    r.status = 'cancelled';
    await API.putRedemption(r.id, r);

    if (!r.fromRewardBox) {
      const shopItems = cachedData?.shopItems || [];
      const shopItem = shopItems.find(si => si.name === r.itemName);
      if (shopItem) {
        shopItem.remainingQuantity = (shopItem.remainingQuantity ?? 0) + 1;
        await API.putShopItem(shopItem.id, shopItem);
      }

      await API.updatePoints('earn', r.points, '撤回兑换：' + r.itemName);
    }

    cachedData = await API.getData();
    showMyRewards();
    showToast('已撤回');
  } finally {
    _redeemingRewardBox = false;
  }
}

// ========== Shop Page ==========
function showShopPage() {
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }
  currentPage = PAGE.SHOP;
  updateShopPage();
}

async function updateShopPage() {
  const container = document.getElementById('shopContainer');
  container.style.display = 'flex';

  // 保存滚动位置，防止轮询重建 DOM 时回弹
  const oldGrid = container.querySelector('.shop-grid');
  const savedScrollTop = oldGrid ? oldGrid.scrollTop : 0;

  const shopItems = cachedData?.shopItems || [];
  const points = cachedData?.points?.balance ?? cachedData?.points ?? 0;
  const sorted = [...shopItems].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const now = Date.now();

  container.innerHTML = `
    <div class="shop-card">
      <div class="settlement-title">积分商店</div>
      <div class="shop-balance">余额: ${points}</div>
      <div class="shop-grid">
        ${sorted.length === 0
      ? '<div style="text-align:center;color:var(--text-secondary);padding:40px;font-size:20px;">商店暂无商品<br>敬请期待</div>'
      : sorted.map(item => {
        const remaining = item.remainingQuantity ?? 0;
        const soldOut = remaining <= 0;
        const isNew = item.createdAt && (now - item.createdAt < 86400000);
        return `
            <div class="shop-item-card${soldOut ? ' sold-out' : ''}">
              ${isNew ? '<span class="new-badge">NEW</span>' : ''}
              <div class="shop-item-icon">${item.type === 'time' ? '⏱️' : item.type === 'buff' ? '✨' : '🎁'}</div>
              <div class="shop-item-name">${item.name}</div>
              <div class="shop-item-points">${item.points} 积分 · 剩${remaining}件</div>
              <button class="btn-shop-redeem" ${points < item.points || soldOut ? 'disabled' : ''}
                onclick="redeemItem('${item.id}')">
                ${soldOut ? '已卖光' : '兑 换'}
              </button>
            </div>
          `}).join('')}
      </div>
      <button class="btn-cancel" style="margin-top:20px;padding:14px 24px;border:none;border-radius:14px;font-size:20px;font-weight:600;cursor:pointer;background:var(--bg);color:var(--text);" onclick="backToMain()">返回</button>
    </div >
    `;

  // 恢复滚动位置
  const newGrid = container.querySelector('.shop-grid');
  if (newGrid && savedScrollTop > 0) {
    newGrid.scrollTop = savedScrollTop;
  }
}

async function redeemItem(itemId) {
  if (_redeemingItem) return;
  if (!guardOnline()) return;
  const items = cachedData?.shopItems || [];
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  const points = cachedData?.points?.balance ?? cachedData?.points ?? 0;
  if (points < item.points) {
    showToast('积分不足');
    return;
  }

  const remaining = item.remainingQuantity ?? 0;
  if (remaining <= 0) {
    showToast('今日已售罄');
    return;
  }

  _redeemingItem = true;
  try {
    item.remainingQuantity = remaining - 1;
    await API.putShopItem(item.id, item);

    const rewardBox = cachedData?.rewardBox || [];
    const existing = rewardBox.find(rb => rb.name === item.name);
    if (existing) {
      existing.quantity = (existing.quantity || 0) + 1;
      await API.putRewardBoxItem(existing.id, existing);
    } else {
      const newItem = {
        id: Util.genId(),
        name: item.name,
        type: item.type || 'item',
        durationMinutes: item.durationMinutes || 0,
        buffDuration: item.buffDuration ?? 0,
        buffUnit: item.buffUnit || '',
        quantity: 1,
      };
      rewardBox.push(newItem);
      await API.putRewardBoxItem(newItem.id, newItem);
    }

    await API.updatePoints('spend', item.points, '兑换：' + item.name);

    cachedData = await API.getData();
    updateShopPage();
    showToast('兑换成功！');
    Voice.speak('兑换成功！');
  } finally {
    _redeemingItem = false;
  }
}

async function backToMain() {
  // If coming from rated page, mark as viewed
  if (currentPage === PAGE.RATED) {
    const settlement = getSettlementData();
    if (settlement && settlement.rating && !settlement.viewedAt) {
      settlement.viewedAt = Util.nowTimeStr();
      const dateKey = Util.dateKey(currentDate);
      if (isServerMode) {
        await API.putSettlement(dateKey, settlement);
      }
    }
  }

  forceMainPage = true;
  currentPage = PAGE.MAIN;
  document.getElementById('shopContainer').style.display = 'none';
  needsFullRender = true;
  updateBigScreen();
}

// ========== Start Confirm Modal ==========
function confirmStartTask(hwId) {
  const hw = homeworks.find(h => h.id === hwId);
  if (!hw) return;

  const subject = getSubject(hw.subject);
  const modal = document.getElementById('startConfirmModal');
  const content = document.getElementById('startConfirmModalContent');

  if (hw.rejected) {
    content.innerHTML = `
    <h3 style="text-align:center;margin-bottom:8px;font-size:32px;">${subject.icon ? subject.icon + ' ' : ''}${escapeHtml(hw.subject)}</h3>
      <p style="text-align:center;color:var(--text-secondary);margin-bottom:4px;font-size:20px;">${escapeHtml(hw.content)}</p>
      <p style="text-align:center;color:#f87171;font-size:20px;margin-bottom:16px;">⚠️ 已驳回，不计时重新完成</p>
      <div class="modal-actions">
        <button onclick="closeStartConfirm()" style="padding:10px 16px;border:2px solid var(--text-secondary);border-radius:12px;background:transparent;color:var(--text-secondary);font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">✕ 取消</button>
        <button onclick="closeStartConfirm(); startHomework('${hwId}', 'timer')" style="padding:10px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">开始</button>
      </div>
  `;
  } else {
    const canDefer = !hw.deferRequest && isTomorrowHoliday();
    const deferBtn = canDefer
      ? '<button onclick="closeStartConfirm(); requestDeferHomework(\'' + hwId + '\')" style="padding:10px 16px;border:2px solid var(--warning);border-radius:12px;background:transparent;color:var(--warning);font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">⏭️ 明天做</button>'
      : '';
    content.innerHTML = `
    <h3 style="text-align:center;margin-bottom:8px;font-size:32px;">${subject.icon ? subject.icon + ' ' : ''}${escapeHtml(hw.subject)}</h3>
      <p style="text-align:center;color:var(--text-secondary);margin-bottom:4px;font-size:20px;">${escapeHtml(hw.content)}</p>
      <p style="text-align:center;color:var(--accent);font-size:20px;margin-bottom:16px;">建议 ${hw.suggestedDuration} 分钟内完成</p>
      <div class="modal-actions">
        <button onclick="closeStartConfirm()" style="padding:10px 16px;border:2px solid var(--text-secondary);border-radius:12px;background:transparent;color:var(--text-secondary);font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">✕ 取消</button>
        ${deferBtn}
        <button onclick="closeStartConfirm(); startHomework('${hwId}', 'challenge')" style="padding:10px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">⚔️ 开始</button>
      </div>
      <button onclick="closeStartConfirm(); completeInSchool('${hwId}')" style="display:block;margin:10px auto 0;padding:8px 20px;border:none;border-radius:10px;background:#27ae60;color:#fff;font-size:14px;cursor:pointer;">🏫 在校提前完成</button>
  `;
  }
  modal.classList.add('show');
}

function confirmStartBounty(taskId) {
  const bt = cachedData?.bountyTasks || [];
  const task = bt.find(t => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('startConfirmModal');
  const content = document.getElementById('startConfirmModalContent');

  content.innerHTML = `
    <h3 style="text-align:center;margin-bottom:8px;font-size:32px;">${task.type === 'once' ? '🪙' : '💰'} 赏金任务</h3>
    <p style="text-align:center;color:var(--text-secondary);margin-bottom:4px;font-size:20px;">${escapeHtml(task.name)}</p>
    <p style="text-align:center;color:var(--accent);font-size:20px;margin-bottom:16px;">+${task.points || 0} 分 · 不限时</p>
    <div class="modal-actions">
      <button onclick="closeStartConfirm()" style="padding:10px 16px;border:2px solid var(--text-secondary);border-radius:12px;background:transparent;color:var(--text-secondary);font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">✕ 取消</button>
      <button onclick="closeStartConfirm(); startBountyTask('${taskId}')" style="padding:10px 16px;background:var(--success);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">💰 开始</button>
    </div>
  `;
  modal.classList.add('show');
}

function confirmStartFreeTime(ftId) {
  const ft = freeTimeTasks.find(t => t.id === ftId);
  if (!ft) return;

  const modal = document.getElementById('startConfirmModal');
  const content = document.getElementById('startConfirmModalContent');

  content.innerHTML = `
    <h3 style="text-align:center;margin-bottom:8px;font-size:32px;">🎮 奖励时间</h3>
    <p style="text-align:center;color:var(--text-secondary);margin-bottom:4px;font-size:20px;">${ft.name}</p>
    <p style="text-align:center;color:var(--accent);font-size:20px;margin-bottom:16px;">${ft.durationMinutes} 分钟</p>
    <div class="modal-actions">
      <button onclick="closeStartConfirm()" style="padding:10px 16px;border:2px solid var(--text-secondary);border-radius:12px;background:transparent;color:var(--text-secondary);font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">✕ 取消</button>
      <button onclick="closeStartConfirm(); startFreeTime('${ftId}')" style="padding:10px 16px;background:var(--accent);color:var(--bg);border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:80px;">🎮 开始</button>
    </div>
  `;
  modal.classList.add('show');
}

function closeStartConfirm() {
  document.getElementById('startConfirmModal').classList.remove('show');
}

// ========== Stats ==========
function updateStats() {
  const completedHw = homeworks.filter(h => h.status === 'done').length;
  document.getElementById('homeworkProgress').textContent = `${completedHw}/${homeworks.length}`;

  const points = cachedData?.points?.balance ?? cachedData?.points ?? 0;
  document.getElementById('totalPoints').textContent = points;
}
