# PapaCheck CloudBase 迁移 - 子计划 5：Android 端改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 Android Flutter 端：默认地址改为 `chengdexy.cn/papacheck/app/`，删除离线快照模块、Kotlin 写队列桥接、缓存清理逻辑。

**Architecture:** 保留 WebView 容器 + 版本检测 + APK 更新。移除 `offline_snapshot_service.dart`、`cache_clear_helper.dart`、Room/WorkManager/OkHttp Kotlin 桥接。`main.dart` 简化为直接加载在线页面。

**Tech Stack:** Flutter, Dart, Kotlin, flutter test

**依赖关系：** 无前置依赖，可与子计划 1/2/4 并行开发。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第六章「Android 端改造」

---

## 文件结构

```
PapaCheck.Android/
├── lib/
│   ├── main.dart                       # 改造：默认 URL + 移除离线逻辑
│   ├── services/
│   │   ├── config_service.dart         # 改造：默认 URL 更新
│   │   ├── update_service.dart         # 改造：URL 前缀
│   │   ├── offline_snapshot_service.dart # 删除
│   │   └── cache_clear_helper.dart     # 删除
│   └── widgets/
│       ├── connect_failed_dialog.dart  # 保留
│       └── setup_page.dart             # 保留
├── android/app/src/main/kotlin/
│   └── com/chengdexy/papacheck/
│       └── MainActivity.kt             # 改造：删除 Room/WorkManager 桥接
└── test/
    ├── config_service_test.dart        # 改造：更新默认值断言
    ├── main_no_offline_test.dart       # 新建：验证离线模块已删除
    └── update_service_test.dart        # 保留
```

---

### Task 1: 改造 config_service.dart - 更新默认 URL

**Files:**
- Modify: `PapaCheck.Android/lib/services/config_service.dart`
- Modify: `PapaCheck.Android/test/config_service_test.dart`

- [ ] **Step 1: 写 Gherkin 行为注释**

```dart
// test/config_service_test.dart
// Feature: ConfigService 默认配置
//   Scenario: 默认服务器 URL 为 CloudBase
//     Given ConfigService 初始化
//     When 读取默认 URL
//     Then 值为 https://chengdexy.cn/papacheck/app/
//   Scenario: 默认版本检测 URL
//     Given ConfigService 初始化
//     When 读取版本检测 URL
//     Then 值为 https://chengdexy.cn/papacheck/api/version
test('ConfigService 默认配置', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 改造 config_service.dart**

```dart
// lib/services/config_service.dart (改造默认值)
class ConfigService {
  static const String defaultServerUrl = 'https://chengdexy.cn/papacheck/app/';
  static const String defaultVersionUrl = 'https://chengdexy.cn/papacheck/api/version';
  static const String defaultDownloadUrl = 'https://chengdexy.cn/papacheck/api/download';
  
  // ... 保留其余逻辑
}
```

- [ ] **Step 4: 更新测试断言**

```dart
// test/config_service_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck/services/config_service.dart';

void main() {
  group('ConfigService 默认配置', () {
    test('默认服务器 URL 为 CloudBase', () {
      expect(ConfigService.defaultServerUrl, 'https://chengdexy.cn/papacheck/app/');
    });

    test('默认版本检测 URL', () {
      expect(ConfigService.defaultVersionUrl, 'https://chengdexy.cn/papacheck/api/version');
    });

    test('默认下载 URL', () {
      expect(ConfigService.defaultDownloadUrl, 'https://chengdexy.cn/papacheck/api/download');
    });
  });
}
```

- [ ] **Step 5: 运行测试**

```bash
cd PapaCheck.Android && flutter test test/config_service_test.dart
```
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add PapaCheck.Android/lib/services/config_service.dart PapaCheck.Android/test/config_service_test.dart
git commit -m "refactor: ConfigService 默认 URL 改为 CloudBase /papacheck/app/"
```

---

### Task 2: 改造 update_service.dart - URL 前缀

**Files:**
- Modify: `PapaCheck.Android/lib/services/update_service.dart`

- [ ] **Step 1: 更新 URL 常量**

```dart
// lib/services/update_service.dart
class UpdateService {
  // 改为从 ConfigService 读取，或直接更新常量
  static const String _versionUrl = 'https://chengdexy.cn/papacheck/api/version';
  static const String _downloadUrl = 'https://chengdexy.cn/papacheck/api/download';
  
  // ... 保留其余逻辑
}
```

