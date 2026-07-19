# CloudBase 操作手册（PapaCheck 生产环境）

> 环境 ID：`child-teacher-parent-d9aef9d2208`
> CLI：`tcb` (CloudBase CLI 3.5.9)，已登录
> 自定义域名：`chengdexy.cn`（前端 `/papacheck/app/`、API `/papacheck/api/`）
> 默认域名：`https://child-teacher-parent-d9aef9d2208-1253991009.tcloudbaseapp.com`
> 整理日期：2026-07-19（经腾讯云 API 专家实证）

## 0. 三个子系统的边界（最容易搞混）

| 子系统 | CLI 模块 | 云端路径 | 对外访问 |
|---|---|---|---|
| **云函数**（后端） | `tcb fn` | — | `/papacheck/api/*` |
| **静态托管**（前端 HTML/CSS/JS） | `tcb hosting` | 相对托管根，本项目落在 `papacheck/app/...` | `/papacheck/app/*` |
| **云存储**（APK 等二进制） | `tcb storage` | 本项目落在 `dist/...` | `*.tcb.qcloud.la/dist/...` 或默认域名 `/papacheck/dist/...` |

APK 下载链接在 `cloudbaserc.json` 的 `APK_CDN_URL` 里，由 `/api/download` 302 跳转。
前端和存储是**两个不同产品**，删除命令不能混用。

---

## 1. 云函数部署（✅ 本机可用）

```bash
cd PapaCheck.CloudFunc/papacheck-api
node build.mjs                       # 先构建（需 JWT_SECRET 环境变量；dev 缺省随机，prod 必填）
tcb fn deploy papacheck-api --dir dist --force
```
- `--dir dist` 必填（不带则从 `functions/<name>` 找，报错）。
- `--force` 跳过交互式 overwrite 确认（非交互环境必需）。
- `dist/cloudbaserc.json` 含全部 6 个生产环境变量（JWT_SECRET/DATABASE_URL/JWT_EXPIRES_IN/APK_VERSION/APK_CDN_URL/TZ）+ `vpc` 配置，`--force` 整体覆盖，改版本号时一并改 APK_VERSION/APK_CDN_URL。
- runtime 锁定 `Nodejs18.15`，**不要升 20.x**；漏 `vpc` 会 redeploy 后连不上内网 PG。

---

## 2. 静态托管部署（⚠️ 必须排除 node_modules）

**推荐：用加固后的 `deploy.bat`（自动防污染）**
```bat
cd PapaCheck.Web
deploy.bat                          :: 默认环境 child-teacher-parent-d9aef9d2208
deploy.bat <envId>                  :: 指定环境
```
脚本逻辑：白名单拷贝 5 个 html + css/ + js/ 到 `%TEMP%/papacheck_web_deploy` 临时目录，
**部署前递归删除临时目录里的 `node_modules/__tests__/.vite/tts_cache` 及 `*.log/*.bak/*.test.js`**，
再 `tcb hosting deploy` 该临时目录到 `papacheck/app`。部署完尽力清理临时目录。
→ 无论 `js/` 下是否混入依赖，托管都不会被污染（实测：只上传 14 个白名单文件，无 node_modules）。

**⚠️ 切勿手动 `tcb hosting deploy . papacheck/app` 整目录上传**
实测 `tcb` 3.5.9 **不读取 `.tcbignore`**（明确排除的文件照样上传），`.tcbignore` 毫无防护作用。
**唯一安全的部署入口就是 `deploy.bat`**。
- `PapaCheck.Site` 仍可用 `tcb hosting deploy dist papacheck -e <env>`（只传构建产物 dist/，无依赖风险）。
- 若必须手动补传单个文件，用精确路径：`tcb hosting deploy <具体文件> papacheck/app/<对应子路径>`，绝不用 `.`。
**历史事故根因**：曾用 `cp -r js` 整目录上传 → `js/node_modules`(~5000 文件) 被带进托管，列表飙到 7700+ 条。现已杜绝（靠 deploy.bat 白名单，不靠 .tcbignore）。

