const API_BASE = '/papacheck/api';

function getAuthHeaders() {
  try {
    const token = sessionStorage.getItem('papacheck_token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
  } catch (e) {
    return {};
  }
}

let isServerMode = false;
let cachedData = null;

function _childQuery() {
  var childId = (typeof window !== 'undefined') ? window._currentChildId : undefined;
  return childId ? '?child_id=' + encodeURIComponent(childId) : '';
}

async function _fetch(url, options) {
  if (!options) options = {};
  var method = options.method || 'GET';
  var fetchOptions = { ...options };
  // 自动附加 child_id 到 per-child API
  var childId = (typeof window !== 'undefined') ? window._currentChildId : undefined;
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  if (childId && !/\/api\/(data-version|shop|bounty-tasks|settings|reward-box|notifications|ping|version|pregen-speech|speak|admin\/(members|invite|roles)|auth\/)/.test(url)) {
    url += sep + 'child_id=' + encodeURIComponent(childId);
  }
  // DELETE 请求没有 body，不设置 Content-Type，避免 Fastify 报空 JSON body 错误
  if (method !== 'DELETE') {
    if (!fetchOptions.headers) fetchOptions.headers = {};
    if (!fetchOptions.headers['Content-Type']) {
      fetchOptions.headers['Content-Type'] = 'application/json';
    }
  }
  // 注入 Bearer token
  if (!fetchOptions.headers) fetchOptions.headers = {};
  Object.assign(fetchOptions.headers, getAuthHeaders());
  var resp = await fetch(url, fetchOptions);
  // 未认证，跳转到登录页
  if (resp.status === 401) {
    window.location.href = '/papacheck/app/login.html?redirect=' + encodeURIComponent(window.location.pathname);
    throw new Error('unauthorized');
  }
  if (!resp.ok) throw new Error(resp.statusText);
  // 写操作成功后触发 burst：本端立即提速轮询，让所有端尽快感知本次变更
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      if (typeof window !== 'undefined' && window._realtimeManager) {
        window._realtimeManager.bump();
      }
    } catch (e) { /* ignore */ }
  }
  if (resp.status === 204 || resp.status === 205) return null;
  return await resp.json();
}

// ========== 数据获取 ==========

async function getData(childId) {
  if (typeof window !== 'undefined') window._currentChildId = childId;
  var result = await _fetch(API_BASE + '/data');
  isServerMode = true;
  cachedData = result;
  return result;
}

// 轻量数据版本戳：仅返回 { version }（几十字节），用于条件短轮询
async function getDataVersion() {
  return await _fetch(API_BASE + '/data-version');
}

async function getTasks(dateKey) {
  return await _fetch(API_BASE + '/tasks/' + dateKey);
}

async function getHomeworks(dateKey) {
  return await _fetch(API_BASE + '/homeworks/' + dateKey);
}

async function saveHomeworks(dateKey, list) {
  await _fetch(API_BASE + '/homeworks', {
    method: 'PUT',
    body: JSON.stringify({ dateKey: dateKey, homeworks: list }),
  });
  return true;
}

async function getSettlement(dateKey) {
  return await _fetch(API_BASE + '/settlement/' + dateKey);
}

async function saveSettlement(dateKey, settlementData) {
  await _fetch(API_BASE + '/settlement/' + dateKey, {
    method: 'PUT',
    body: JSON.stringify({ settlement: settlementData }),
  });
  return true;
}

async function updatePoints(action, amount, detail) {
  var result = await _fetch(API_BASE + '/points', {
    method: 'PATCH',
    body: JSON.stringify({ action, amount, detail }),
  });
  return result.balance;
}

async function getRedemptions() {
  return await _fetch(API_BASE + '/redemptions');
}

async function saveRedemptions(list) {
  await _fetch(API_BASE + '/redemptions', {
    method: 'PUT',
    body: JSON.stringify({ redemptions: list }),
  });
  return true;
}

async function clearRedemptionHistory() {
  await _fetch(API_BASE + '/redemptions/fulfilled', { method: 'DELETE' });
  return true;
}

async function getRewardBox() {
  return await _fetch(API_BASE + '/reward-box');
}

