export const API_BASE = '/papacheck/api';

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
  if (childId && !/\/api\/(shop|bounty-tasks|settings|reward-box|notifications|ping|version|pregen-speech|speak|admin\/(members|invite|roles)|auth\/)/.test(url)) {
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
  if (resp.status === 204 || resp.status === 205) return null;
  return await resp.json();
}

// ========== 数据获取 ==========

export async function getData(childId) {
  if (typeof window !== 'undefined') window._currentChildId = childId;
  var result = await _fetch(API_BASE + '/data');
  isServerMode = true;
  cachedData = result;
  return result;
}

export async function getTasks(dateKey) {
  return await _fetch(API_BASE + '/tasks/' + dateKey);
}

export async function getHomeworks(dateKey) {
  return await _fetch(API_BASE + '/homeworks/' + dateKey);
}

export async function saveHomeworks(dateKey, list) {
  await _fetch(API_BASE + '/homeworks', {
    method: 'PUT',
    body: JSON.stringify({ dateKey: dateKey, homeworks: list }),
  });
  return true;
}

export async function getSettlement(dateKey) {
  return await _fetch(API_BASE + '/settlement/' + dateKey);
}

export async function saveSettlement(dateKey, settlementData) {
  await _fetch(API_BASE + '/settlement/' + dateKey, {
    method: 'PUT',
    body: JSON.stringify({ settlement: settlementData }),
  });
  return true;
}

export async function updatePoints(action, amount, detail) {
  var result = await _fetch(API_BASE + '/points', {
    method: 'PATCH',
    body: JSON.stringify({ action, amount, detail }),
  });
  return result.balance;
}

export async function getRedemptions() {
  return await _fetch(API_BASE + '/redemptions');
}

export async function saveRedemptions(list) {
  await _fetch(API_BASE + '/redemptions', {
    method: 'PUT',
    body: JSON.stringify({ redemptions: list }),
  });
  return true;
}

export async function clearRedemptionHistory() {
  await _fetch(API_BASE + '/redemptions/fulfilled', { method: 'DELETE' });
  return true;
}

export async function getRewardBox() {
  return await _fetch(API_BASE + '/reward-box');
}

export async function saveRewardBox(items) {
  await _fetch(API_BASE + '/reward-box', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

export async function getSettings() {
  return await _fetch(API_BASE + '/settings');
}

export async function saveSettings(settings) {
  await _fetch(API_BASE + '/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return true;
}

export async function getActiveBuffs() {
  return await _fetch(API_BASE + '/active-buffs');
}

export async function saveActiveBuffs(buffs) {
  await _fetch(API_BASE + '/active-buffs', {
    method: 'PUT',
    body: JSON.stringify({ buffs }),
  });
  return true;
}

export async function getShopItems() {
  return await _fetch(API_BASE + '/shop');
}

export async function saveShopItems(items) {
  await _fetch(API_BASE + '/shop', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

export async function getEfficiency(dateKey) {
  return await _fetch(API_BASE + '/efficiency/' + dateKey);
}

export async function saveEfficiency(dateKey, efficiencyData) {
  await _fetch(API_BASE + '/efficiency/' + dateKey, {
    method: 'PUT',
    body: JSON.stringify({ efficiency: efficiencyData }),
  });
  return true;
}

export async function getFreeTime(dateKey) {
  return await _fetch(API_BASE + '/freetime/' + dateKey);
}

export async function saveFreeTime(dateKey, tasks) {
  await _fetch(API_BASE + '/freetime', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, tasks }),
  });
  return true;
}

export async function deferHomework(dateKey, hwId, action, requestedAt) {
  return await _fetch(API_BASE + '/defer-homework', {
    method: 'POST',
    body: JSON.stringify({ date: dateKey, hwId, action, requestedAt }),
  });
}

export async function getBountyTasks() {
  return await _fetch(API_BASE + '/bounty-tasks');
}

export async function saveBountyTasks(items) {
  await _fetch(API_BASE + '/bounty-tasks', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
  return true;
}

export async function getBountySubmissions(dateKey) {
  return await _fetch(API_BASE + '/bounty-submissions/' + dateKey);
}

export async function saveBountySubmissions(dateKey, submissions) {
  await _fetch(API_BASE + '/bounty-submissions', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, submissions }),
  });
  return true;
}

export async function getBountyCompletions(dateKey) {
  return await _fetch(API_BASE + '/bounty-completions/' + dateKey);
}

export async function saveBountyCompletions(dateKey, completions) {
  await _fetch(API_BASE + '/bounty-completions', {
    method: 'PUT',
    body: JSON.stringify({ dateKey, completions }),
  });
  return true;
}

export async function resetDate(date) {
  return await _fetch(API_BASE + '/reset-date', {
    method: 'POST',
    body: JSON.stringify({ date: date }),
  });
}

// ========== PUT / PATCH / DELETE / HEAD ==========

// ---- 作业 (homeworks) ----

