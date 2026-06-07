import os
import sys
import subprocess
from unittest.mock import patch

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, _PROJECT_ROOT)

# build_exe.py 位于 PapaCheck.Windows/ 目录下
_BUILD_EXE_DIR = os.path.join(_PROJECT_ROOT, 'PapaCheck.Windows')
sys.path.insert(0, _BUILD_EXE_DIR)


class TestRestoreBetterSqlite3:

    # Feature: SEA 构建后自动恢复 better-sqlite3
    #   Scenario: SEA 构建完成后自动 npm rebuild
    #     Given SEA 构建脚本已执行完毕
    #     When 调用 restore_better_sqlite3
    #     Then 在 NODE_DIR 中用 shell=True 执行 npm rebuild better-sqlite3
    def test_restore_runs_npm_rebuild_in_node_dir(self):
        import build_exe

        with patch('build_exe.subprocess.run') as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0)
            build_exe.restore_better_sqlite3()
            mock_run.assert_called_once()
            args, kwargs = mock_run.call_args
            # 命令以字符串形式传入（shell=True 时用字符串）
            cmd = args[0] if args else kwargs.get('args', '')
            assert 'npm rebuild better-sqlite3' in cmd
            assert kwargs['cwd'] == build_exe.NODE_DIR
            assert kwargs['shell'] is True

    # Feature: SEA 构建后自动恢复 better-sqlite3
    #   Scenario: rebuild 失败时打印警告但不终止
    #     Given npm rebuild 执行失败
    #     When 调用 restore_better_sqlite3
    #     Then 打印警告信息，不抛出异常
    def test_restore_prints_warning_on_failure(self):
        import build_exe

        with patch('build_exe.subprocess.run') as mock_run, \
             patch('builtins.print') as mock_print:
            mock_run.return_value = subprocess.CompletedProcess(
                args=[], returncode=1)
            # Should NOT raise exception
            build_exe.restore_better_sqlite3()
            # Should print a warning
            warning_msg = None
            for call_args in mock_print.call_args_list:
                args, _ = call_args
                if '警告' in str(args[0]) and 'better-sqlite3' in str(args[0]):
                    warning_msg = args[0]
                    break
            assert warning_msg is not None, '应打印警告信息'