async function saveRewardBox(items) {
  await _fetch(API_BASE + '/reward-box', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

async function getSettings() {
  return await _fetch(API_BASE + '/settings');
}

async function saveSettings(settings) {
  await _fetch(API_BASE + '/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return true;
}

async function getActiveBuffs() {
  return await _fetch(API_BASE + '/active-buffs');
}

async function saveActiveBuffs(buffs) {
  await _fetch(API_BASE + '/active-buffs', {
    method: 'PUT',
    body: JSON.stringify({ buffs }),
  });
  return true;
}

async function getShopItems() {
  return await _fetch(API_BASE + '/shop');
}

async function saveShopItems(items) {
  await _fetch(API_BASE + '/shop', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

async function getEfficiency(dateKey) {
  return await _fetch(API_BASE + '/efficiency/' + dateKey);
}

async function saveEfficiency(dateKey, efficiencyData) {
  await _fetch(API_BASE + '/efficiency/' + dateKey, {
    method: 'PUT',
    body: JSON.stringify({ efficiency: efficiencyData }),
  });
  return true;
}

async function getFreeTime(dateKey) {
  return await _fetch(API_BASE + '/freetime/' + dateKey);
}

async function saveFreeTime(dateKey, tasks) {
  await _fetch(API_BASE + '/freetime', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, tasks }),
  });
  return true;
}

async function deferHomework(dateKey, hwId, action, requestedAt) {
  return await _fetch(API_BASE + '/defer-homework', {
    method: 'POST',
    body: JSON.stringify({ date: dateKey, hwId, action, requestedAt }),
  });
}

async function getBountyTasks() {
  return await _fetch(API_BASE + '/bounty-tasks');
}

async function saveBountyTasks(items) {
  await _fetch(API_BASE + '/bounty-tasks', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

async function getBountySubmissions(dateKey) {
  return await _fetch(API_BASE + '/bounty-submissions/' + dateKey);
}

async function saveBountySubmissions(dateKey, submissions) {
  await _fetch(API_BASE + '/bounty-submissions', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, submissions }),
  });
  return true;
}

async function getBountyCompletions(dateKey) {
  return await _fetch(API_BASE + '/bounty-completions/' + dateKey);
}

async function saveBountyCompletions(dateKey, completions) {
  await _fetch(API_BASE + '/bounty-completions', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, completions }),
  });
  return true;
}

// ---- 按需获取（客户端数据按需获取重构）----

// 跨天聚合统计：GET /api/stats?range=week|month|all
async function getStats(range) {
  return await _fetch(API_BASE + '/stats?range=' + encodeURIComponent(range || 'all'));
}

// 积分余额：GET /api/points/balance
async function getPointsBalance() {
  return await _fetch(API_BASE + '/points/balance');
}

// 赏金完成汇总：GET /api/bounty-completions/total
// 替代旧 migrateBountyCompletionsToTotal（该汇总已改为服务端聚合，见设计 §C.1.2）。
async function getBountyCompletionsTotal() {
  return await _fetch(API_BASE + '/bounty-completions/total');
}

async function resetDate(date) {
  return await _fetch(API_BASE + '/reset-date', {
    method: 'POST',
    body: JSON.stringify({ date: date }),
  });
}

// ========== PUT / PATCH / DELETE / HEAD ==========

// ---- 作业 (homeworks) ----

async function putHomework(id, data) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function patchHomework(id, fields, dateKey) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

async function deleteHomework(id, dateKey) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'DELETE' });
  return true;
}

