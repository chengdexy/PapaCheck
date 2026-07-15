/**
 * app.js - 应用主逻辑
 * 负责初始化、作业计时、屏保、语音、Toast、积分结算
 */

// 认证检查：验证 token 有效性，无效时重定向到登录页
(function checkAuth() {
  try {
    const token = sessionStorage.getItem('papacheck_token');
    const role = sessionStorage.getItem('papacheck_role');
    if (!token) {
      window.location.href = '/papacheck/app/login.html';
      return;
    }
    // 家长角色不应留在孩子端，跳转到管理页
    if (role === 'parent') {
      window.location.href = '/papacheck/app/admin.html';
      return;
    }
    // 通过 API 验证 token 是否仍有效（未被删除/吊销）
    fetch('/papacheck/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (resp) {
      if (resp.status === 401) {
        sessionStorage.removeItem('papacheck_token');
        sessionStorage.removeItem('papacheck_role');
        sessionStorage.removeItem('papacheck_child_name');
        window.location.href = '/papacheck/app/login.html';
      }
    }).catch(function () { });
  } catch (e) {
    // 测试环境中 sessionStorage 不可用，跳过检查
  }
})();

// ========== State ==========
let currentDate = new Date();
let homeworks = [];
let freeTimeTasks = [];

let screenSaverTimer = null;
let isScreenSaverActive = false;
let tickInterval = null;
let clockInterval = null;
let _lastBuffs = null;
let _lastRewardBox = null;
let _lastShopItems = null;
let _lastPoints = null;
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
        const url = '/papacheck/api/speak?' + new URLSearchParams({ text });
        // /api/speak 已改为需鉴权（2026-06-18），需携带 JWT
        // 复用 api.js 的 getAuthHeaders()：自带 try-catch 保护隐私模式下 localStorage 禁用场景
        const resp = await fetch(url, { headers: getAuthHeaders() });
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

    var content = hw.content || '';
    if (mode === 'challenge') {
      Voice.speak('开始' + content + '，挑战' + hw.suggestedDuration + '分钟');
    } else {
      Voice.speak('开始' + content);
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
    // 记录暂停时刻（后端持久化，使暂停进度在轮询/刷新/多端下不丢）
    task.pausedAt = new Date().toISOString();
  }
  if (task.subject) await API.patchHomework(task.id, {
    paused: true,
    wasPaused: true,
    pausedAt: task.pausedAt,
  }, Util.dateKey(currentDate));
  else await API.putFreeTimeTask(task.id, task);
  needsFullRender = true;
  updateBigScreen();
}

