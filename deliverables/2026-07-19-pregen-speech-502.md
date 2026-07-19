# 502 pregen-speech + 偶发 401 data-version 诊断与修复

> 日期：2026-07-19 | 环境：CloudBase SCF（pgstore）<env-id>

## 一、POST /api/pregen-speech 502（真 bug，已修复）

### 现象
家长端浏览器控制台：`POST https://chengdexy.cn/papacheck/api/pregen-speech` → 502 (Bad Gateway)。
`/api/speak`（孩子端 TTS 朗读）走同一调用路径，同样会 502。

### 根因（确认）
`/api/pregen-speech` 路由（app.ts:718）依赖 `getCloudBaseApp()`（来自 cloudbase-ctx.ts），
通过 `tcbApp.callFunction({ name: 'tts-svc', ... })` 调用语音合成云函数。
当 `getCloudBaseApp()` 返回 `null` 时，路由直接 `return 502`（app.ts:727-729）。

**`getCloudBaseApp()` 永远返回 null** —— 因为 `setCloudBaseApp()` 在整个源码里只有定义、
**从未在任何入口被调用**。SCF 真实入口 `handler-body.run`（handler-body.ts）只做 `parseGatewayEvent` +
`buildApp` + `app.inject`，**从不初始化 CloudBaseApp 实例**。cloudbase-ctx.ts 注释写的
"在 index.ts main() 中设置" 与现状不符（index.ts 只是轻量 wrapper，未初始化）。

=> 这是当初把 TTS 从"直连 127.0.0.1"重构为"走 CloudBase callFunction"时埋下的回归：
调用方（pregen-speech / speak）依赖 `getCloudBaseApp()`，但初始化方（setCloudBaseApp）从未接线。

### 排除项
- `tts-svc` 云函数**已部署**（Python3.10，Status: Deployment completed）—— 不是函数缺失。
- 不是临时凭证/网络问题（getCloudBaseApp 为 null 是代码层确定性问题，每次必现）。

### 修复
1. **handler-body.ts**：`run` 开头调用 `ensureCloudBaseApp(context)` 同步初始化 CloudBaseApp：
   ```ts
   import * as tcb from '@cloudbase/node-sdk';
   function ensureCloudBaseApp(context) {
     if (_cloudBaseReady) return;
     const env = (context?.environ?.TCB_ENV) || process.env.TCB_ENV || '';
     if (env) { try { setCloudBaseApp(tcb.init({ env })); } catch(e){ console.error(...); } }
     else { console.error('[cloudbase] TCB_ENV 未设置 ...'); }
     _cloudBaseReady = true;
   }
   ```
   初始化只做一次（首请求触发），后续请求复用，无竞态、无首请求延迟。
2. **cloudbaserc.json**：envVariables 补 `"TCB_ENV": "<env-id>"`（与 JWT_SECRET 同机制注入，
   不写死到源码，符合脱敏）。CloudBase SCF 运行时也可能自动注入 `TCB_ENV`，此条为保险。

### 验证（部署后）
- `dist/handler-body.js` 含 `setCloudBaseApp` 调用（build 后 grep 确认：3 处引用）。
- 部署后查 SCF 日志：无 `[cloudbase] TCB_ENV 未设置` / `SDK 初始化失败` 错误 → 初始化成功。
- 家长端再次触发预生成语音：不再 502。

## 二、GET /api/data-version 401（偶发首帧，低优先级，自愈）

### 现象（用户补充）
401 出现在"从 login 刚跳转到家长端界面时"，**仅 1 次**，之后全部 200。

### 根因（前端首帧竞态，非后端鉴权 bug）
- `_fetch`（api.js:39）每次都注入 `getAuthHeaders()` 的 Bearer token，后端 auth 中间件正常。
- 跳转瞬间，admin 页首次请求（realtime 轮询的 data-version 或 bootstrap 内首个请求）在
  sessionStorage 的 token 写入就绪前发出 → 服务端收不到有效 JWT → 401。
- 之后 token 已就绪，所有请求 200。属自愈型首帧竞态，**不影响功能**。

### 可选优化（未实施，需用户确认是否要）
在 `admin.js` 的 `initAdmin` 开头先 `await` token 就绪（确认 `getAuthHeaders()` 非空）再 `bootstrap`；
或在 realtime 首次轮询前确保身份已加载。因"仅 1 次、自愈、无功能影响"，优先级低，
默认不动以免引入新回归。

## 三、部署
- `build.mjs`（JWT_SECRET 来自 cloudbaserc envVariables）→ `tcb fn deploy papacheck-api --dir dist --env-id <env-id> --force`
- 新增 TCB_ENV 环境变量随部署生效。