- [ ] **Step 2: 运行现有测试**

```bash
cd PapaCheck.Android && flutter test test/update_service_test.dart
```
Expected: PASS（如测试中有 URL 断言，同步更新）

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Android/lib/services/update_service.dart
git commit -m "refactor: UpdateService URL 改为 /papacheck/api/ 前缀"
```

---

### Task 3: 删除离线快照和缓存清理模块

**Files:**
- Delete: `PapaCheck.Android/lib/services/offline_snapshot_service.dart`
- Delete: `PapaCheck.Android/lib/services/cache_clear_helper.dart`
- Delete: `PapaCheck.Android/test/offline_snapshot_service_test.dart`
- Delete: `PapaCheck.Android/test/cache_clear_helper_test.dart`

- [ ] **Step 1: 删除离线模块文件**

```bash
Remove-Item PapaCheck.Android/lib/services/offline_snapshot_service.dart
Remove-Item PapaCheck.Android/lib/services/cache_clear_helper.dart
Remove-Item PapaCheck.Android/test/offline_snapshot_service_test.dart
Remove-Item PapaCheck.Android/test/cache_clear_helper_test.dart
```

- [ ] **Step 2: 提交**

```bash
git add -A PapaCheck.Android/
git commit -m "refactor: 删除离线快照和缓存清理模块"
```

---

### Task 4: 改造 main.dart - 移除离线逻辑

**Files:**
- Modify: `PapaCheck.Android/lib/main.dart`

- [ ] **Step 1: 改造 main.dart**

删除以下内容：
1. `import 'services/offline_snapshot_service.dart';`
2. `import 'services/cache_clear_helper.dart';`
3. 离线快照加载逻辑（`OfflineSnapshotService.loadSnapshot()` 等）
4. JavaScriptChannel 写队列桥接（`_queueChannel` 相关）
5. 缓存清理调用（`CacheClearHelper.clearCache()` 等）

保留：
1. WebView 容器初始化
2. 版本检测 + APK 更新逻辑
3. 配置页（首次设置 URL）
4. 连接失败对话框

简化后的 `main.dart` 主流程：

```dart
void main() {
  runApp(const PapaCheckApp());
}

class PapaCheckApp extends StatelessWidget {
  const PapaCheckApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PapaCheck',
      home: const MainPage(),
      theme: ThemeData(primarySwatch: Colors.blue),
    );
  }
}

class MainPage extends StatefulWidget {
  const MainPage({super.key});

  @override
  State<MainPage> createState() => _MainPageState();
}

class _MainPageState extends State<MainPage> {
  late final WebViewController _controller;
  String _currentUrl = ConfigService.defaultServerUrl;

  @override
  void initState() {
    super.initState();
    _initWebView();
    _checkUpdate();
  }

