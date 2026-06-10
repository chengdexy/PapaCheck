/**
 * app.js - 应用主逻辑
 * 负责初始化、作业计时、屏保、语音、Toast、积分结算
 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function (err) {
      console.log('SW registration failed:', err);
    });

    // 监听 SW 发来的强制刷新消息
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'FORCE_REFRESH') {
        sessionStorage.setItem('sw_updated', 'true');
        showTransitionMask('检测到新版本，正在刷新页面...');
        window.location.reload();
      }
    });
  });
}

// 页面加载时检测是否为刷新后
if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('sw_updated') === 'true') {
  sessionStorage.removeItem('sw_updated');
  setTimeout(function () {
    showToast('已更新到最新版本');
  }, 500);
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

// ========== State ==========
let currentDate = new Date();
let homeworks = [];
let freeTimeTasks = [];

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
let screenSaverTimer = null;
let isScreenSaverActive = false;
let tickInterval = null;
let clockInterval = null;
let pollInterval = null;
let _lastBuffs = null;
let _lastRewardBox = null;
let _lastShopItems = null;
let _lastBountySubmissions = null;
let _lastBountyCompletions = null;
window._recentNewRewardIds = new Set();
let _lastRatingInfo = null;
let _lastSettings = null;
/** 上一轮 poll 中出现的通知 ID 集合（用于延迟消费） */
let _lastNotifIds = null;
/** calculateSettlement 幂等性：防止重入 */
let _calculatingSettlement = false;
/** calculateSettlement 幂等性：上次保存的数据快照（跳过重复 PUT） */
let _lastSettlementSnapshot = null;
/** calculateSettlement 幂等性：上次保存的效率数据快照（跳过重复 PUT） */
let _lastEfficiencySnapshot = null;

// ========== Utility ==========
const Util = {
  genId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
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
  clear() {
    this._queue = [];
  },
  async _playNext() {
    if (this._queue.length === 0) { this._playing = false; return; }
    this._playing = true;
    const text = this._queue.shift();
    try {
      if (!isServerMode) {
        this._playNext();
        return;
      }
      let audio;
      if (this._cache.has(text)) {
        console.log('[Voice] cache hit:', text);
        audio = new Audio(this._cache.get(text));
      } else {
        const url = '/api/speak?' + new URLSearchParams({ text });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('speak fail');
        const blob = await resp.blob();
        console.log('[Voice] fetch OK:', text, 'size:', blob.size);
        if (blob.size === 0) {
          showToast('语音数据为空: ' + text);
          this._playNext();
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        if (this._cache.size >= 50) {
          const firstKey = this._cache.keys().next().value;
          URL.revokeObjectURL(this._cache.get(firstKey));
          this._cache.delete(firstKey);
        }
        this._cache.set(text, blobUrl);
        audio = new Audio(blobUrl);
      }
      audio.onended = () => this._playNext();
      audio.onerror = (e) => {
        console.error('Voice playback error:', e, 'text:', text, 'audio.error:', audio.error?.message);
        showToast('语音播放失败(' + (audio.error?.message || '未知') + '): ' + text);
        this._playNext();
      };
      await audio.play();
    } catch (e) {
      console.error('Voice._playNext error:', e);
      if (e.name === 'NotAllowedError') {
        this._queue.unshift(text);
        this._playing = false;
        return;
      }
      showToast('语音异常: ' + (e.message || e));
      this._playNext();
    }
  },
};

// 解锁音频自动播放
(function () {
  var _unlockDone = false;
  var _ctx = null;
  function unlockAudio() {
    if (_unlockDone) return;
    // 创建并唤醒 AudioContext，用 Promise 判断是否真正解锁
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _ctx.resume().then(function () {
      _unlockDone = true;
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    }).catch(function () {
      // 解锁失败，不设 _unlockDone，下次交互继续尝试
    });
  }
  document.addEventListener('touchstart', unlockAudio, { once: false });
  document.addEventListener('click', unlockAudio, { once: false });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) unlockAudio();
  });
  setTimeout(unlockAudio, 100);
})();

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

