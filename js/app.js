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
let pollInterval = null;
let _lastBuffs = null;
let _lastRewardBox = null;
let _lastRatingInfo = null;
let _lastPoints = null;
let _lastSettings = null;

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
  _queue: [],
  _playing: false,
  _cache: new Map(),
  speak(text) {
    this._queue.push(text);
    if (!this._playing) this._playNext();
  },
  async _playNext() {
    if (this._queue.length === 0) { this._playing = false; return; }
    this._playing = true;
    const text = this._queue.shift();
    try {
      let audio;
      if (this._cache.has(text)) {
        audio = new Audio(this._cache.get(text));
      } else {
        const url = '/api/speak?' + new URLSearchParams({ text });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('speak fail');
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        this._cache.set(text, blobUrl);
        audio = new Audio(blobUrl);
      }
      audio.onended = () => this._playNext();
      audio.onerror = () => this._playNext();
      await audio.play();
    } catch (e) {
      this._playNext();
    }
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

async function requestDeferHomework(hwId) {
  if (_requestingDefer) return;
  const hw = homeworks.find(h => h.id === hwId);
  if (!hw || hw.status !== 'pending' || hw.deferRequest) return;

  _requestingDefer = true;
  try {
    const dateKey = Util.dateKey(currentDate);
    await API.deferHomework(dateKey, hwId, 'request', new Date().toISOString());
    cachedData = await API.getData();
    homeworks = cachedData.homeworks?.[dateKey] || [];
    Voice.speak('已申请延后，等待爸爸确认');
    needsFullRender = true;
    updateBigScreen();
    showToast('已申请将"' + hw.subject + ' - ' + hw.content + '"延后到明天');
  } catch (e) {
    showToast('申请失败，请重试');
  } finally {
    _requestingDefer = false;
  }
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
  if (hw.paused) { showToast('请先继续任务再完成'); return; }

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
    Voice.speak('超时了，本次按计时模式统计，' + hw.subject + '作业完成');
  } else if (hw.mode === 'challenge') {
    hw._animClass = 'challenge-success';
    toastMsg = '⚡ 挑战成功！' + hw.subject + '提前完成';
    Voice.speak('挑战成功！' + hw.subject + '提前完成');
  } else {
    hw._animClass = 'task-complete';
    toastMsg = '✅ ' + hw.subject + '完成';
    Voice.speak(hw.subject + '作业完成！');
  }
  stopTickTimer();
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
  if (ft.paused) { showToast('请先继续任务再完成'); return; }

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
  Voice.speak('任务已暂停');
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
  Voice.speak('任务已继续');
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
let lastOvertimeSpeak = {};

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

  if (!lastReminderTrigger[key].fiveMin && totalSeconds - elapsedSeconds <= 300 && elapsedSeconds < totalSeconds) {
    lastReminderTrigger[key].fiveMin = true;
    Voice.speak('还剩5分钟');
  }

  if (!lastReminderTrigger[key].oneMin && totalSeconds - elapsedSeconds <= 60 && elapsedSeconds < totalSeconds) {
    lastReminderTrigger[key].oneMin = true;
    Voice.speak('还剩1分钟');
  }

  if (!lastReminderTrigger[key].overtime && elapsedSeconds > totalSeconds) {
    lastReminderTrigger[key].overtime = true;
    Voice.speak('已超时，请尽快完成');
    lastOvertimeSpeak[key] = Date.now();
  }

  if (lastReminderTrigger[key].overtime && elapsedSeconds > totalSeconds) {
    const lastSpeak = lastOvertimeSpeak[key] || 0;
    if (Date.now() - lastSpeak >= 30 * 60 * 1000) {
      Voice.speak('已超时，请尽快完成');
      lastOvertimeSpeak[key] = Date.now();
    }
  }
}

// ========== Free Time Reminders (time-based rewards) ==========
let lastFtReminderTrigger = {};
let lastFtOvertimeSpeak = {};

