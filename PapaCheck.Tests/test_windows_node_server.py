# -*- coding: utf-8 -*-
import os
import sys
import time
import subprocess
from unittest.mock import patch, MagicMock, call

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
_WINDOWS_DIR = os.path.join(_PROJECT_ROOT, 'PapaCheck.Windows')
for p in (_PROJECT_ROOT, _WINDOWS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

# 这些函数将在 app_gui.py 中实现为模块级函数（类方法委托调用它们）
from app_gui import (
    _get_node_server_exe,
    _start_node_server_process,
    _stop_node_server_process,
)


class TestGetNodeServerExe:
    """测试查找 Node.js 服务器 EXE 路径"""

    # Feature: 查找 Node.js 服务器 EXE
    #   Scenario: 开发环境下返回 None（由调用者使用 tsx 启动）
    #     Given 未处于 PyInstaller 打包环境（sys.frozen 为 False）
    #     When 调用 _get_node_server_exe
    #     Then 返回 None
    def test_dev_env_returns_none(self):
        exe = _get_node_server_exe()
        assert exe is None

    # Feature: 查找 Node.js 服务器 EXE
    #   Scenario: EXE 文件不存在时抛出 FileNotFoundError
    #     Given papacheck-server.exe 文件不存在
    #     When 调用 _get_node_server_exe
    #     Then 抛出 FileNotFoundError
    def test_raises_when_exe_not_found(self):
        with patch.object(sys, 'frozen', True, create=True):
            with patch.object(sys, '_MEIPASS', 'C:/fake/meipass', create=True):
                with patch('os.path.exists', return_value=False):
                    with pytest.raises(FileNotFoundError) as excinfo:
                        _get_node_server_exe()
                    assert 'papacheck-server.exe' in str(excinfo.value)

    # Feature: 查找 Node.js 服务器 EXE
    #   Scenario: PyInstaller 打包环境下返回 sys._MEIPASS 下的路径
    #     Given sys.frozen 为 True 且 sys._MEIPASS 存在
    #     When 调用 _get_node_server_exe
    #     Then 返回 sys._MEIPASS/Server.Node/papacheck-server.exe
    def test_frozen_env_returns_meipass_path(self):
        mock_meipass = 'C:/fake/meipass'
        with patch('os.path.exists', return_value=True):
            with patch.object(sys, 'frozen', True, create=True):
                with patch.object(sys, '_MEIPASS', mock_meipass, create=True):
                    exe = _get_node_server_exe()
                    assert exe == os.path.join(mock_meipass, 'Server.Node', 'papacheck-server.exe')


class TestStartNodeServerProcess:
    """测试通过 subprocess.Popen 启动 Node.js 服务器"""

    # Feature: 通过子进程启动 Node.js 服务器
    #   Scenario: 调用 subprocess.Popen 启动服务器进程
    #     Given exe_path, db_path, web_dir, port 参数
    #     When 调用 _start_node_server_process
    #     Then 使用 subprocess.Popen 启动并传入正确的命令行参数
    def test_launches_subprocess_with_correct_args(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_process.pid = 12345

        with patch('subprocess.Popen', return_value=mock_process) as mock_popen:
            with patch('socket.socket') as mock_socket:
                mock_sock_instance = MagicMock()
                mock_socket.return_value.__enter__.return_value = mock_sock_instance
                # 模拟端口连接成功
                mock_sock_instance.connect.return_value = None

                process = _start_node_server_process(
                    exe_path='/fake/papacheck-server.exe',
                    db_path='/fake/data.db',
                    web_dir='/fake/web',
                    port=8080,
                )

                mock_popen.assert_called_once()
                args = mock_popen.call_args[0][0]
                assert args[0] == '/fake/papacheck-server.exe'
                assert '--port' in args
                assert '8080' in args
                assert '--web-dir' in args
                assert '/fake/web' in args
                assert '--db-path' in args
                assert '/fake/data.db' in args

    # Feature: 通过子进程启动 Node.js 服务器
    #   Scenario: Windows 平台上使用 CREATE_NO_WINDOW 标志
    #     Given sys.platform 为 win32
    #     When 调用 _start_node_server_process
    #     Then Popen 调用中包含 creationflags=subprocess.CREATE_NO_WINDOW
    def test_windows_uses_create_no_window(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = None

        with patch('subprocess.Popen', return_value=mock_process) as mock_popen:
            with patch('socket.socket') as mock_socket:
                mock_sock_instance = MagicMock()
                mock_socket.return_value.__enter__.return_value = mock_sock_instance
                mock_sock_instance.connect.return_value = None

                with patch('sys.platform', 'win32'):
                    _start_node_server_process(
                        exe_path='/fake/papacheck-server.exe',
                        db_path='/fake/data.db',
                        web_dir='/fake/web',
                        port=8080,
                    )

                kwargs = mock_popen.call_args[1]
                assert kwargs.get('creationflags') == subprocess.CREATE_NO_WINDOW

    # Feature: 通过子进程启动 Node.js 服务器
    #   Scenario: 子进程启动后立即退出时抛出异常
    #     Given 子进程 poll() 返回非 None（进程已退出）
    #     When 调用 _start_node_server_process
    #     Then 抛出 Exception 提示启动失败
    def test_raises_when_process_exits_immediately(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = 1  # 进程已退出

        with patch('subprocess.Popen', return_value=mock_process):
            with pytest.raises(Exception, match='Node.js 服务器启动失败'):
                _start_node_server_process(
                    exe_path='/fake/papacheck-server.exe',
                    db_path='/fake/data.db',
                    web_dir='/fake/web',
                    port=8080,
                )

    # Feature: 通过子进程启动 Node.js 服务器
    #   Scenario: 端口在超时时间内未就绪时抛出异常
    #     Given 端口连接持续失败
    #     When 调用 _start_node_server_process
    #     Then 超时后抛出 Exception 提示启动超时
    def test_raises_when_port_not_ready(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = None  # 进程运行中

        with patch('subprocess.Popen', return_value=mock_process):
            with patch('socket.socket') as mock_socket:
                mock_sock_instance = MagicMock()
                mock_socket.return_value.__enter__.return_value = mock_sock_instance
                # 端口连接始终失败
                mock_sock_instance.connect.side_effect = ConnectionRefusedError()

                with patch('time.sleep'):  # 加速测试
                    with pytest.raises(Exception, match='Node.js 服务器启动超时'):
                        _start_node_server_process(
                            exe_path='/fake/papacheck-server.exe',
                            db_path='/fake/data.db',
                            web_dir='/fake/web',
                            port=8080,
                        )


class TestStopNodeServerProcess:
    """测试停止 Node.js 服务器子进程"""

    # Feature: 停止 Node.js 服务器
    #   Scenario: 正常停止时调用 terminate
    #     Given 子进程正在运行
    #     When 调用 _stop_node_server_process
    #     Then 调用 process.terminate() 且 process.wait(timeout=5) 成功
    def test_terminates_process(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = None

        _stop_node_server_process(mock_process)

        mock_process.terminate.assert_called_once()
        mock_process.wait.assert_called_once_with(timeout=5)

    # Feature: 停止 Node.js 服务器
    #   Scenario: 进程不响应 terminate 时强制 kill
    #     Given 子进程在 terminate 后 5 秒内未退出
    #     When 调用 _stop_node_server_process
    #     Then 先 terminate 再 kill，然后 wait(timeout=3)
    def test_kills_on_timeout(self):
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_process.wait.side_effect = [
            subprocess.TimeoutExpired('cmd', 5),  # terminate 后超时
            None,  # kill 后正常
        ]

        _stop_node_server_process(mock_process)

        mock_process.terminate.assert_called_once()
        mock_process.kill.assert_called_once()
        assert mock_process.wait.call_count == 2

    # Feature: 停止 Node.js 服务器
    #   Scenario: 进程为 None 时不做任何操作
    #     Given process 为 None
    #     When 调用 _stop_node_server_process
    #     Then 不执行任何操作
    def test_noop_when_process_none(self):
        _stop_node_server_process(None)  # 不应抛出异常
