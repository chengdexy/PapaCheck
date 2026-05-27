# PapaCheck 发布工具使用说明

## 简介

`release.py` 是 PapaCheck 项目的一站式发布编排脚本，支持 Windows EXE 和 Android APK 的版本号管理、构建、以及 ZIP 打包。

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Python | 3.8+ |
| Flutter SDK | 3.x+ |
| PyInstaller | 已安装（`pip install pyinstaller`） |

## 快速开始

```bash
# 直接运行即可进入交互式引导模式，按提示回答几个选择题
python release.py

# 也可以直接传参数跳过引导
python release.py --exe-only --no-bump-exe

# 查看帮助信息
python release.py -h
```

## 交互式引导模式（默认）

直接运行 `python release.py`（不带任何参数）即可进入交互式引导模式。

引导流程共 6 步：

| 步骤 | 问题 | 选项 | 默认 |
|------|------|------|------|
| Step 1 | 选择构建目标 | 1) 完整发布 2) 仅 EXE 3) 仅 APK | **2) 仅 EXE** |
| Step 2 | EXE 版本控制 | 1) patch 2) minor 3) major 4) 手动 5) 不变 | **5) 不变** |
| Step 3 | APK 版本控制 | 1) patch 2) minor 3) major 4) 手动 5) 不变 | **5) 不变** |
| Step 4 | ZIP 打包 | 1) 生成 2) 不生成 | **2) 不生成** |
| Step 5 | 输出目录 | 1) 默认 2) 自定义 | **1) 默认** |
| Step 6 | 清空输出文件夹 | 1) 否 2) 是 | **2) 是** |

每步顶部会显示 `[默认]` 提示，直接按回车即选择默认项。

最后会展示配置摘要并询问确认，输入 `y` 即可开始执行。

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--exe-only` | 仅构建 Windows EXE | — |
| `--apk-only` | 仅构建 Android APK | — |
| `--bump-exe [patch\|minor\|major]` | 递增 EXE 版本号 | `patch`（完整发布时） |
| `--bump-apk [patch\|minor\|major]` | 递增 APK 版本号 | `patch`（完整发布时） |
| `--set-exe-ver X.Y.Z` | 直接指定 EXE 版本号 | — |
| `--set-apk-ver X.Y.Z` | 直接指定 APK 版本号 | — |
| `-v X.Y.Z` | `--set-apk-ver` 的别名（向后兼容） | — |
| `--no-bump-exe` | 不递增 EXE 版本号 | — |
| `--no-bump-apk` | 不递增 APK 版本号 | — |
| `--no-zip` | 跳过 ZIP 打包 | — |
| `--output-dir DIR` | 指定产物输出目录 | `PapaCheck.Windows\dist` |
| `-h, --help` | 显示帮助信息 | — |

> **注意**：`--exe-only` 与 `--apk-only` 为互斥参数，不能同时使用。

## 使用范例

### 1. 日常小版本发布

修复 bug 后发布新版本，EXE 和 APK 版本号均自动从 `1.0.0` 递增到 `1.0.1`：

```bash
python release.py
```

### 2. 指定版本号的大版本发布

发布 `2.0.0` 大版本，两个平台版本号统一：

```bash
python release.py --set-exe-ver 2.0.0 --set-apk-ver 2.0.0
```

### 3. 只构建 EXE，不改变版本号

在开发调试阶段，只想重新打包 EXE 测试，不改变版本号：

```bash
python release.py --exe-only --no-bump-exe
```

### 4. 只构建 APK，指定递增幅度为 minor

Android 端有功能性更新，需要递增次版本号：

```bash
python release.py --apk-only --bump-apk minor
```

### 5. 完整发布但不生成 ZIP 压缩包

快速发布场景，跳过 ZIP 打包节省时间：

```bash
python release.py --no-zip
```

### 6. 指定自定义输出目录

将产物输出到指定目录（如 U 盘或网络位置）：

```bash
python release.py --output-dir D:\PapaCheck-Releases\v1.2.0
```

### 7. 进阶：EXE 升 major，APK 不升

Windows 端架构重构，APK 保持不变：

```bash
python release.py --bump-exe major --no-bump-apk
```

### 8. 向后兼容：使用旧版 `-v` 参数

与原有脚本参数兼容，指定 APK 版本号：

```bash
python release.py -v 1.5.0
```

## 产物说明

完整发布后，在输出目录（默认 `PapaCheck.Windows\dist`）下生成以下文件：

| 产物 | 文件名格式 | 说明 |
|------|-----------|------|
| Windows EXE | `PapaCheck-{exe_ver}.exe` | 独立可执行文件，内置最新 APK 供 OTA 下载 |
| Android APK | `PapaCheck-{apk_ver}.apk` | Android 安装包 |
| 完整 ZIP 包 | `PapaCheck-v{exe_ver}_full.zip` | EXE + APK 打包 |
| EXE 独立 ZIP 包 | `PapaCheck-v{exe_ver}_win.zip` | 仅 EXE 打包 |

> **示例**：EXE 版本为 `1.2.3`，APK 版本为 `1.0.5` 时，产物为：
> - `PapaCheck-1.2.3.exe`
> - `PapaCheck-1.0.5.apk`
> - `PapaCheck-v1.2.3_full.zip`（内含以上两个文件）
> - `PapaCheck-v1.2.3_win.zip`（仅内含 EXE）

构建出的 EXE 文件嵌入了 Windows VERSIONINFO 元数据，右键文件 → 属性 → 详细信息可查看：
- 文件版本、产品版本
- 产品名称（PapaCheck）
- 版权信息

## 版本号规则

### 两个独立版本号

| 版本号 | 存储位置 | 格式 | 维护方 |
|--------|----------|------|--------|
| EXE 版本 | `PapaCheck.Windows/build_config.json` → `exe_version` | `X.Y.Z` | Windows 端开发者 |
| APK 版本 | `PapaCheck.Android/pubspec.yaml` → `version:` | `X.Y.Z+N` | Android 端开发者 |

两个版本号**独立维护**，互不影响。发布时可根据需要分别控制递增幅度。

### 语义版本号规则

| 递增方式 | 效果 | 适用场景 |
|----------|------|----------|
| `patch`（默认） | `1.0.0` → `1.0.1` | Bug 修复、小优化 |
| `minor` | `1.0.1` → `1.1.0` | 新增功能、向后兼容 |
| `major` | `1.1.0` → `2.0.0` | 重大变更、不兼容旧版 |

### 直接指定版本号

使用 `--set-exe-ver` / `--set-apk-ver` 可以跳过递增规则，直接将版本号设置为任意值：

```bash
python release.py --set-exe-ver 3.0.0 --set-apk-ver 3.0.0
```

> **注意**：对于 APK，使用 `--set` 时 Flutter 构建号（`+N`）仍会自动 +1。
