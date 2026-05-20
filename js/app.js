/**
 * app.js - 应用主逻辑
 * 负责初始化、作业计时、屏保、语音、Toast、积分结算
 */

// ========== State ==========
let currentDate = new Date();
let homeworks = [];
let freeTimeTasks = [];
let screenSaverTimer = null;
let isScreenSaverActive = false;
let saverTimeInterval = null;
let tickInterval = null;

// ========== Utility ==========
const Util = {
  genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  },

  dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  formatDate(d) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
  },

  formatDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m === 0) return s + '秒';
    if (s === 0) return m + '分钟';
    return m + '分' + s + '秒';
  },

  nowTimeStr() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  },
};

// ========== Voice ==========
const Voice = {
  speak(text) {
    // Voice disabled
  },
};

// ========== Toast ==========
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ========== Homework Timer & Status ==========
function getActiveHomework() {
  return homeworks.find(h => h.status === 'doing');
}

function getActiveFreeTime() {
  return freeTimeTasks.find(ft => ft.status === 'doing');
}

function isAnyTaskActive() {
  return getActiveHomework() || getActiveFreeTime();
}

function startHomework(id, mode) {
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }

  const hw = homeworks.find(h => h.id === id);
  if (!hw || hw.status !== 'pending') return;

  hw.mode = hw.rejected ? 'timer' : (mode || 'timer');
  hw.status = 'doing';
  hw.startedAt = new Date().toISOString();
  saveHomeworksSilent();

  if (mode === 'challenge') {
    Voice.speak('开始' + hw.subject + '作业，挑战' + hw.suggestedDuration + '分钟');
  } else {
    Voice.speak('开始' + hw.subject + '作业');
  }

  startTickTimer();
  needsFullRender = true;
  updateBigScreen();
}

async function completeHomework(id) {
  const hw = homeworks.find(h => h.id === id);
  if (!hw || hw.status !== 'doing') return;

  const completedAt = new Date();
  const startedAt = new Date(hw.startedAt);
  const actualDuration = Math.max(1, Math.round((completedAt - startedAt) / 60000));

  hw.status = 'done';
  hw.completedAt = completedAt.toISOString();
  hw.actualDuration = actualDuration;

  let toastMsg;
  if (hw.mode === 'challenge' && hw.suggestedDuration > 0 && actualDuration > hw.suggestedDuration) {
    hw.mode = 'timer';
    hw._animClass = 'task-complete';
    toastMsg = '✅ ' + hw.subject + '完成';
  } else if (hw.mode === 'challenge') {
    hw._animClass = 'challenge-success';
    toastMsg = '⚡ 挑战成功！' + hw.subject + '提前完成';
  } else {
    hw._animClass = 'task-complete';
    toastMsg = '✅ ' + hw.subject + '完成';
  }

  stopTickTimer();
  Voice.speak(hw.subject + '作业完成！');
  await saveHomeworksSilent();

  checkAllDone();
  needsFullRender = true;
  updateBigScreen();
  showToast(toastMsg);
}

async function saveHomeworksSilent() {
  await API.saveHomeworks(Util.dateKey(currentDate), homeworks);
}

async function saveFreeTimeSilent() {
  await API.saveFreeTime(Util.dateKey(currentDate), freeTimeTasks);
}

function startFreeTime(id) {
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }

  const ft = freeTimeTasks.find(t => t.id === id);
  if (!ft || ft.status !== 'pending') return;

  ft.status = 'doing';
  ft.startedAt = new Date().toISOString();
  ft.remainingSeconds = ft.durationMinutes * 60;
  saveFreeTimeSilent();

  Voice.speak('开始' + ft.name + '，' + ft.durationMinutes + '分钟');
  startTickTimer();
  needsFullRender = true;
  updateBigScreen();
}

function completeFreeTime(id) {
  const ft = freeTimeTasks.find(t => t.id === id);
  if (!ft || ft.status !== 'doing') return;

  ft.status = 'done';
  ft.completedAt = new Date().toISOString();
  ft.remainingSeconds = 0;

  stopTickTimer();
  Voice.speak(ft.name + '时间到！');
  saveFreeTimeSilent();
  needsFullRender = true;
  updateBigScreen();
}

function pauseActiveTask() {
  const task = getActiveHomework() || getActiveFreeTime();
  if (!task || task.paused) return;
  task.paused = true;
  task.wasPaused = true;
  stopTickTimer();
  if (task.startedAt && task.status === 'doing') {
    task._pausedElapsed = Math.floor((new Date() - new Date(task.startedAt)) / 1000);
  }
  if (task.subject) saveHomeworksSilent();
  else saveFreeTimeSilent();
  needsFullRender = true;
  updateBigScreen();
}