async function resumeActiveTask() {
  const task = getActiveHomework() || getActiveFreeTime();
  if (!task || !task.paused) return;
  task.paused = false;
  // 将 startedAt 回拨暂停时长，使已用时长不含暂停区间（基于后端持久化的 pausedAt 计算）
  if (task.pausedAt) {
    const startedAtMs = new Date(task.startedAt).getTime();
    const pausedAtMs = new Date(task.pausedAt).getTime();
    const accumulated = pausedAtMs - startedAtMs;
    task.startedAt = new Date(Date.now() - accumulated).toISOString();
    delete task.pausedAt;
  }
  if (task.subject) await API.patchHomework(task.id, {
    paused: false,
    startedAt: task.startedAt,
    pausedAt: null,
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
    const dateKey = Util.dateKey(currentDate);
    console.log('[Settlement] calculateSettlement run', {
      dateKey,
      hwCount: homeworks.length,
      doneCount: homeworks.filter(h => h.status === 'done').length,
      existingSettlement: cachedData?.dailySettlement?.[dateKey] ? JSON.stringify(cachedData.dailySettlement[dateKey]) : null,
    });

    const doneHw = homeworks.filter(h => h.status === 'done');
    const challengeSuccess = doneHw.filter(h => h.mode === 'challenge' && !h.rejected);
    const efficiencyHw = doneHw.filter(h => !h.rejected);

    // 检查当天是否已有 settlement 并已评级
    const existingSettlement = cachedData?.dailySettlement?.[dateKey];

    if (existingSettlement && (existingSettlement.rating || existingSettlement.submittedAt)) {
      const prevHomeworkBonus = existingSettlement.homeworkBonus || 0;

      const currentHomeworkBonus = challengeSuccess.reduce(
        (sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkBonusPerTask ?? 10), 0
      );

      const newHomeworkBonus = currentHomeworkBonus - prevHomeworkBonus;

      if (existingSettlement.rating) {
        // 当天已评级：只处理追加作业的加分，不覆写 submittedAt
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
      } else if (existingSettlement.submittedAt) {
        // 已提交等待评级：只更新 homeworkBonus/totalBeforeRating，不加分（尚未评级，无倍率）
        if (newHomeworkBonus > 0) {
          const updatedSettlement = {
            ...existingSettlement,
            homeworkBonus: currentHomeworkBonus,
            totalBeforeRating: existingSettlement.dailyBase + currentHomeworkBonus,
            doneCount: doneHw.length,
          };
          window._settlement = updatedSettlement;
          await _putSettlementIdempotent(dateKey, updatedSettlement);
          if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
          cachedData.dailySettlement[dateKey] = updatedSettlement;
        } else {
          const updatedSettlement = {
            ...existingSettlement,
            doneCount: doneHw.length,
          };
          window._settlement = updatedSettlement;
          await _putSettlementIdempotent(dateKey, updatedSettlement);
          if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
          cachedData.dailySettlement[dateKey] = updatedSettlement;
        }
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

    // [诊断] 记录设置後的结算数据
    console.log('[Settlement] 新结算已设置:', {
      dateKey,
      window_settlement: JSON.stringify(window._settlement),
      cachedData_settlement: JSON.stringify(cachedData.dailySettlement[dateKey]),
    });

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

  // 防御：没有已完成作业时不能提交
  var _hasDone = homeworks.some(function (h) { return h.status === 'done'; });
  if (!_hasDone) {
    showToast('没有已完成的作业可提交');
    return;
  }

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

// ========== Realtime Refresh ==========
/** 拉取最新数据并刷新大屏（由 RealtimeManager 回调触发） */
async function refreshFromServer() {
  try {
    cachedData = await API.getData();
    API.migrateBountyCompletionsToTotal(cachedData);
    const key = Util.dateKey(currentDate);

    // 保留本地暂停态：替换前捕获 active homework 本地的 paused / pausedAt
    const oldActiveHw = homeworks.find(h => h.status === 'doing');
    const wasLocallyPaused = !!(oldActiveHw && oldActiveHw.paused);
    const localPausedAt = wasLocallyPaused ? oldActiveHw.pausedAt : undefined;

    homeworks = cachedData.homeworks?.[key] || [];
    freeTimeTasks = cachedData.freeTimeTasks?.[key] || [];

    // pausedAt 已后端持久化，正常轮询服务端直接带出；此处仅兜住 patch 尚未落库的极短竞态
    if (wasLocallyPaused && oldActiveHw) {
      const newActive = homeworks.find(h => h.status === 'doing' && h.id === oldActiveHw.id);
      if (newActive) {
        if (!newActive.paused) {
          newActive.paused = true;
          newActive.wasPaused = true;
        }
        if (localPausedAt !== undefined && newActive.pausedAt === undefined) {
          newActive.pausedAt = localPausedAt;
        }
      }
    }

    needsFullRender = true;
    updateBigScreen();
  } catch (e) {
    console.error('[refreshFromServer] 刷新数据失败:', e);
  }
}

/**
 * 拉取待处理通知并播报（家长端发布作业/调整积分后触发）。
 * 通知仅含文本，孩子端按需经 /api/speak 合成语音；播报后标记消费避免重复。
 */
async function consumeAndSpeakNotifications() {
  try {
    const { items } = await API.getPendingNotifications();
    if (!items || items.length === 0) return;
    // 多条"收到新作业，请查看"合并为一条，避免连播
    const toSpeak = dedupNewHomeworkNotifications(items);
    for (const n of toSpeak) {
      Voice.speak(n.text);
    }
    const ids = toSpeak.map(n => n.id);
    if (ids.length > 0) {
      try {
        await API.consumeNotifications(ids);
      } catch (e) {
        console.warn('[notify] 标记消费失败，下次轮询将重试:', e);
      }
    }
  } catch (e) {
    console.warn('[notify] 拉取/播报通知失败:', e);
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
  refreshFromServer();
}

function wakeUp() {
  isScreenSaverActive = false;
  document.getElementById('screenSaver').classList.remove('active');
  startScreenSaverTimer();
  refreshFromServer();
  Voice.speak('屏幕已唤醒');
}

// ========== Init ==========
async function init() {
  const token = sessionStorage.getItem('papacheck_token');
  if (!token) {
    window.location.href = '/papacheck/app/login.html';
    return;
  }

  showTransitionMask('正在加载数据…');

  try {
    cachedData = await API.getData();
    isServerMode = true;
  } catch (e) {
    hideTransitionMask();
    showToast('加载数据失败，请检查网络');
    console.error('[Init] 加载数据失败:', e);
    return;
  }
  hideTransitionMask();

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

  // 集成 RealtimeManager：轮询监听数据变化
    try {
      const { RealtimeManager } = await import('./realtime.js');
      const realtime = new RealtimeManager();

      // 轮询模式：统一刷新回调，仅触发一次数据拉取
      realtime.callbacks.onRefresh = () => {
        refreshFromServer();
        consumeAndSpeakNotifications();
      };

      await realtime.start(cachedData.tenant_id, cachedData.child_id);
      window._realtimeManager = realtime;
    } catch (e) {
      console.warn('[Init] RealtimeManager 启动失败，回退到手动刷新:', e);
    }

  updateChildTitle();
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

// 动态更新页面标题，跟随孩子名
function updateChildTitle() {
  var childName = null;
  try { childName = sessionStorage.getItem('papacheck_child_name'); } catch (e) { console.warn('[app] sessionStorage 读取失败:', e); }
  document.title = childName ? 'PapaCheck · ' + childName : 'PapaCheck';
}
