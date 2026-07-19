# TTS 502 / 音频丢失 / 赏金任务一闪而过 修复（2026-07-20）

按需加载重构后连续暴露的三个 bug，根因都在重构引入的链路里。

## Bug 1: pregen-speech / speak 502 `CloudBase SDK not initialized`

### 现象
- `POST /api/pregen-speech` 返回 502 `{"error":"CloudBase SDK not initialized"}`（41 字节）
- `GET /api/speak` 同样 502，孩子端无语音播报

### 根因（之前判断错误，真因如下）
`@cloudbase/node-sdk@4.0.3` 的 `dist/index.js` 实际是 `require('@cloudbase/js-sdk')`——**前端/小程序 SDK 的包装**。在 Node SCF 里 `tcb.init()` 给 getter-only 的 `cloudbaseConfig` 赋值必抛 `Cannot set property cloudbaseConfig of #<e3> which has only a getter`。`tcb fn log` 暴露真因。

版本分界：
- `4.0.x`：js-sdk 包装，Node 环境必坏
- `3.2.0+`：依赖 `@cloudbase/wx-cloud-client-sdk`（前端内核），同样问题
- `3.0.0 / 3.1.0`：纯 `@cloudbase/database` + `@cloudbase/signature-nodejs`，**唯一可用**

之前两次"修复 502"提交只改 `ensureCloudBaseApp` 的 `_cloudBaseReady` 逻辑+加日志，让错误从静默变可见，但没碰 SDK 本体——根因是依赖版本选错。pregen-speech/speak 从未真正工作过。

### 修复
- `package.json`: `@cloudbase/node-sdk` 从 `^4.0.3` 降到精确 `"3.1.0"`（不用 `^` 防升 3.2+）
- `build.mjs`: 加 esbuild `onLoad` plugin，把 `@cloudbase/node-sdk/dist/utils/version.js` 替换为 `exports.version = "3.1.0"` 硬编码。原因：3.1.0 的 `loadPackage()` 用 `path.join(__dirname, '../../package.json')` 读版本号，esbuild bundle 后 `__dirname`=/var/user，`../../package.json` 解析到 `/package.json` 抛 ENOENT 阻断整个 node-sdk 加载。该 version 仅用于 HTTP `User-Agent` 头，无功能影响。

## Bug 2: speak 返回 200 但音频 body 丢失（ERR_CONTENT_LENGTH_MISMATCH）

### 现象
- Bug 1 修复后 speak 返回 200 `audio/mp3`，但浏览器报 `ERR_CONTENT_LENGTH_MISMATCH`
- curl 实测 `content-length: 10080` 但 `size_download: 0`（body 为空）

### 根因
`handler-body.ts` 的 `app.inject` 默认 `res.body` 是 UTF-8 string。speak 路由 `reply.send(audioBuffer)` 返回二进制 MP3，被 light-my-request 当 UTF-8 解码后字节损坏，SCF 网关无法传输 → body 丢失，Content-Length 头还在 → mismatch。

`responseType: 'buffer'` 选项 light-my-request 5.14.0 **不支持**（源码无此选项）。

### 修复
`handler-body.ts`:
- inject 后用 `res.rawPayload`（始终是原始 Buffer，定义在 light-my-request/lib/response.js:134）
- 按 Content-Type 区分：文本/JSON → `toString('utf-8')` + `isBase64Encoded:false`；二进制（audio/* 等）→ `toString('base64')` + `isBase64Encoded:true` 让 SCF 网关解码回二进制传输

### 验证
curl speak 保存文件，`size=10080` 与 content-length 匹配，前 16 字节 `ff f3 64 c4 ... LAME` 是真实 MP3 帧同步字。JSON API 回归正常。

## Bug 3: 赏金任务"一闪而过"

### 现象
- 孩子端开始赏金任务，任务框显示后立即消失
- 语音播报正常（Bug 1/2 已修），控制台无报错，网络请求全 200

### 根因（dateKey 时区错位）
`startBountyTask`（big-screen.js:839）创建 `newSubmission` 时**不带 dateKey 字段**。后端 `putBountySubmission`（postgres-adapter.ts:1349）在 `data.dateKey` 缺失时回退 `new Date().toISOString().slice(0,10)` = **UTC 日期**；前端 `Util.dateKey` 用 `getFullYear/getMonth/getDate` = **本地日期**。

凌晨 0-8 点（GMT+8）UTC 比本地早一天，连锁反应：
1. PUT 写入 dateKey=`2026-07-19`（UTC 回退）
2. 前端本地缓存用 dateKey=`2026-07-20`，任务框显示
3. `_fetch` 自动调 `realtime.bump()`（api.js:73-78，任何非 GET 成功后触发）→ 200ms 后检查 data-version → PUT 已更新版本 → 触发 `refreshFromServer` → GET `/api/bounty-submissions/2026-07-20` 读不到新记录（写在 2026-07-19）
4. cachedData 被服务器返回覆盖，任务框消失

### 修复
`big-screen.js:839` newSubmission 显式加 `dateKey` 字段（变量在 818 行已定义）。后端走 `data.dateKey` 不再回退 UTC。其他三处 putBountySubmission（abandon/复用/提交）操作已有 sub，走后端 existing 分支用 `existing.dateKey`，不受影响。

## 改动文件
- `PapaCheck.CloudFunc/papacheck-api/package.json` — node-sdk 锁 3.1.0
- `PapaCheck.CloudFunc/papacheck-api/build.mjs` — tcbVersionShim plugin
- `PapaCheck.CloudFunc/papacheck-api/handler-body.ts` — rawPayload + isBase64Encoded
- `PapaCheck.Web/js/big-screen.js` — newSubmission 带 dateKey

## 已知隐患（待修）
- 后端 `putBountySubmission` 的 dateKey 回退仍是 UTC（`toISOString`），前端传了就不触发，但其他调用方不传会在凌晨错位。建议改为本地时区日期（SCF 配了 TZ=Asia/Shanghai）。
- `putBountyCompletion`（postgres-adapter.ts:1371）用 `id` 当 dateKey 传给 `_setDateData`，疑似另一个 bug。