function resumeActiveTask() {
  const task = getActiveHomework() || getActiveFreeTime();
  if (!task || !task.paused) return;
  task.paused = false;
  if (task._pausedElapsed) {
    const pausedSeconds = task._pausedElapsed;
    task.startedAt = new Date(new Date() - pausedSeconds * 1000).toISOString();
    delete task._pausedElapsed;
  }
  if (task.subject) saveHomeworksSilent();
  else saveFreeTimeSilent();
  startTickTimer();
  needsFullRender = true;
  updateBigScreen();
}

function isAnyTaskPaused() {
  const task = getActiveHomework() || getActiveFreeTime();
  return task && task.paused;
}

function startTickTimer() {
  stopTickTimer();
  tickInterval = setInterval(() => tickFrame(), 1000);
}

function stopTickTimer() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ========== Timer Reminders (Challenge mode) ==========
let lastReminderTrigger = {};

function checkReminders(hw) {
  if (hw.mode !== 'challenge' || hw.status !== 'doing' || !hw.startedAt) return;

  const startedAt = new Date(hw.startedAt);
  const elapsedSeconds = Math.floor((new Date() - startedAt) / 1000);
  const totalSeconds = hw.suggestedDuration * 60;

  const key = hw.id;
  if (!lastReminderTrigger[key]) lastReminderTrigger[key] = {};

  if (!lastReminderTrigger[key].half && elapsedSeconds >= totalSeconds * 0.5) {
    lastReminderTrigger[key].half = true;
    Voice.speak('已用' + hw.suggestedDuration / 2 + '分钟，继续加油');
  }

  if (!lastReminderTrigger[key].twoMin && totalSeconds - elapsedSeconds <= 120 && elapsedSeconds < totalSeconds) {
    lastReminderTrigger[key].twoMin = true;
    Voice.speak('还有2分钟，准备收尾');
  }

  if (!lastReminderTrigger[key].overtime && elapsedSeconds > totalSeconds) {
    lastReminderTrigger[key].overtime = true;
    Voice.speak('已超时，尽快完成');
  }
}

// ========== Settlement ==========
async function checkAllDone() {
  if (homeworks.length === 0) return;
  const allDone = homeworks.every(h => h.status === 'done');
  if (allDone) {
    await calculateSettlement();
  }
}

async function calculateSettlement() {
  const challengeHw = homeworks.filter(h => h.mode === 'challenge' && h.status === 'done' && !h.rejected);

  const basePoints = homeworks.filter(h => h.status === 'done').length * 10;
  let efficiencyBonus = 0;
  const ratios = [];

  challengeHw.forEach(hw => {
    if (hw.actualDuration !== null && hw.suggestedDuration > 0) {
      const ratio = hw.actualDuration / hw.suggestedDuration;
      ratios.push(ratio);
      if (ratio <= 0.8) efficiencyBonus += 5;
    }
  });

  const averageRatio = ratios.length > 0
    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
    : 0;

  const settlementData = {
    basePoints,
    efficiencyBonus,
    totalBeforeRating: basePoints + efficiencyBonus,
    challengeCount: challengeHw.length,
    timerCount: homeworks.filter(h => h.mode === 'timer' && h.status === 'done').length,
  };

  window._settlement = settlementData;

  const dateKey = Util.dateKey(currentDate);
  await API.saveSettlement(dateKey, {
    ...settlementData,
    rating: null,
    multiplier: null,
    finalPoints: null,
    submittedAt: null,
    ratedAt: null,
  });

  await API.saveEfficiency(dateKey, { averageRatio, ratios });

  needsFullRender = true;
  updateBigScreen();
}

let _submittingRating = false;

async function submitForRating() {
  if (_submittingRating) return;
  const settlement = window._settlement;
  if (!settlement) return;

  _submittingRating = true;
  try {
    const dateKey = Util.dateKey(currentDate);
    const settlementData = {
      basePoints: settlement.basePoints,
      efficiencyBonus: settlement.efficiencyBonus,
      rating: null,
      multiplier: null,
      finalPoints: null,
      submittedAt: Util.nowTimeStr(),
      ratedAt: null,
    };

    await API.saveSettlement(dateKey, settlementData);

    homeworks.forEach(hw => {
      if (hw.status === 'done') {
        delete lastReminderTrigger[hw.id];
      }
    });

    stopTickTimer();
    needsFullRender = true;
    updateBigScreen();
    showToast('已提交等待爸爸评级');
    Voice.speak('请爸爸检查作业');
  } finally {
    _submittingRating = false;
  }
}

