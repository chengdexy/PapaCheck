# PapaCheck 微信公众号周报 Skill

## 触发方式

用户说「发周报」「公众号周报」「推送周报」时触发。

## 执行流程

### Step 1：确定时间范围

读取 `docs/CHANGELOG.md`，找到 `[Unreleased]` 区段和最近一个有日期的版本。

- 如果是补齐历史：从第一个版本开始，每次处理一个版本
- 如果是日常使用：处理 `[Unreleased]` 区段

### Step 2：读取数据源

读取以下内容：
- `docs/CHANGELOG.md` 中对应版本区段的 Added、Changed、Fixed
- `docs/PROGRESS.md` 中「当前版本」和「最近变更」表格
- `README.md` 中的版本号和测试数量
- `git log --oneline` 对应日期范围的提交记录

### Step 3：生成文章

以亲子风撰写文章，然后通过 gen-weekly.cjs 转为微信兼容 HTML，按以下结构：

```
📅 PapaCheck 开发周报 — [日期范围]

### 💬 爸爸的话

> [2-3 句温暖的亲子风开场白，说说这周为什么做这些改动，和孩子有什么关系]

### 🆕 本周新变化

- [从 Added 和 Changed 提取，用「我们」的口吻，每项一行]

### 🔧 修了什么 Bug

- [从 Fixed 提取，用轻松的语气解释修了什么]

### 📊 项目数据

- 测试数量：[从 README 提取]
- 当前版本：[从 README 提取]
- [其他有趣的数字]

### 🎯 下一步计划

- [从 PROGRESS 待开发提取 2-3 项]

---

❤️ 每一个 commit，都是为了让你用得更好。
```

### 写作风格要求

- 用「爸爸」第一人称，像在给孩子讲故事
- 技术细节翻译成通俗语言（比如「修复轮询 Bug」→「你点完评级不用再等了」）
- 每段 2-4 句，保持轻松
- 不要用「优化」「重构」这类枯燥词，用「改进」「打磨」
- 最后一段永远是对孩子的寄语

### Step 4：生成微信 HTML

将 Markdown 文章通过 gen-weekly.cjs 转为微信兼容 HTML：

```powershell
cd e:\trae_projects\PapaCheck\PapaCheck.WeChat
# 将 Markdown 写入临时文件，转为 HTML
$md = @"
[完整的 Markdown 内容]
"@
$html = $md | node gen-weekly.cjs
# 将 HTML 保存为文件，方便复制
$html | Set-Content -Path weekly-output.html -Encoding UTF8
```

### Step 5：交给用户

将生成的 HTML 文件路径告知用户，并给出发布步骤：

1. 打开 `PapaCheck.WeChat\weekly-output.html`，复制全部内容
2. 登录微信公众号后台 → 草稿箱 → 新建图文消息
3. 在编辑器工具栏点击「HTML」按钮，粘贴 HTML 代码
4. 回到可视化编辑模式，确认排版无误
5. 添加封面图（用 `PapaCheck.WeChat\cover.jpg`）
6. 填写摘要，点击「保存为草稿」或直接「群发」

### 一次性补齐历史

用户说「补齐历史周报」时，从 CHANGELOG 中最早的版本开始，批量生成所有未覆盖的周报，每篇保存为独立文件（如 `weekly-2026-03-w1.html`），供用户逐篇发布。