function getActiveBounty() {
  if (!cachedData) return null;
  const dateKey = Util.dateKey(currentDate);
  const submissions = cachedData.bountySubmissions?.[dateKey] || [];
  return submissions.find(s => s.status === 'doing') || null;
}

function isAnyTaskActive() {
  return getActiveHomework() || getActiveFreeTime() || getActiveBounty();
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
    Voice.speak('已申请延后，等待审核');
    needsFullRender = true;
    updateBigScreen();
    showToast('已申请将"' + hw.subject + ' - ' + hw.content + '"延后到明天');
  } catch (e) {
    showToast('申请失败，请重试');
  } finally {
    _requestingDefer = false;
  }
}

async function startHomework(id, mode) {
  if (_startingHomework) return;
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }

  const hw = homeworks.find(h => h.id === id);
  if (!hw || hw.status !== 'pending') return;

  _startingHomework = true;
  try {
    Voice.clear();

    hw.mode = hw.rejected ? 'timer' : (mode || 'timer');
    hw.status = 'doing';
    hw.startedAt = new Date().toISOString();
    await API.patchHomework(hw.id, {
      status: 'doing',
      startedAt: hw.startedAt,
      mode: hw.mode,
    }, Util.dateKey(currentDate));

    if (mode === 'challenge') {
      Voice.speak('开始' + hw.content + '，挑战' + hw.suggestedDuration + '分钟');
    } else {
      Voice.speak('开始' + hw.content);
    }

    startTickTimer();
    needsFullRender = true;
    updateBigScreen();
  } finally {
    _startingHomework = false;
  }
}

async function completeInSchool(hwId, deps) {
  const hw = (deps ? deps.homeworks : homeworks).find(h => h.id === hwId);
  if (!hw || hw.status !== 'pending') return;

  const now = new Date().toISOString();
  hw.status = 'done';
  hw.mode = 'challenge';
  hw.completedInSchool = true;
  hw.actualDuration = Math.ceil((hw.suggestedDuration || 0) * 0.9);
  hw.startedAt = now;
  hw.completedAt = now;

  if (deps) {
    await deps.saveHomeworks();
    await deps.checkAllDone();
    deps.updateBigScreen();
    if (deps.speak) deps.speak('在学校提前完成，好样的！');
  } else {
    await API.patchHomework(hw.id, {
      status: 'done',
      mode: 'challenge',
      completedInSchool: true,
      actualDuration: hw.actualDuration,
      startedAt: hw.startedAt,
      completedAt: hw.completedAt,
    }, Util.dateKey(currentDate));
    await checkAllDone();
    needsFullRender = true;
    updateBigScreen();
    Voice.speak('在学校提前完成，好样的！');
  }
}

let _completingHomework = false;
let _startingHomework = false;

function clampActualDuration(actualDuration, suggestedDuration) {
  if (suggestedDuration > 0 && actualDuration <= suggestedDuration * 0.2 && actualDuration <= 1) {
    return suggestedDuration;
  }
  return actualDuration;
}

async function completeHomework(id) {
  if (_completingHomework) return;
  _completingHomework = true;
  try {
    const hw = homeworks.find(h => h.id === id);
    if (!hw || hw.status !== 'doing') return;
    if (hw.paused) { showToast('请先继续任务再完成'); return; }

    const completedAt = new Date();
    const startedAt = new Date(hw.startedAt);
    const rawDuration = Math.max(1, Math.round((completedAt - startedAt) / 60000));
    const actualDuration = clampActualDuration(rawDuration, hw.suggestedDuration || 0);

    hw.status = 'done';
    hw.completedAt = completedAt.toISOString();
    hw.actualDuration = actualDuration;

    Voice.clear();

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
    await API.patchHomework(hw.id, {
      status: 'done',
      completedAt: hw.completedAt,
      actualDuration: hw.actualDuration,
      mode: hw.mode,
      _animClass: hw._animClass,
    }, Util.dateKey(currentDate));

    await checkAllDone();
    needsFullRender = true;
    updateBigScreen();
    showToast(toastMsg);
  } finally {
    _completingHomework = false;
  }
}

async function saveHomeworksSilent() {
  for (var i = 0; i < homeworks.length; i++) {
    await API.putHomework(homeworks[i].id, homeworks[i]);
  }
}

