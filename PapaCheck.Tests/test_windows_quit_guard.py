"""
test_windows_quit_guard.py

Feature: Windows 端退出流程防竞态与去重
  问题 1：_quit_app() 和 _stop_server() 各自打了一条"正在停止服务器..."日志 → 重复
  问题 2：_wait_shutdown() 与 _check_still_running() 同时检测到线程退出，
        两者都调用 _handle_server_exit()，导致资源重复释放 + _do_destroy() 与
        _check_still_running 的 root.after() 冲突 → 卡死

  修复：
    A. 删除 _quit_app() 中的重复日志
    B. _check_still_running() 检测到 _quitting 时跳过 _handle_server_exit()
    C. _quit_app() 添加防重入守卫
"""

import pytest

# ============================================================
# 退出状态机（模拟 _quit_app 的核心流程）
# ============================================================

class QuitStateMachine:
    def __init__(self):
        self.quitting = False
        self.server_alive = True
        self.running = True
        self.stop_logs = []       # 收集"正在停止服务器..."日志
        self.server_exit_calls = 0
        self.destroy_calls = 0

    def _log_stop(self):
        self.stop_logs.append('正在停止服务器...')

    def _stop_server(self):
        self._log_stop()
        self.server_alive = False  # 模拟 shutdown 完成

    def _handle_server_exit(self):
        self.server_exit_calls += 1
        self.running = False

    def _do_destroy(self):
        self.destroy_calls += 1

    # ========== BUGGY：当前代码行为 ==========
    def quit_app_buggy(self):
        self.quitting = True
        self._log_stop()               # ← 问题 1：重复日志
        if self.server_alive:
            self._stop_server()         # ← _stop_server 内部又打一条
        else:
            self._do_destroy()

    def check_still_running_buggy(self):
        """模拟 _check_still_running 轮询"""
        if not self.server_alive and self.running:
            self._handle_server_exit()  # ← 问题 2：不检查 _quitting

    def wait_shutdown(self):
        """模拟 _wait_shutdown（线程退出时触发）"""
        if not self.server_alive:
            self._handle_server_exit()
            if self.quitting:
                self._do_destroy()

    # ========== FIXED 版本 ==========
    def quit_app_fixed(self):
        if self.quitting:               # ← 修复 C：防重入
            return
        self.quitting = True
        if self.server_alive:
            self._stop_server()         # ← 修复 A：只在这里打日志
        else:
            self._do_destroy()

    def check_still_running_fixed(self):
        """修复版 _check_still_running"""
        if not self.server_alive and self.running:
            if self.quitting:           # ← 修复 B：正在退出，跳过
                return
            self._handle_server_exit()


# ============================================================
# Scenario 1: 单次退出只有一条"正在停止服务器..."日志
#   Given 服务器正在运行
#   When  用户点击菜单栏「退出」一次
#   Then  日志中只出现一条"正在停止服务器..."
# ============================================================
def test_单次退出只产生一条停止日志():
    sm = QuitStateMachine()
    sm.quit_app_fixed()
    sm.wait_shutdown()

    assert len(sm.stop_logs) == 1, (
        f'BUG: 产生了 {len(sm.stop_logs)} 条"正在停止服务器..."日志，应只有 1 条'
    )


# ============================================================
# Scenario 2: _check_still_running 不干扰退出流程
#   Given _quit_app() 已启动退出流程
#   When  _check_still_running 轮询检测到线程退出
#   Then  不应再次调用 _handle_server_exit()
# ============================================================
def test_check_still_running_退出中不重复调用_handle_server_exit():
    sm = QuitStateMachine()

    # 启动退出流程
    sm.quitting = True
    sm._stop_server()  # 服务器停止

    # 模拟 _wait_shutdown 先检测到
    sm.wait_shutdown()
    assert sm.server_exit_calls == 1

    # 模拟 _check_still_running 随后检测到
    sm.check_still_running_fixed()

    # 修复后：不应再增加
    assert sm.server_exit_calls == 1, (
        f'BUG: _handle_server_exit() 被调用 {sm.server_exit_calls} 次，'
        f'退出流程中 _check_still_running 应跳过'
    )


# ============================================================
# Scenario 3: buggy 版本 _handle_server_exit 被重复调用
#   Given _quit_app() 已启动退出流程
#   When  _check_still_running 与 _wait_shutdown 同时检测到线程退出
#   Then  buggy 版本会调用 _handle_server_exit 两次（问题重现）
# ============================================================
def test_buggy_check_still_running_重复调用_handle_server_exit():
    sm = QuitStateMachine()

    sm.quitting = True
    sm._stop_server()

    # 两者同时检测到线程退出
    sm.check_still_running_buggy()
    sm.wait_shutdown()

    assert sm.server_exit_calls == 2, (
        f'_handle_server_exit 被调用 {sm.server_exit_calls} 次（确认 bug 可复现）'
    )
    assert sm.destroy_calls == 1  # _do_destroy 只从 _wait_shutdown 调用


# ============================================================
# Scenario 4: 修复后防重入守卫拦截重复退出
# ============================================================
def test_修复后防重入守卫拦截重复调用():
    sm = QuitStateMachine()

    sm.quit_app_fixed()
    sm.quit_app_fixed()  # 第二次：应被拦截

    assert len(sm.stop_logs) == 1, '第二次调用不应产生日志'
    assert sm.destroy_calls == 0, '退出流程中不应调用 destroy（由 wait_shutdown 调用）'
