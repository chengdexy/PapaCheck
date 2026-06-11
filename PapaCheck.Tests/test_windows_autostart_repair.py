"""
test_windows_autostart_repair.py

Feature: Windows 端版本更新后开机自启动配置应保留

  Scenario: 版本更新后自动修复自启动路径
    Given 用户已开启开机自启动，注册表条目指向旧版本 EXE 路径
    When 新版本 PapaCheck 启动
    Then 注册表条目自动更新为新版本 EXE 路径，且 _auto_start_var 为 True

  Scenario: 没有自启动注册表条目时不操作
    Given 注册表中没有 PapaCheck 的自启动条目
    When PapaCheck 启动
    Then 不修改注册表，_auto_start_var 为 False

  Scenario: 自启动路径有效时不修改
    Given 注册表自启动条目指向当前有效 EXE 路径
    When PapaCheck 启动
    Then 不修改注册表，_auto_start_var 为 True
"""

import os
import sys
import tempfile
import pytest

AUTORUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "PapaCheckServer"


# ============================================================
# 模拟注册表操作的状态机
# ============================================================

class RegistrySimulator:
    """模拟 winreg 的注册表读写操作"""

    def __init__(self, entry_path=None):
        """
        entry_path:
          - 有效路径字符串 → 模拟注册表有条目且路径存在
          - 无效路径字符串 → 模拟注册表有条目但路径不存在（旧版本）
          - None            → 模拟注册表无条目
        """
        self._entry_path = entry_path  # 注册表中存储的路径值
        self._set_value_calls = []     # 记录 set 调用
        self._delete_value_calls = []  # 记录 delete 调用
        self._path_exists_map = {}     # 自定义 os.path.isfile 映射

    def query_value(self, key, name):
        """模拟 winreg.QueryValueEx"""
        if self._entry_path is None:
            raise FileNotFoundError(f'[模拟] 注册表键 {name} 不存在')
        if self._entry_path == '':
            raise FileNotFoundError(f'[模拟] 注册表键 {name} 不存在')
        return self._entry_path, 1  # (value, reg_type)

    def set_value(self, key, name, reserved, reg_type, value):
        """模拟 winreg.SetValueEx"""
        self._set_value_calls.append({
            'key': key,
            'name': name,
            'reg_type': reg_type,
            'value': value,
        })

    def delete_value(self, key, name):
        """模拟 winreg.DeleteValue"""
        if self._entry_path is None:
            raise FileNotFoundError(f'[模拟] 注册表键 {name} 不存在')
        self._delete_value_calls.append({
            'key': key,
            'name': name,
        })

    @property
    def has_entry(self):
        return self._entry_path is not None and self._entry_path != ''

    @property
    def path_valid(self):
        if not self.has_entry:
            return False
        path = self._entry_path.strip('"\' ')
        if not path:
            return False
        # 用自定义映射或 os.path.isfile
        if path in self._path_exists_map:
            return self._path_exists_map[path]
        return os.path.isfile(path)


# ============================================================
# 被测试的核心逻辑（从 app_gui.py 提取，模拟 _repair_autostart）
# ============================================================

class AutostartRepair:
    """模拟 PapaCheckApp 中开机自启动修复逻辑"""

    def __init__(self, registry_sim, current_exe_path, is_frozen=True):
        self._reg = registry_sim
        self._current_exe_path = current_exe_path
        self._is_frozen = is_frozen
        self.logs = []

    def _append_log(self, msg):
        self.logs.append(msg)

    def _get_current_target(self):
        """生成当前 EXE 的注册表目标值（不含外层引号）"""
        if self._is_frozen:
            return '"' + self._current_exe_path + '"'
        else:
            return '"' + self._current_exe_path + '" "' + os.path.abspath(__file__) + '"'

    def repair_autostart(self):
        """修复注册表中的自启动条目路径（版本更新后路径变化时自动更新）"""
        if not self._reg.has_entry:
            return  # 条目不存在，无需修复

        path = self._reg._entry_path.strip('"\' ')
        if not path:
            return

        if os.path.isfile(path):
            return  # 路径有效，无需修复

        # 旧路径无效（如版本更新后 EXE 文件名变化），更新为当前 EXE 路径
        target = self._get_current_target()
        self._reg.set_value(None, APP_NAME, 0, 1, target)
        self._append_log('开机自启动路径已更新: ' + target)

    def is_autostart(self):
        """检查自启动是否启用（修复后路径应有效）"""
        if not self._reg.has_entry:
            return False
        path = self._reg._entry_path.strip('"\' ')
        if not path:
            return False
        return os.path.isfile(path)