async function saveFreeTimeSilent() {
  for (var i = 0; i < freeTimeTasks.length; i++) {
    await API.putFreeTimeTask(freeTimeTasks[i].id, freeTimeTasks[i]);
  }
}

async function startFreeTime(id) {
  if (isAnyTaskActive()) {
    showToast('请先完成当前任务');
    return;
  }

  const ft = freeTimeTasks.find(t => t.id === id);
  if (!ft || ft.status !== 'pending') return;

  Voice.clear();

  ft.status = 'doing';
  ft.startedAt = new Date().toISOString();
  ft.remainingSeconds = ft.durationMinutes * 60;
  await API.putFreeTimeTask(ft.id, ft);

  Voice.speak('开始' + ft.name);
  startTickTimer();
  needsFullRender = true;
  updateBigScreen();
}

async function completeFreeTime(id) {
  const ft = freeTimeTasks.find(t => t.id === id);
  if (!ft || ft.status !== 'doing') return;
  if (ft.paused) { showToast('请先继续任务再完成'); return; }

  ft.status = 'done';
  ft.completedAt = new Date().toISOString();
  ft.remainingSeconds = 0;

  stopTickTimer();
  Voice.speak(ft.name + '时间到！');
  await API.putFreeTimeTask(ft.id, ft);
  needsFullRender = true;
  updateBigScreen();
}

async function pauseActiveTask() {
  const task = getActiveHomework() || getActiveFreeTime();
  if (!task || task.paused) return;
  task.paused = true;
  task.wasPaused = true;
  stopTickTimer();
  Voice.speak('任务已暂停');
  if (task.startedAt && task.status === 'doing') {
    task._pausedElapsed = Math.floor((new Date() - new Date(task.startedAt)) / 1000);
  }
  if (task.subject) await API.patchHomework(task.id, {
    paused: true,
    wasPaused: true,
    _pausedElapsed: task._pausedElapsed,
  }, Util.dateKey(currentDate));
  else await API.putFreeTimeTask(task.id, task);
  needsFullRender = true;
  updateBigScreen();
}