export async function putHomework(id, data) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function patchHomework(id, fields, dateKey) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

export async function deleteHomework(id, dateKey) {
  await _fetch(API_BASE + '/homeworks/' + id, { method: 'DELETE' });
  return true;
}

export async function headHomework(id) {
  try {
    var resp = await fetch(API_BASE + '/homeworks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 结算 (settlement) ----

export async function putSettlement(dateKey, data) {
  await _fetch(API_BASE + '/settlement/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function patchSettlement(dateKey, fields) {
  await _fetch(API_BASE + '/settlement/' + dateKey, { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

// ---- 积分 (points) ----

export async function patchPoints(delta) {
  var result = await _fetch(API_BASE + '/points', { method: 'PATCH', body: JSON.stringify(delta) });
  return result.balance;
}

// ---- 商店 (shop) ----

export async function putShopItem(id, data) {
  await _fetch(API_BASE + '/shop/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function deleteShopItem(id) {
  await _fetch(API_BASE + '/shop/' + id, { method: 'DELETE' });
  return true;
}

export async function headShopItem(id) {
  try {
    var resp = await fetch(API_BASE + '/shop/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 兑换 (redemptions) ----

export async function putRedemption(id, data) {
  await _fetch(API_BASE + '/redemptions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 奖励箱 (reward-box) ----

export async function putRewardBoxItem(id, data) {
  await _fetch(API_BASE + '/reward-box/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function deleteRewardBoxItem(id) {
  await _fetch(API_BASE + '/reward-box/' + id, { method: 'DELETE' });
  return true;
}

// ---- 设置 (settings) ----

export async function putSettings(data) {
  await _fetch(API_BASE + '/settings', { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function patchSettings(fields) {
  await _fetch(API_BASE + '/settings', { method: 'PATCH', body: JSON.stringify(fields) });
  return true;
}

// ---- Buff (active-buffs) ----

export async function putBuff(id, data) {
  await _fetch(API_BASE + '/active-buffs/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function deleteBuff(id) {
  await _fetch(API_BASE + '/active-buffs/' + id, { method: 'DELETE' });
  return true;
}

// ---- 效率 (efficiency) ----

export async function putEfficiency(dateKey, data) {
  await _fetch(API_BASE + '/efficiency/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 自由时间 (freetime) ----

export async function putFreeTimeTask(id, data) {
  await _fetch(API_BASE + '/freetime/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 赏金任务 (bounty-tasks) ----

export async function putBountyTask(id, data) {
  await _fetch(API_BASE + '/bounty-tasks/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export async function deleteBountyTask(id) {
  await _fetch(API_BASE + '/bounty-tasks/' + id, { method: 'DELETE' });
  return true;
}

export async function headBountyTask(id) {
  try {
    var resp = await fetch(API_BASE + '/bounty-tasks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---- 赏金提交 (bounty-submissions) ----

export async function putBountySubmission(id, data) {
  await _fetch(API_BASE + '/bounty-submissions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

// ---- 赏金完成 (bounty-completions) ----

export async function putBountyCompletion(id, data) {
  await _fetch(API_BASE + '/bounty-completions/' + id, { method: 'PUT', body: JSON.stringify(data) });
  return true;
}

export function migrateBountyCompletionsToTotal(data) {
  if (!data || !data.bountyCompletions) return data;
  var comps = data.bountyCompletions;
  if (comps._total) return data;
  var total = {};
  for (var dk of Object.keys(comps)) {
    var entry = comps[dk];
    if (entry && typeof entry === 'object') {
      for (var tid of Object.keys(entry)) {
        if (tid === 'uuid' || tid === 'lastModified' || tid === 'isDeleted' || tid === '_table' || tid === 'date') continue;
        var v = entry[tid];
        var delta = typeof v === 'number' ? v : (v ? 1 : 0);
        total[tid] = (total[tid] || 0) + delta;
      }
    }
  }
  comps._total = total;
  if (Object.keys(total).length > 0) {
    saveBountyCompletions('_total', total).catch(function () { });
  }
  return data;
}

// ---- 通知 (notifications) ----

export async function announce(text) {
  return await _fetch(API_BASE + '/notify', { method: 'POST', body: JSON.stringify({ text }) });
}

export async function getPendingNotifications() {
  return await _fetch(API_BASE + '/notify/pending');
}

export async function consumeNotifications(ids) {
  return await _fetch(API_BASE + '/notify/consumed?ids=' + encodeURIComponent(ids.join(',')), { method: 'DELETE' });
}

// ========== 向后兼容：聚合为 API 对象 ==========

const API = {
  API_BASE,
  _childQuery,
  _fetch,
  getData,
  getTasks,
  getHomeworks,
  saveHomeworks,
  getSettlement,
  saveSettlement,
  updatePoints,
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
  migrateBountyCompletionsToTotal,
  announce,
  getPendingNotifications,
  consumeNotifications,
};

export { API };