cloudPath 是**位置参数**（非 `--dir`）：`tcb hosting deploy <localPath> <cloudPath>`。

---

## 3. 静态托管删除（✅ 命令可用，路径要对）

```bash
# 列文件，确认真实云端路径（相对托管根）
tcb hosting list -e child-teacher-parent-d9aef9d2208

# 删单文件
tcb hosting delete <cloudPath> -e child-teacher-parent-d9aef9d2208
# 删文件夹（递归）
tcb hosting delete <cloudPath> --dir --yes -e child-teacher-parent-d9aef9d2208
# 先预览不执行
tcb hosting delete <cloudPath> --dir --dry-run -e child-teacher-parent-d9aef9d2208
```
- **cloudPath 相对托管根**。本项目文件在 `papacheck/app/...`，所以删 `papacheck/app/node_modules`（不是 `node_modules`）。
- 路径不存在时 CLI **静默删 0 个、报成功** → 看起来"删了还在"，实际是路径错。务必先用 `hosting list` 确认真实路径再删。
- `--yes`（非 `--force`）才是跳过确认的实际 flag（dry-run 提示里写的是 `--yes`）。
- **递归删会漏 `.` 开头的隐藏目录**（如 `node_modules/.vite/`）。删完务必再 `hosting list | grep node_modules` 复核；若有遗漏，补删嵌套路径（如 `papacheck/app/js/node_modules`）。

**清理本次污染**（如需要）：
```bash
tcb hosting delete papacheck/app/node_modules --dir --yes -e child-teacher-parent-d9aef9d2208
tcb hosting delete papacheck/app/js/__tests__ --dir --yes -e child-teacher-parent-d9aef9d2208
```

---

## 4. 云存储（APK 等）—— ⚠️ 本机 tcb storage 子命令不可用

**现象**：`tcb storage upload/list/rm` 一律报 `FLAT_CMD_NOT_AVAILABLE_IN_PG`（`__STRING_NOT_TRANSLATED__`）。
**原因**：本环境 tcb 3.5.9 的 storage 子命令在该 env 上下文被禁用（与语法无关，`-e` 正确）。
**存储服务本身正常**：控制台可传，直链可访问。
**正确替代方案**（任选）：
1. **CloudBase 控制台** → 云存储 → 上传（本次 APK 即由此上传，已验证 `dist/PapaCheck-1.6.7.apk` 直链 HTTP 200）。
2. **Node.js SDK**（适合 CI）：
   ```js
   const cloudbase = require('@cloudbase/node-sdk');
   const app = cloudbase.init({ secretId, secretKey, env: 'child-teacher-parent-d9aef9d2208' });
   await app.storage.uploadFile({ cloudPath: 'dist/PapaCheck-1.6.7.apk', fileContent });
   ```
3. 官方文档语法（环境 OK 时可用，本机不可用）：
   `tcb storage upload <localPath> <cloudPath> -e <envId>` / `tcb storage rm <cloudPath> -e <envId>` / `tcb storage list -e <envId>`。

---

## 5. 公网验证清单（每次发布后必跑）

```bash
curl -s https://chengdexy.cn/papacheck/api/version          # → {"clientVersion":"x.y.z"}
curl -sI https://chengdexy.cn/papacheck/api/download | grep -i location   # → 302 到 ...apk
curl -sI https://chengdexy.cn/papacheck/app/ | grep -i '^HTTP'            # → 200
curl -s -H "Cache-Control: no-cache" https://chengdexy.cn/papacheck/app/css/style.css | grep -c "max-width: 480px"  # 新 CSS 是否上线
```
- CDN 会缓存旧响应：验证文件删除/更新时用 `-H "Cache-Control: no-cache"`，或直连默认域名绕过自定义域名 CDN 层。
- 自定义域名返回的 stale 200 不一定是真文件还在，以 `tcb hosting list` 全量列表为准。