async function resumeActiveTask() {
  const task = getActiveHomework() || getActiveFreeTime();
  if (!task || !task.paused) return;
  task.paused = false;
  if (task._pausedElapsed) {
    const pausedSeconds = task._pausedElapsed;
    task.startedAt = new Date(new Date() - pausedSeconds * 1000).toISOString();
    delete task._pausedElapsed;
  }
  if (task.subject) await API.patchHomework(task.id, {
    paused: false,
    startedAt: task.startedAt,
  }, Util.dateKey(currentDate));
  else await API.putFreeTimeTask(task.id, task);
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

// ---- Clock display (independent from task timer, never stopped) ----
let lastHourChime = null;
function startClockTimer() {
  if (clockInterval) return;
  updateMainClock();
  clockInterval = setInterval(updateMainClock, 30000);
}
function updateMainClock() {
  const now = new Date();
  // 主界面时钟
  document.getElementById('bigDate').textContent = Util.formatDate(now);
  document.getElementById('bigTime').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  // 屏保时钟（屏保激活时这些元素可见）
  const saverTimeEl = document.getElementById('saverTime');
  if (saverTimeEl) {
    saverTimeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const saverDateEl = document.getElementById('saverDate');
    if (saverDateEl) {
      saverDateEl.textContent = Util.formatDate(now);
    }
  }
  // 整点报时（防重由 lastHourChime 保证）
  if (now.getMinutes() === 0) {
    const hourKey = now.getHours();
    if (lastHourChime !== hourKey) {
      lastHourChime = hourKey;
      Voice.speak('现在是' + hourKey + '点');
    }
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

  if (!lastReminderTrigger[key].half && totalSeconds > 60 && elapsedSeconds >= totalSeconds * 0.5) {
    lastReminderTrigger[key].half = true;
    Voice.speak('已用' + hw.suggestedDuration / 2 + '分钟，继续加油');
  }

  if (!lastReminderTrigger[key].fiveMin && totalSeconds > 300 && totalSeconds - elapsedSeconds <= 300 && elapsedSeconds < totalSeconds) {
    lastReminderTrigger[key].fiveMin = true;
    Voice.speak('还剩5分钟');
  }

  if (!lastReminderTrigger[key].oneMin && totalSeconds > 60 && totalSeconds - elapsedSeconds <= 60 && elapsedSeconds < totalSeconds) {
    lastReminderTrigger[key].oneMin = true;
    Voice.speak('还剩1分钟');
  }

  if (elapsedSeconds > totalSeconds) {
    if (!lastReminderTrigger[key].overtime) {
      lastReminderTrigger[key].overtime = true;
      Voice.speak('已超时，请尽快完成');
      lastOvertimeSpeak[key] = Date.now();
    } else {
      const lastSpeak = lastOvertimeSpeak[key] || 0;
      if (Date.now() - lastSpeak >= 30 * 60 * 1000) {
        Voice.speak('已超时，请尽快完成');
        lastOvertimeSpeak[key] = Date.now();
      }
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

  if (!lastFtReminderTrigger[key].half && totalSeconds > 60 && elapsedSeconds >= totalSeconds * 0.5) {
    lastFtReminderTrigger[key].half = true;
    Voice.speak(ft.name + '已进行' + Math.floor(ft.durationMinutes / 2) + '分钟');
  }

  if (!lastFtReminderTrigger[key].fiveMin && totalSeconds > 300 && totalSeconds - elapsedSeconds <= 300 && elapsedSeconds < totalSeconds) {
    lastFtReminderTrigger[key].fiveMin = true;
    Voice.speak(ft.name + '还剩5分钟');
  }

  if (!lastFtReminderTrigger[key].oneMin && totalSeconds > 60 && totalSeconds - elapsedSeconds <= 60 && elapsedSeconds < totalSeconds) {
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

/** 幂等性 PUT settlement，相同数据跳过 */
async function _putSettlementIdempotent(dateKey, data) {
  const snap = { dateKey, dataJson: JSON.stringify(data) };
  if (_lastSettlementSnapshot && _lastSettlementSnapshot.dateKey === dateKey && _lastSettlementSnapshot.dataJson === snap.dataJson) {
    return false;
  }
  await API.putSettlement(dateKey, data);
  _lastSettlementSnapshot = snap;
  return true;
}

/** 幂等性 PUT efficiency，相同数据跳过 */
async function _putEfficiencyIdempotent(dateKey, data) {
  const snap = { dateKey, dataJson: JSON.stringify(data) };
  if (_lastEfficiencySnapshot && _lastEfficiencySnapshot.dateKey === dateKey && _lastEfficiencySnapshot.dataJson === snap.dataJson) {
    return false;
  }
  await API.putEfficiency(dateKey, data);
  _lastEfficiencySnapshot = snap;
  return true;
}

/**
 * 计算并保存作业效率数据（消除 calculateSettlement 中的重复代码）
 * @param {Array} efficiencyHw - 已完成且未拒绝的作业列表
 * @param {string} dateKey - 日期键 YYYY-MM-DD
 */
async function calculateAndSaveEfficiency(efficiencyHw, dateKey) {
  const ratios = [];
  efficiencyHw.forEach(hw => {
    if (hw.actualDuration !== null && hw.suggestedDuration > 0) {
      ratios.push(hw.suggestedDuration / hw.actualDuration);
    }
  });
  const averageRatio = ratios.length > 0
    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
    : 0;

  await _putEfficiencyIdempotent(dateKey, { averageRatio, ratios });
}

async function calculateSettlement() {
  if (_calculatingSettlement) return;
  _calculatingSettlement = true;
  try {
    const doneHw = homeworks.filter(h => h.status === 'done');
    const challengeSuccess = doneHw.filter(h => h.mode === 'challenge' && !h.rejected);
    const efficiencyHw = doneHw.filter(h => !h.rejected);

    const dateKey = Util.dateKey(currentDate);

    // 检查当天是否已有 settlement 并已评级
    const existingSettlement = cachedData?.dailySettlement?.[dateKey];

    if (existingSettlement && (existingSettlement.rating || existingSettlement.submittedAt)) {
      // 当天已评级 或 已提交等待评级：只处理追加作业，不覆写 submittedAt
      const prevHomeworkBonus = existingSettlement.homeworkBonus || 0;

      const currentHomeworkBonus = challengeSuccess.reduce(
        (sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkBonusPerTask ?? 10), 0
      );

      const newHomeworkBonus = currentHomeworkBonus - prevHomeworkBonus;

      if (newHomeworkBonus > 0) {
        // 用已有倍率计算新增积分（不含每日基础分）
        const multiplier = existingSettlement.multiplier;
        const additionalPoints = Math.round(newHomeworkBonus * multiplier);

        const updatedSettlement = {
          ...existingSettlement,
          homeworkBonus: currentHomeworkBonus,
          totalBeforeRating: existingSettlement.dailyBase + currentHomeworkBonus,
          doneCount: doneHw.length,
          finalPoints: (existingSettlement.finalPoints || 0) + additionalPoints,
        };

        window._settlement = updatedSettlement;
        await _putSettlementIdempotent(dateKey, updatedSettlement);

        if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
        cachedData.dailySettlement[dateKey] = updatedSettlement;

        if (additionalPoints > 0) {
          await API.updatePoints('earn', additionalPoints,
            `追加完成作业，按${existingSettlement.rating}评级倍率计算`);
        }
      } else {
        // 没有新作业加分，只更新 doneCount
        const updatedSettlement = {
          ...existingSettlement,
          doneCount: doneHw.length,
        };
        window._settlement = updatedSettlement;
        await _putSettlementIdempotent(dateKey, updatedSettlement);
        if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
        cachedData.dailySettlement[dateKey] = updatedSettlement;
      }

      // 保存 efficiency 数据
      await calculateAndSaveEfficiency(efficiencyHw, dateKey);

      needsFullRender = true;
      updateBigScreen();
      return;
    }

    // 当天未评级：正常计算结算
    const dailyBase = cachedData?.settings?.dailyBasePoints ?? 50;
    const homeworkBonus = challengeSuccess.reduce(
      (sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkBonusPerTask ?? 10), 0
    );

    const settlementData = {
      dailyBase,
      homeworkBonus,
      totalBeforeRating: dailyBase + homeworkBonus,
      doneCount: doneHw.length,
    };

    window._settlement = settlementData;

    const settlementToSave = {
      ...settlementData,
      rating: null,
      multiplier: null,
      finalPoints: null,
      submittedAt: null,
      ratedAt: null,
    };
    await _putSettlementIdempotent(dateKey, settlementToSave);

    if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
    cachedData.dailySettlement[dateKey] = settlementToSave;

    await calculateAndSaveEfficiency(efficiencyHw, dateKey);

    needsFullRender = true;
    updateBigScreen();
  } finally {
    _calculatingSettlement = false;
  }
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
      dailyBase: settlement.dailyBase,
      homeworkBonus: settlement.homeworkBonus,
      totalBeforeRating: settlement.totalBeforeRating,
      doneCount: settlement.doneCount,
      rating: null,
      multiplier: null,
      finalPoints: null,
      submittedAt: Util.nowTimeStr(),
      ratedAt: null,
    };

    await API.putSettlement(dateKey, settlementData);

    if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
    cachedData.dailySettlement[dateKey] = settlementData;

    homeworks.forEach(hw => {
      if (hw.status === 'done') {
        delete lastReminderTrigger[hw.id];
        delete lastOvertimeSpeak[hw.id];
      }
    });

    stopTickTimer();
    needsFullRender = true;
    updateBigScreen();
    showToast('今日作业已提交，等待评级');
    Voice.speak('全部作业已完成，等待评级');
  } finally {
    _submittingRating = false;
  }
}

// ========== Server Polling ==========
let pollServer = null;

function startPoll(intervalMs) {
  stopPoll();
  pollServer = async () => {
    var mode = ConnectionManager.getMode();
    if (mode === 'offline' || mode === 'reconnecting') return;

    try {
      cachedData = await API.getData();

      API.migrateBountyCompletionsToTotal(cachedData);
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
        for (var i = 0; i < remaining.length; i++) {
          await API.putBuff(remaining[i].id, remaining[i]);
        }
        cachedData.activeBuffs = remaining;
        needsFullRender = true;
      }

      if (_lastBuffs !== null && JSON.stringify(cachedData.activeBuffs || []) !== JSON.stringify(_lastBuffs)) {
        const prevBuffs = _lastBuffs || [];
        const newBuffs = cachedData.activeBuffs || [];
        const added = newBuffs.filter(b => !prevBuffs.some(p => p.name === b.name && p.startDate === b.startDate));
        _lastBuffs = newBuffs;
        needsFullRender = true;
      }
      if (_lastBuffs === null) {
        _lastBuffs = cachedData.activeBuffs || [];
      }

      const shopItems = cachedData.shopItems || [];
      const prevShop = _lastShopItems || [];
      if (_lastShopItems !== null && JSON.stringify(shopItems) !== JSON.stringify(prevShop)) {
        _lastShopItems = shopItems.concat();
      }
      if (_lastShopItems === null) {
        _lastShopItems = shopItems.concat();
      }

      const rb = cachedData.rewardBox || [];
      const prevRb = _lastRewardBox || [];
      if (_lastRewardBox !== null && JSON.stringify(rb) !== JSON.stringify(prevRb)) {
        const addedRb = rb.filter(r => !prevRb.some(p => p.name === r.name) || (r.quantity || 0) > (prevRb.find(p => p.name === r.name)?.quantity || 0));
        if (addedRb.length > 0) {
          addedRb.forEach(r => window._recentNewRewardIds.add(r.id));
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
        if (!_completingHomework && !_startingHomework) {
          homeworks = newHw;
          needsFullRender = true;
          const allDone = newHw.length > 0 && newHw.every(h => h.status === 'done');
          const settlement = getSettlementData();
          if (settlement && !settlement.rating) {
            if (!allDone) {
              cachedData._settlement = null;
              window._settlement = null;
              if (cachedData.dailySettlement) cachedData.dailySettlement[key] = null;
            }
          }
          // BUG FIX: 作业列表变化后全部已完成时（如最后一项被延后审批通过），自动触发结算
          if (allDone) {
            calculateSettlement();
          }
        }
      }

      const newFreeTime = cachedData.freeTimeTasks?.[key] || [];
      const oldFtJson = JSON.stringify(freeTimeTasks);
      const newFtJson = JSON.stringify(newFreeTime);
      if (oldFtJson !== newFtJson) {
        var _fts = function (s) { return s === 'done' ? 2 : s === 'doing' ? 1 : 0; };
        var hasActiveFt = freeTimeTasks.some(function (ft) {
          if (ft.status === 'pending') return false;
          var sft = newFreeTime.find(function (t) { return t.id === ft.id; });
          return sft && _fts(ft.status) > _fts(sft.status);
        });
        if (!hasActiveFt) {
          freeTimeTasks = newFreeTime;
          needsFullRender = true;
        }
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



      const settings = cachedData?.settings || {};
      if (_lastSettings !== null && JSON.stringify(settings) !== JSON.stringify(_lastSettings)) {
        needsFullRender = true;
      }

      _lastSettings = settings;

      const newBountySubs = (cachedData.bountySubmissions?.[key] || []).filter(s => !s.isDeleted);
      const prevBountySubs = _lastBountySubmissions?.[key] || [];
      const newBountyComps = cachedData.bountyCompletions?._total || {};
      const prevBountyComps = _lastBountyCompletions?._total || {};
      if (_lastBountySubmissions !== null) {
        for (const [tid, newVal] of Object.entries(newBountyComps)) {
          const prevVal = prevBountyComps[tid];
          const nv = typeof newVal === 'number' ? newVal : (newVal ? 1 : 0);
          const pv = typeof prevVal === 'number' ? prevVal : (prevVal ? 1 : 0);
          if (nv > pv) {
            needsFullRender = true;
            if (typeof backToMain === 'function') backToMain();
            break;
          }
        }
        for (const prevSub of prevBountySubs) {
          if (prevSub.status === 'submitted' && !newBountySubs.some(s => s.taskId === prevSub.taskId)) {
            needsFullRender = true;
          }
        }
        for (const newSub of newBountySubs) {
          const prevSub = prevBountySubs.find(s => s.taskId === newSub.taskId);
          if (prevSub && prevSub.status === 'submitted' && newSub.status === 'doing') {
            needsFullRender = true;
          }
        }
      }
      _lastBountyCompletions = {};
      if (cachedData.bountyCompletions?._total) {
        _lastBountyCompletions._total = { ...cachedData.bountyCompletions._total };
      }
      _lastBountySubmissions = {};
      for (const dk of Object.keys(cachedData.bountySubmissions || {})) {
        _lastBountySubmissions[dk] = (cachedData.bountySubmissions[dk] || []).map(s => ({ ...s }));
      }

      // 统一消费通知（延迟一轮：首轮只播不删，第二轮才删）
      try {
        const result = await API.getPendingNotifications();
        const items = result.items || [];
        const currentIds = new Set(items.map(i => i.id));
        // "收到新作业"通知去重：多条同文本只保留最后一条播报
        const playItems = dedupNewHomeworkNotifications(items);
        for (const item of playItems) {
          // 只在通知首次出现时播报，后续轮次跳过（延迟消费期间不再重复播报）
          if (!_lastNotifIds || !_lastNotifIds.has(item.id)) {
            Voice.speak(item.text);
          }
        }
        // 消费"上一轮就在"的通知（Voice 有一整轮时间播报）
        // 本轮有 items 时取交集（两轮都在的才算"持久"），本轮无 items 时全部消费（已播完已消失）
        if (_lastNotifIds && _lastNotifIds.size > 0) {
          let staleIds = [..._lastNotifIds];
          if (items.length > 0) {
            staleIds = staleIds.filter(id => currentIds.has(id));
          }
          if (staleIds.length > 0) {
            await API.consumeNotifications(staleIds);
            // 已消费的 ID 从 currentIds 中移除，防止 _lastNotifIds 保留导致下轮重复消费
            staleIds.forEach(function(id) { currentIds.delete(id); });
          }
        }
        _lastNotifIds = currentIds;
      } catch (e) { /* 非致命 */ }

      if (needsFullRender) {
        updateBigScreen();
      }
    } catch (e) {
    } finally {
      if (pollInterval !== null) pollInterval = setTimeout(pollServer, intervalMs);
    }
  };
  pollInterval = setTimeout(pollServer, intervalMs);
}

function stopPoll() {
  if (pollInterval) {
    clearTimeout(pollInterval);
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
  startPoll(5000);
}

function wakeUp() {
  isScreenSaverActive = false;
  document.getElementById('screenSaver').classList.remove('active');
  startScreenSaverTimer();
  pollServer();
  startPoll(5000);
  Voice.speak('屏幕已唤醒');
}

// ========== Init ==========
async function init() {
  showTransitionMask('正在加载数据…');

  // 先启动 ConnectionManager 检测连接状态（与 admin.js 保持一致）
  await ConnectionManager.start();

  var mode = ConnectionManager.getMode();

  if (mode === 'online') {
    try {
      cachedData = await API.getData();
      isServerMode = true;
      hideTransitionMask();
      // 立即缓存到本地 DB，确保离线时可用（与 admin.js 的 refreshAllData 保持一致）
      // 深拷贝后传给 cacheFullData，防止 ensureSyncFields 原地修改 lastModified/uuid 污染 cachedData
      try { await DB.cacheFullData(JSON.parse(JSON.stringify(cachedData))); } catch (e) { }
    } catch (e) {
      // CM 检测到在线，但实际请求时网络已断，降级到本地 DB
      try {
        var localData = await DB.getFullData();
        if (localData && Object.keys(localData).length > 0) {
          isServerMode = false;
          cachedData = localData;
          cachedData._loadedOffline = true;
          showToast('网络不稳定，已切换到离线模式');
          hideTransitionMask();
        } else {
          hideTransitionMask();
          showToast('未连接服务器，请检查网络');
          isServerMode = false;
          cachedData = { homeworks: {}, freeTimeTasks: {}, dailySettlement: {}, points: { balance: 0 }, shopItems: [], rewardBox: [], activeBuffs: [], bountyTasks: [], bountySubmissions: {}, bountyCompletions: {}, settings: {} };
          if (window._recoveryInterval) clearInterval(window._recoveryInterval);
          window._recoveryInterval = setInterval(function () {
            if (ConnectionManager.getMode() === 'online') {
              clearInterval(window._recoveryInterval);
              location.reload();
            }
          }, 2000);
        }
      } catch (dbErr) {
        hideTransitionMask();
        showToast('未连接服务器，请检查网络');
        isServerMode = false;
        cachedData = { homeworks: {}, freeTimeTasks: {}, dailySettlement: {}, points: { balance: 0 }, shopItems: [], rewardBox: [], activeBuffs: [], bountyTasks: [], bountySubmissions: {}, bountyCompletions: {}, settings: {} };
        if (window._recoveryInterval) clearInterval(window._recoveryInterval);
        window._recoveryInterval = setInterval(function () {
          if (ConnectionManager.getMode() === 'online') {
            clearInterval(window._recoveryInterval);
            location.reload();
          }
        }, 2000);
      }
    }
  } else {
    try {
      var localData = await DB.getFullData();
      if (localData && Object.keys(localData).length > 0) {
        isServerMode = false;
        cachedData = localData;
        cachedData._loadedOffline = true;
        showToast('已进入离线模式，数据将在连接后自动同步');
        hideTransitionMask();
      } else {
        hideTransitionMask();
        showToast('未连接服务器，请检查网络');
        isServerMode = false;
        cachedData = { homeworks: {}, freeTimeTasks: {}, dailySettlement: {}, points: { balance: 0 }, shopItems: [], rewardBox: [], activeBuffs: [], bountyTasks: [], bountySubmissions: {}, bountyCompletions: {}, settings: {} };
        // 定时检查网络恢复后自动重载页面
        if (window._recoveryInterval) clearInterval(window._recoveryInterval);
        window._recoveryInterval = setInterval(function () {
          if (ConnectionManager.getMode() === 'online') {
            clearInterval(window._recoveryInterval);
            location.reload();
          }
        }, 2000);
      }
    } catch (dbErr) {
      hideTransitionMask();
      showToast('未连接服务器，请检查网络');
      isServerMode = false;
      cachedData = { homeworks: {}, freeTimeTasks: {}, dailySettlement: {}, points: { balance: 0 }, shopItems: [], rewardBox: [], activeBuffs: [], bountyTasks: [], bountySubmissions: {}, bountyCompletions: {}, settings: {} };
      if (window._recoveryInterval) clearInterval(window._recoveryInterval);
      window._recoveryInterval = setInterval(function () {
        if (ConnectionManager.getMode() === 'online') {
          clearInterval(window._recoveryInterval);
          location.reload();
        }
      }, 2000);
    }
  }
  API.migrateBountyCompletionsToTotal(cachedData);
  const key = Util.dateKey(currentDate);

  homeworks = cachedData.homeworks?.[key] || [];
  freeTimeTasks = cachedData.freeTimeTasks?.[key] || [];

  if (homeworks.length > 0 && homeworks.every(h => h.status === 'done')) {
    const existing = cachedData.dailySettlement?.[key];
    if (!existing || (!existing.submittedAt && !existing.rating)) {
      await calculateSettlement();
    }
  }

  updateBigScreen();
  startTickTimer();
  startClockTimer();

  startScreenSaverTimer();

  document.addEventListener('click', startScreenSaverTimer);
  document.addEventListener('touchstart', startScreenSaverTimer);

  startPoll(5000);

  updateConnStatus();

  try { await CRDTLog.migrateFromChangeLog(); } catch (e) { }
}

init();

/**
 * 对"收到新作业，请查看"通知去重：多条同文本只保留最后一条
 * @param {Array<{id: string, text: string}>} items
 * @returns {Array<{id: string, text: string}>}
 */
function dedupNewHomeworkNotifications(items) {
  const SEEN_TEXT = '收到新作业，请查看';
  const lastIndex = items.findLastIndex(item => item.text === SEEN_TEXT);
  return items.filter((item, index) =>
    item.text !== SEEN_TEXT || index === lastIndex
  );
}
