# 家长端「二次进入数据未加载」根因与修复

## 现象
- 清数据后首次进入：login → 填 access_code → 家长端，**数据正常显示**。
- 不清数据、再次进入 app：页面框架和 CSS 在，但被「正在加载数据…」遮罩覆盖，**数据不显示**（遮罩 5s 后自动隐藏，只剩空框架）。

## 根因
差异只发生在「进入家长端 admin 页之前的页面跳转链」：

| 进入方式 | 跳转来源 | 实际到达的 admin 页 | 结果 |
|---|---|---|---|
| 首次登录 | `login.html` 的 exchange 成功分支（第 217 行） | `/papacheck/app/admin.html`（**正确版**，含 `data-layer.js`） | ✅ 数据正常 |
| 二次进入（有持久化 token） | `login.html` 的「已有 token 自动跳转」分支（第 234 行） | `/papacheck/admin.html`（**根路径旧版**，缺 `data-layer.js`） | ❌ 数据不加载 |

- 根路径的 `/papacheck/admin.html` 是**早期部署遗留的旧文件**：HTML 里漏了 `<script src="js/data-layer.js"></script>`，而该脚本正是定义全局 `window.Data` 的文件（curl 逐字节 diff 确认：根版无 `data-layer.js`、多一个 `connStatus` 元素；`/app/` 版有）。
- 后果：`admin.js` 的 `initAdmin()` 执行到 `await Data.bootstrap('admin')` 时 `Data is not defined` → 抛 ReferenceError → 数据永远拉不到；遮罩 5s 后自动隐藏，于是表现为「框架在、数据没加载」。
- 后端所有端点统一从 JWT 取身份（tenant_id/child_id），首次与二次请求完全一致，**排除后端问题**。

## 修复（已部署生产）
1. `login.html` 自动跳转分支家长端目标：
   `/papacheck/admin.html` → `/papacheck/app/admin.html`（与 exchange 成功分支对齐）。
   同时修正了 `_web_deploy/login.html`、`deploy-papacheck/app/login.html` 两个部署副本（其中 `deploy-papacheck` 的 exchange 成功分支 217 行也是错的，一并修）。
2. 根 `/papacheck/admin.html` 旧文件用正确版本（含 `data-layer.js`）**覆盖**，消除「缺脚本」隐患且不制造 404。

## 部署与验证
- 部署：`cd PapaCheck.Web` 后
  `tcb hosting deploy login.html papacheck/app/login.html --env-id child-teacher-parent-d9aef9d2208`
  `tcb hosting deploy admin.html papacheck/admin.html --env-id child-teacher-parent-d9aef9d2208`
- 验证（强制回源 `Cache-Control: no-cache`）：
  - 生产 `/papacheck/app/login.html` 的自动跳转已指向 `/papacheck/app/admin.html` ✅
  - 根 `/papacheck/admin.html` 现已含 `data-layer.js`（grep 命中）✅

## 你需要做的
- **无需重新打包 APK**——修复在网页端；已装的 1.6.8 的 `clearCache()` 保证二次进入会拉取最新网页。
- 请「清空数据」后再次进入家长端复测。注意 CloudBase CDN 边缘缓存约数分钟刷新，若仍看到旧表现，等几分钟或强制刷新即可。

## 遗留建议
- 根 `/papacheck/` 下可能还有迁移残留的旧文件（例如旧 login.html / index.html）。本次只修了 admin，建议后续用 `tcb hosting list` 排查根目录「幽灵文件」并清理，避免再踩「跳错页」的坑。