function checkFreeTimeReminders(ft) {
  if (ft.status !== 'doing' || !ft.startedAt) return;

  const startedAt = new Date(ft.startedAt);
  const elapsedSeconds = Math.floor((new Date() - startedAt) / 1000);
  const totalSeconds = ft.durationMinutes * 60;

  const key = ft.id;
  if (!lastFtReminderTrigger[key]) lastFtReminderTrigger[key] = {};

  if (!lastFtReminderTrigger[key].half && elapsedSeconds >= totalSeconds * 0.5) {
    lastFtReminderTrigger[key].half = true;
    Voice.speak(ft.name + '已进行' + Math.floor(ft.durationMinutes / 2) + '分钟');
  }

  if (!lastFtReminderTrigger[key].fiveMin && totalSeconds - elapsedSeconds <= 300 && elapsedSeconds < totalSeconds) {
    lastFtReminderTrigger[key].fiveMin = true;
    Voice.speak(ft.name + '还剩5分钟');
  }

  if (!lastFtReminderTrigger[key].oneMin && totalSeconds - elapsedSeconds <= 60 && elapsedSeconds < totalSeconds) {
    lastFtReminderTrigger[key].oneMin = true;
    Voice.speak(ft.name + '还剩1分钟');
  }

  if (!lastFtReminderTrigger[key].overtime && elapsedSeconds > totalSeconds) {
    lastFtReminderTrigger[key].overtime = true;
    Voice.speak(ft.name + '时间到，请结束任务');
    lastFtOvertimeSpeak[key] = Date.now();
  }

  if (lastFtReminderTrigger[key].overtime && elapsedSeconds > totalSeconds) {
    const lastSpeak = lastFtOvertimeSpeak[key] || 0;
    if (Date.now() - lastSpeak >= 30 * 60 * 1000) {
      Voice.speak(ft.name + '时间到，请结束任务');
      lastFtOvertimeSpeak[key] = Date.now();
    }
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

  const doneHw = homeworks.filter(h => h.status === 'done');
  const basePoints = doneHw.reduce((sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkDefaultBasePoints ?? 10), 0);
  let efficiencyBonus = 0;
  const ratios = [];
  const bonusPerTask = cachedData?.settings?.challengeEfficiencyBonus ?? 5;

  challengeHw.forEach(hw => {
    if (hw.actualDuration !== null && hw.suggestedDuration > 0) {
      const ratio = hw.actualDuration / hw.suggestedDuration;
      ratios.push(ratio);
      if (ratio <= 0.8) efficiencyBonus += bonusPerTask;
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
    timerCount: doneHw.filter(h => h.mode === 'timer').length,
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
    Voice.speak('全部作业已完成，等待爸爸评级');
  } finally {
    _submittingRating = false;
  }
}

// ========== Server Polling ==========
let pollServer = null;

function startPoll(intervalMs) {
  stopPoll();
  pollServer = async () => {
    try {
      cachedData = await API.getData();
      const key = Util.dateKey(currentDate);

      const buffs = cachedData.activeBuffs || [];
      const now_ = new Date();
      const remaining = [];
      let buffsChanged = false;
      for (const b of buffs) {
        const unit = b.unit || 'days';
        if (unit === 'minutes') {
          const startTime = b.startDate ? new Date(b.startDate) : new Date();
          const endTime = new Date(startTime.getTime() + (b.duration || 0) * 60000);
          if (endTime <= now_) {
            buffsChanged = true;
          } else {
            remaining.push(b);
          }
        } else {
          const end = new Date(b.startDate);
          end.setDate(end.getDate() + (b.duration || 1));
          if (end <= now_) {
            buffsChanged = true;
          } else {
            remaining.push(b);
          }
        }
      }
      if (buffsChanged) {
        await API.saveActiveBuffs(remaining);
        cachedData.activeBuffs = remaining;
        needsFullRender = true;
      }

      if (_lastBuffs !== null && JSON.stringify(cachedData.activeBuffs || []) !== JSON.stringify(_lastBuffs)) {
        const prevBuffs = _lastBuffs || [];
        const newBuffs = cachedData.activeBuffs || [];
        const added = newBuffs.filter(b => !prevBuffs.some(p => p.name === b.name && p.startDate === b.startDate));
        for (const b of added) {
          Voice.speak(b.name + '已生效');
        }
        _lastBuffs = newBuffs;
        needsFullRender = true;
      }
      if (_lastBuffs === null) {
        _lastBuffs = cachedData.activeBuffs || [];
      }

      const rb = cachedData.rewardBox || [];
      const prevRb = _lastRewardBox || [];
      if (_lastRewardBox !== null && JSON.stringify(rb) !== JSON.stringify(prevRb)) {
        const addedRb = rb.filter(r => !prevRb.some(p => p.name === r.name) || (r.quantity || 0) > (prevRb.find(p => p.name === r.name)?.quantity || 0));
        if (addedRb.length > 0) {
          Voice.speak('奖励箱有新奖励，快去看看吧');
        }
        _lastRewardBox = rb.concat();
      }
      if (_lastRewardBox === null) {
        _lastRewardBox = rb.concat();
      }

      const newHw = cachedData.homeworks?.[key] || [];
      const oldHwJson = JSON.stringify(homeworks);
      const newHwJson = JSON.stringify(newHw);
      if (oldHwJson !== newHwJson) {
        const oldDeferred = homeworks.filter(h => h.deferRequest && h.deferRequest.status === 'pending');
        const newDeferred = newHw.filter(h => h.deferRequest && h.deferRequest.status === 'pending');
        for (const dh of oldDeferred) {
          const stillThere = newHw.find(h => h.id === dh.id);
          if (!stillThere) {
            Voice.speak('爸爸批准了' + dh.subject + '的延后申请，明天再做');
          } else if (!stillThere.deferRequest) {
            Voice.speak('爸爸拒绝了' + dh.subject + '的延后申请，今天完成吧');
          }
        }
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
      let ratingChanged = false;
      if (newSettlement) {
        const prevRating = _lastRatingInfo;
        if (newSettlement.rating && (!prevRating || prevRating.key !== key || prevRating.rating !== newSettlement.rating)) {
          ratingChanged = true;
          _lastRatingInfo = { key, rating: newSettlement.rating, finalPoints: newSettlement.finalPoints };
        }
        cachedData._settlement = newSettlement;
        needsFullRender = true;
      } else {
        const old = getSettlementData();
        if (old && (old.submittedAt || old.rating)) {
          cachedData._settlement = null;
          window._settlement = null;
          _lastRatingInfo = null;
          needsFullRender = true;
        }
      }

      if (ratingChanged) {
        const info = _lastRatingInfo;
        Voice.speak('爸爸评了' + info.rating + '，获得' + (info.finalPoints || 0) + '分');
      }

      const points = cachedData?.points?.balance ?? cachedData?.points ?? 0;
      if (_lastPoints !== null && points !== _lastPoints) {
        Voice.speak('积分已更新为' + points + '分');
      }
      _lastPoints = points;

      const settings = cachedData?.settings || {};
      if (_lastSettings !== null && JSON.stringify(settings) !== JSON.stringify(_lastSettings)) {
        needsFullRender = true;
      }
      _lastSettings = settings;

      if (needsFullRender) {
        updateBigScreen();
      }
    } catch (e) {
      // Server unreachable — silently retry next cycle
    }
  };
  pollInterval = setInterval(() => pollServer(), intervalMs);
}

function stopPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
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
  startPoll(60000);
}

function wakeUp() {
  isScreenSaverActive = false;
  document.getElementById('screenSaver').classList.remove('active');
  clearInterval(saverTimeInterval);
  startScreenSaverTimer();
  pollServer();
  startPoll(5000);
  Voice.speak('屏幕已唤醒');
}

let lastHourChime = null;

function updateSaverTime() {
  const now = new Date();
  document.getElementById('saverTime').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('saverDate').textContent = Util.formatDate(now);

  if (now.getMinutes() === 0 && now.getSeconds() === 0) {
    const hourKey = now.getHours();
    if (lastHourChime !== hourKey) {
      lastHourChime = hourKey;
      Voice.speak('现在是' + hourKey + '点');
    }
  }
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

  // Every 5s sync from server, full render only if data changed
  startPoll(5000);

  updateConnStatus();
}

init();