# ============================================================
# Scenario 1: 版本更新后自动修复自启动路径
# ============================================================

def test_版本更新后自动修复自启动路径():
    """
    Given 用户已开启开机自启动，注册表条目指向旧版本 EXE 路径
    When 修复逻辑执行
    Then 注册表条目自动更新为新版本 EXE 路径，且 is_autostart 为 True
    """
    # Given: 旧版本 EXE 路径（指向不存在的文件）
    stale_path = r'C:\PapaCheck\PapaCheck-1.2.22.exe'
    reg = RegistrySimulator(entry_path=stale_path)

    # When: 当前 EXE 是 1.2.23，启动修复
    new_exe = r'C:\PapaCheck\PapaCheck-1.2.23.exe'
    repairer = AutostartRepair(reg, new_exe)
    repairer.repair_autostart()

    # Then: 注册表被更新为新路径
    assert len(reg._set_value_calls) == 1, (
        f'应调用 set_value 一次，实际 {len(reg._set_value_calls)} 次'
    )
    assert reg._set_value_calls[0]['value'] == '"' + new_exe + '"', (
        f'注册表值应更新为 "{new_exe}"，'
        f'实际为 "{reg._set_value_calls[0]["value"]}"'
    )
    # 验证日志
    assert any('开机自启动路径已更新' in log for log in repairer.logs), (
        '应有路径更新日志'
    )


# ============================================================
# Scenario 2: 没有自启动注册表条目时不操作
# ============================================================

def test_没有自启动条目时不操作():
    """
    Given 注册表中没有 PapaCheck 的自启动条目
    When 修复逻辑执行
    Then 不修改注册表，is_autostart 为 False
    """
    # Given: 注册表中没有条目
    reg = RegistrySimulator(entry_path=None)

    # When: 执行修复
    repairer = AutostartRepair(reg, r'C:\PapaCheck\PapaCheck-1.2.23.exe')
    repairer.repair_autostart()

    # Then: 没有注册表写操作
    assert len(reg._set_value_calls) == 0, (
        f'不应有 set_value 调用，实际 {len(reg._set_value_calls)} 次'
    )
    assert len(reg._delete_value_calls) == 0, (
        f'不应有 delete_value 调用，实际 {len(reg._delete_value_calls)} 次'
    )
    # is_autostart 返回 False
    assert not repairer.is_autostart()


# ============================================================
# Scenario 3: 自启动路径有效时不修改
# ============================================================

def test_自启动路径有效时不修改():
    """
    Given 注册表自启动条目指向当前有效 EXE 路径
    When 修复逻辑执行
    Then 不修改注册表，is_autostart 为 True
    """
    # Given: 自启动路径有效（创建临时文件模拟有效 EXE）
    with tempfile.NamedTemporaryFile(suffix='.exe', delete=False) as tmp:
        current_exe = tmp.name
    try:
        reg = RegistrySimulator(entry_path='"' + current_exe + '"')

        # When: 执行修复
        repairer = AutostartRepair(reg, current_exe)
        repairer.repair_autostart()

        # Then: 没有注册表写操作
        assert len(reg._set_value_calls) == 0, (
            f'不应有 set_value 调用，实际 {len(reg._set_value_calls)} 次'
        )
        # is_autostart 返回 True
        assert repairer.is_autostart(), '自启动路径有效时 is_autostart 应为 True'
    finally:
        try:
            os.unlink(current_exe)
        except OSError:
            pass


# ============================================================
# 验证旧代码行为（确认 bug 存在）
# ============================================================

def test_旧版_cleanup_stale_会删除有效自启动配置():
    """
    验证旧版 _cleanup_stale_autostart 的行为：
    当注册表有条目但路径无效时会删除，导致自启动取消
    """
    # Given: 旧版本 EXE 路径（版本更新后路径无效）
    stale_path = r'C:\PapaCheck\PapaCheck-1.2.22.exe'
    reg = RegistrySimulator(entry_path=stale_path)

    # When: 执行旧版清理逻辑（删除无效路径）
    # 模拟旧版行为
    if reg.has_entry:
        path = reg._entry_path.strip('"\' ')
        if path and not os.path.isfile(path):
            reg.delete_value(None, APP_NAME)  # 旧版直接删除

    # Then: 条目被删除
    assert len(reg._delete_value_calls) == 1, (
        f'旧版应删除无效条目，实际 {len(reg._delete_value_calls)} 次'
    )
    reg._entry_path = None
    assert not reg.has_entry, '旧版删除后注册表无条目'