// ========== Screen Saver ==========
function startScreenSaverTimer() {
  clearTimeout(screenSaverTimer);
  screenSaverTimer = setTimeout(() => {
    showScreenSaver();
  }, 60000);
}

function showScreenSaver() {
  isScreenSaverActive = true;
  const saver = document.getElementById('screenSaver');
  saver.classList.add('active');
  updateSaverTime();
  saverTimeInterval = setInterval(updateSaverTime, 1000);
}

function wakeUp() {
  isScreenSaverActive = false;
  document.getElementById('screenSaver').classList.remove('active');
  clearInterval(saverTimeInterval);
  startScreenSaverTimer();
}

function updateSaverTime() {
  const now = new Date();
  document.getElementById('saverTime').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('saverDate').textContent = Util.formatDate(now);
}

// ========== Connection Status ==========
function updateConnStatus() {
  const el = document.getElementById('connStatus');
  if (isServerMode) {
    el.textContent = '🟢';
    el.className = 'conn-status online';
    el.title = '已连接服务器 · 数据实时同步';
  } else {
    el.textContent = '🟡';
    el.className = 'conn-status offline';
    el.title = '本地模式 · 数据仅保存在本设备';
  }
}

// ========== Init ==========
async function init() {
  try {
    cachedData = await API.getData();
  } catch (e) {
    document.getElementById('bigMode').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center;">
        <div>
          <div style="font-size:80px;margin-bottom:20px;">🔌</div>
          <div style="font-size:32px;font-weight:700;margin-bottom:12px;">未连接服务器</div>
          <div style="font-size:20px;color:var(--text-secondary);">请先运行 python server.py</div>
        </div>
      </div>`;
    updateConnStatus();
    return;
  }
  const key = Util.dateKey(currentDate);

  homeworks = cachedData.homeworks?.[key] || [];
  freeTimeTasks = cachedData.freeTimeTasks?.[key] || [];

  if (homeworks.length > 0 && homeworks.every(h => h.status === 'done')) {
    const existing = cachedData.dailySettlement?.[key];
    if (!existing || (!existing.submittedAt && !existing.rating)) {
      await calculateSettlement();
    }
  }

  if (getActiveHomework() || getActiveFreeTime()) {
    startTickTimer();
  }

  updateBigScreen();

  // Lightweight per-second tick (clock + timers only, no DOM rebuild)
  tickInterval = setInterval(() => tickFrame(), 1000);

  startScreenSaverTimer();

  document.addEventListener('click', startScreenSaverTimer);
  document.addEventListener('touchstart', startScreenSaverTimer);

  // Every 10s sync from server, full render only if data changed
  setInterval(async () => {
    try {
      cachedData = await API.getData();
      const key = Util.dateKey(currentDate);

      const newHw = cachedData.homeworks?.[key] || [];
      const oldHwJson = JSON.stringify(homeworks);
      const newHwJson = JSON.stringify(newHw);
      if (oldHwJson !== newHwJson) {
        homeworks = newHw;
        needsFullRender = true;
      }

      const newFreeTime = cachedData.freeTimeTasks?.[key] || [];
      const oldFtJson = JSON.stringify(freeTimeTasks);
      const newFtJson = JSON.stringify(newFreeTime);
      if (oldFtJson !== newFtJson) {
        freeTimeTasks = newFreeTime;
        needsFullRender = true;
      }

      const hasActive = getActiveHomework() || getActiveFreeTime();
      const isPaused = isAnyTaskPaused();
      if (hasActive && !isPaused && !tickInterval) startTickTimer();
      if ((!hasActive || isPaused) && tickInterval) stopTickTimer();

      const newSettlement = cachedData.dailySettlement?.[key] || null;
      if (newSettlement) {
        cachedData._settlement = newSettlement;
        needsFullRender = true;
      } else {
        const old = getSettlementData();
        if (old && (old.submittedAt || old.rating)) {
          cachedData._settlement = null;
          window._settlement = null;
          needsFullRender = true;
        }
      }

      if (needsFullRender) {
        updateBigScreen();
      }
    } catch (e) {
      // Server unreachable — silently retry next cycle
    }
  }, 5000);

  updateConnStatus();
}

init();
