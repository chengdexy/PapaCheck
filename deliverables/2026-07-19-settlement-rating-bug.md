# 家长端收不到孩子端评级申请 / 孩子端卡在"等待评级" 根因与修复

日期：2026-07-19
严重度：高（阻断孩子端当日流程，家长端无法评级）

## 现象
- 孩子端（Android 1.6.7，后升 1.6.8）提交当日作业评级后，界面停在「作业已提交，等待评级…」，且无法离开。
- 家长端（浏览器 admin）始终看不到这条待评级申请，因此无法评级，孩子端永久等待。
- 数据库 `daily_settlement` 中该提交已存在：`{"dailyBase":50,"homeworkBonus":50,"totalBeforeRating":100,"doneCount":7,"rating":null,"multiplier":null,"finalPoints":null,"submittedAt":"21:24","ratedAt":null}` —— 即**写入成功**，问题在读取侧。

## 根因
数据按需获取（on-demand）重构时，`data-layer.js` 的 `loadAdminDay`（家长端单日加载器）只加载了
`bountySubmissions + homeworks`，**遗漏了 `settlement`（`dailySettlement`）**。

但 `admin.js:308` 判定「待评级」提醒依赖：
```js
const settlement = cachedData?.dailySettlement?.[submittedDate];
const needsRating = settlement && settlement.submittedAt && !settlement.rating;
```
由于 `loadAdminDay` 从不填充 `cachedData.dailySettlement`，家长端该字段恒为空 → `needsRating` 永远为 `false`
→ 家长端从不展示「去评级」按钮 → 永不评级 → 孩子端等待界面永不解除。

注意：这是**读取侧遗漏**，不是写入失败，也不是 child_id 隔离问题（写入的 settlement 的 child_id 与
家长端 JWT 的 child_id 一致，GET /api/settlement/:date 能正确返回）。

版本戳机制本身正常：`saveSettlement` 会 `recordModification('daily_settlement', …)` 更新 `last_modified`
（租户级），家长端 `RealtimeManager` 轮询 `/api/data-version` 能检测到变化并触发 `refreshCurrentView`
→ `loadAdminDay`。但因 `loadAdminDay` 仍不取 settlement，刷新也取不到，形成死结。

## 修复
`PapaCheck.Web/js/data-layer.js` 的 `loadAdminDay` 增加 `API.getSettlement(dateKey)`，与其他端（child / bigscreen）
保持一致：
```js
async function loadAdminDay(dateKey) {
  await _withFallback(async function () {
    const [bs, hw, st] = await Promise.all([
      API.getBountySubmissions(dateKey),
      API.getHomeworks(dateKey),
      API.getSettlement(dateKey),
    ]);
    const snap = _ensureSnapshot();
    if (bs !== undefined && bs !== null) snap.bountySubmissions[dateKey] = bs;
    if (hw !== undefined && hw !== null) snap.homeworks[dateKey] = hw;
    if (st !== undefined && st !== null) snap.dailySettlement[dateKey] = st; // 关键修复
  });
}
```
`_withFallback` 保证按需端点失败时回退全量 `/api/data`（本身含 dailySettlement），无回归风险。

已部署生产：`tcb hosting deploy js/data-layer.js papacheck/app/js/data-layer.js`，验证线上文件
`API.getSettlement(dateKey)` 调用数从 2 变为 3（child + bigscreen + admin）。

## 对孩子端卡死的解释
孩子端 `refreshFromServer`（RealtimeManager 回调）→ `Data.refreshCurrentView()` → `loadChildDay`
（本就加载 settlement）。家长评级后 `daily_settlement` 变更使版本戳变化，孩子端轮询检测到 → 重新拉取
settlement（此时 `rating` 已填）→ 等待界面转为已评级/积分结算界面，**自动解除**。故根因修复后，
孩子端无需改动即可自动解锁。

## 用户侧即时恢复步骤（针对已卡住的真实用户）
1. **家长端硬刷新** admin 页面（Ctrl+Shift+R / 无痕），绕过 CDN 边缘缓存，加载新 `data-layer.js`。
2. 当日「作业」标签页会出现「⚠️ 待评级: 1 项 → 去评级」，点击完成评级。
3. 孩子端在数秒内（realtime 轮询 ~3s）自动解除等待界面，显示积分结算。

无需重新打包 APK —— 本次为纯网页端修复；1.6.8 的 `clearCache()` 保证孩子端下次启动拉取最新网页。

## 可选增强（未做，按需）
孩子端等待界面目前只能等家长评级来解除，若家长长时间不在线会硬锁。可在等待界面加「稍后 / 退出」
按钮作为兜底出口（属行为变更，未在未授权下添加）。