async function headHomework(id) {
  try {
    var resp = await fetch(API_BASE + '/homeworks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 结算 (settlement) ----

async function putSettlement(dateKey, data) {
  await _fetch(API_BASE + '/settlement/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function patchSettlement(dateKey, fields) {
  await _fetch(API_BASE + '/settlement/' + dateKey, { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

// ---- 积分 (points) ----

async function patchPoints(delta) {
  var result = await _fetch(API_BASE + '/points', { method: 'PATCH', body: JSON.stringify(delta) });
  return result.balance;
}

// ---- 商店 (shop) ----

async function putShopItem(id, data) {
  await _fetch(API_BASE + '/shop/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function deleteShopItem(id) {
  await _fetch(API_BASE + '/shop/' + id, { method: 'DELETE' });
  return true;
}

async function headShopItem(id) {
  try {
    var resp = await fetch(API_BASE + '/shop/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 兑换 (redemptions) ----

async function putRedemption(id, data) {
  await _fetch(API_BASE + '/redemptions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 奖励箱 (reward-box) ----

async function putRewardBoxItem(id, data) {
  await _fetch(API_BASE + '/reward-box/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function deleteRewardBoxItem(id) {
  await _fetch(API_BASE + '/reward-box/' + id, { method: 'DELETE' });
  return true;
}

// ---- 设置 (settings) ----

async function putSettings(data) {
  await _fetch(API_BASE + '/settings', { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function patchSettings(fields) {
  await _fetch(API_BASE + '/settings', { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

// ---- Buff (active-buffs) ----

async function putBuff(id, data) {
  await _fetch(API_BASE + '/active-buffs/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function deleteBuff(id) {
  await _fetch(API_BASE + '/active-buffs/' + id, { method: 'DELETE' });
  return true;
}

// ---- 效率 (efficiency) ----

async function putEfficiency(dateKey, data) {
  await _fetch(API_BASE + '/efficiency/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 自由时间 (freetime) ----

async function putFreeTimeTask(id, data) {
  await _fetch(API_BASE + '/freetime/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 赏金任务 (bounty-tasks) ----

async function putBountyTask(id, data) {
  await _fetch(API_BASE + '/bounty-tasks/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

async function deleteBountyTask(id) {
  await _fetch(API_BASE + '/bounty-tasks/' + id, { method: 'DELETE' });
  return true;
}

async function headBountyTask(id) {
  try {
    var resp = await fetch(API_BASE + '/bounty-tasks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 赏金提交 (bounty-submissions) ----

async function putBountySubmission(id, data) {
  await _fetch(API_BASE + '/bounty-submissions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 赏金完成 (bounty-completions) ----

async function putBountyCompletion(id, data) {
  await _fetch(API_BASE + '/bounty-completions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 通知 (notifications) ----

async function announce(text) {
  return await _fetch(API_BASE + '/notify', { method: 'POST', body: JSON.stringify({ text }) });
}

async function getPendingNotifications() {
  return await _fetch(API_BASE + '/notify/pending');
}

async function consumeNotifications(ids) {
  return await _fetch(API_BASE + '/notify/consumed?ids=' + encodeURIComponent(ids.join(',')), { method: 'DELETE' });
}

// ========== 向后兼容：聚合为 API 对象 ==========

const API = {
  API_BASE,
  _childQuery,
  _fetch,
  getData,
  getDataVersion,
  getTasks,
  getHomeworks,
  getStats,
  saveHomeworks,
  getSettlement,
  saveSettlement,
  updatePoints,
  getPointsBalance,
  getRedemptions,
  saveRedemptions,
  clearRedemptionHistory,
  getRewardBox,
  saveRewardBox,
  getSettings,
  saveSettings,
  getActiveBuffs,
  saveActiveBuffs,
  getShopItems,
  saveShopItems,
  getEfficiency,
  saveEfficiency,
  getFreeTime,
  saveFreeTime,
  deferHomework,
  getBountyTasks,
  saveBountyTasks,
  getBountySubmissions,
  saveBountySubmissions,
  getBountyCompletions,
  getBountyCompletionsTotal,
  saveBountyCompletions,
  resetDate,
  putHomework,
  patchHomework,
  deleteHomework,
  headHomework,
  putSettlement,
  patchSettlement,
  patchPoints,
  putShopItem,
  deleteShopItem,
  headShopItem,
  putRedemption,
  putRewardBoxItem,
  deleteRewardBoxItem,
  putSettings,
  patchSettings,
  putBuff,
  deleteBuff,
  putEfficiency,
  putFreeTimeTask,
  putBountyTask,
  deleteBountyTask,
  headBountyTask,
  putBountySubmission,
  putBountyCompletion,
  announce,
  getPendingNotifications,
  consumeNotifications,
};

window.API = API;