  void _initWebView() {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (url) {
          // 保留必要的页面加载回调
        },
      ))
      ..loadFlutterWidget(_currentUrl);  // 直接加载在线页面
  }

  Future<void> _checkUpdate() async {
    // 保留版本检测 + APK 更新逻辑
    await UpdateService.checkForUpdate(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: WebViewWidget(controller: _controller),
    );
  }
}
```

- [ ] **Step 2: 验证 Dart 编译**

```bash
cd PapaCheck.Android && flutter analyze
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add PapaCheck.Android/lib/main.dart
git commit -m "refactor: main.dart 移除离线快照/写队列/缓存清理逻辑"
```

---

### Task 5: 改造 MainActivity.kt - 删除 Kotlin 写队列桥接

**Files:**
- Modify: `PapaCheck.Android/android/app/src/main/kotlin/com/chengdexy/papacheck/MainActivity.kt`

- [ ] **Step 1: 删除 Room/WorkManager/OkHttp 桥接代码**

在 `MainActivity.kt` 中删除：
1. Room 数据库相关 imports 和初始化
2. WorkManager 相关代码
3. OkHttp 写队列相关代码
4. MethodChannel 写队列桥接（`_queueChannel` 相关）
5. 离线写队列处理逻辑

保留：
1. `FlutterActivity` 基础结构
2. `configureFlutterEngine` 方法
3. 必要的 MethodChannel（如配置读取）

简化后的 `MainActivity.kt`：

```kotlin
package com.chengdexy.papacheck

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.chengdexy.papacheck/config"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getServerUrl" -> result.success(getSharedPreferences("PapaCheck", MODE_PRIVATE).getString("server_url", ""))
                "setServerUrl" -> {
                    getSharedPreferences("PapaCheck", MODE_PRIVATE).edit().putString("server_url", call.argument<String>("url")).apply()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
```

- [ ] **Step 2: 删除 Room/WorkManager/OkHttp 依赖**

在 `PapaCheck.Android/android/app/build.gradle` 中删除：

```groovy
// 删除这些依赖
implementation "androidx.room:room-runtime:$room_version"
implementation "androidx.room:room-ktx:$room_version"
implementation "androidx.work:work-runtime-ktx:$work_version"
implementation "com.squareup.okhttp3:okhttp:$okhttp_version"
```

- [ ] **Step 3: 验证 Gradle 编译**

```bash
cd PapaCheck.Android && flutter build apk --debug
```
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add PapaCheck.Android/android/app/src/main/kotlin/com/chengdexy/papacheck/MainActivity.kt
git add PapaCheck.Android/android/app/build.gradle
git commit -m "refactor: MainActivity.kt 删除 Room/WorkManager/OkHttp 写队列桥接"
```

---

### Task 6: 编写离线模块已删除验证测试

**Files:**
- Create: `PapaCheck.Android/test/main_no_offline_test.dart`

- [ ] **Step 1: 写 Gherkin 行为注释**

```dart
// test/main_no_offline_test.dart
// Feature: 离线模块已删除
//   Scenario: OfflineSnapshotService 不存在
//     Given 项目代码
//     When 检查 services/offline_snapshot_service.dart
//     Then 文件不存在
//   Scenario: CacheClearHelper 不存在
//     Given 项目代码
//     When 检查 services/cache_clear_helper.dart
//     Then 文件不存在
test('离线模块已删除', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写测试（用户确认后）**

```dart
// test/main_no_offline_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'dart:io';

void main() {
  group('离线模块已删除', () {
    test('OfflineSnapshotService 文件不存在', () {
      final file = File('lib/services/offline_snapshot_service.dart');
      expect(file.existsSync(), isFalse, 
        reason: 'offline_snapshot_service.dart 应已删除');
    });

    test('CacheClearHelper 文件不存在', () {
      final file = File('lib/services/cache_clear_helper.dart');
      expect(file.existsSync(), isFalse,
        reason: 'cache_clear_helper.dart 应已删除');
    });

    test('main.dart 不导入离线模块', () {
      final mainFile = File('lib/main.dart');
      final content = mainFile.readAsStringSync();
      expect(content.contains('offline_snapshot_service'), isFalse,
        reason: 'main.dart 不应导入 offline_snapshot_service');
      expect(content.contains('cache_clear_helper'), isFalse,
        reason: 'main.dart 不应导入 cache_clear_helper');
      expect(content.contains('_queueChannel'), isFalse,
        reason: 'main.dart 不应包含 _queueChannel 写队列桥接');
    });
  });
}
```

- [ ] **Step 4: 运行测试**

```bash
cd PapaCheck.Android && flutter test test/main_no_offline_test.dart
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add PapaCheck.Android/test/main_no_offline_test.dart
git commit -m "test: 新增离线模块已删除验证测试"
```

---

### Task 7: 全量测试与编译验证

- [ ] **Step 1: 全量 Flutter 测试**

```bash
cd PapaCheck.Android && flutter test
```
Expected: 所有测试通过

- [ ] **Step 2: APK 编译验证**

```bash
cd PapaCheck.Android && flutter build apk --release
```
Expected: 编译成功，APK 生成

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: Android 端改造完成，全量测试 + APK 编译通过"
```

---

## 完成标准

- [ ] `config_service.dart` 默认 URL 改为 `chengdexy.cn/papacheck/app/`
- [ ] `update_service.dart` URL 改为 `/papacheck/api/` 前缀
- [ ] 删除 `offline_snapshot_service.dart` 和 `cache_clear_helper.dart`
- [ ] `main.dart` 移除离线快照/写队列/缓存清理逻辑
- [ ] `MainActivity.kt` 删除 Room/WorkManager/OkHttp 桥接
- [ ] `build.gradle` 删除对应依赖
- [ ] 全量 Flutter 测试通过
- [ ] APK 编译成功

## 后续衔接

- 子计划 6（网关配置）推送新版 APK 到云存储
