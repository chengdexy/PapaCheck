# -*- coding: utf-8 -*-
# Feature: 邮件同步错误处理
#   Scenario: HTTPError 时 lambda 闭包正确捕获异常信息
#     Given _run_email_sync 执行时 urllib 抛出 HTTPError（404）
#     When 触发 except 分支
#     Then _append_log 被调用且包含 "HTTP 404"
#
#   Scenario: 通用 Exception 时 lambda 闭包正确捕获异常信息
#     Given _run_email_sync 执行时抛出通用 Exception
#     When 触发 except 分支
#     Then _append_log 被调用且包含异常信息

import os
import sys
import json
import urllib.error
import urllib.request
from unittest.mock import patch, MagicMock

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
_WINDOWS_DIR = os.path.join(_PROJECT_ROOT, 'PapaCheck.Windows')
for p in (_PROJECT_ROOT, _WINDOWS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)


class TestEmailSyncErrorHandling:
    """验证 _run_email_sync 的 except 分支中 lambda 闭包正确绑定异常变量"""

    def _make_app(self):
        """创建测试用 PapaCheckApp 实例，mock root 令 after 立即执行"""
        from app_gui import PapaCheckApp

        app = PapaCheckApp.__new__(PapaCheckApp)
        app.root = MagicMock()
        app.root.after.side_effect = lambda ms, cb, *args: cb(*args)
        app._append_log = MagicMock()
        app._child_url_var = MagicMock()
        app._child_url_var.get.return_value = 'http://localhost:8081'
        app._email_sync_btn = MagicMock()
        app._open_attach_btn = MagicMock()
        return app

    @patch('urllib.request.urlopen')
    def test_http_error_logs_code_and_body(self, mock_urlopen):
        """HTTPError 时日志包含状态码和响应体"""
        app = self._make_app()

        cfg = {
            'imap_server': 'imap.test.com', 'port': 993,
            'email': 'test@test.com', 'ai_base_url': 'https://api.deepseek.com',
            'sender': 'teacher@school.com', 'ai_model': 'deepseek-chat',
        }
        pw = 'password'
        ak = 'sk-key'

        mock_urlopen.side_effect = [
            MagicMock(),  # config 保存成功
            urllib.error.HTTPError(
                url='http://localhost:8081/api/email/sync', code=404,
                msg='Not Found', hdrs={},
                fp=MagicMock(__enter__=MagicMock(return_value=MagicMock(
                    read=MagicMock(return_value=b'{"error":"not found"}')
                )))
            ),
        ]

        app._run_email_sync(cfg, pw, ak)

        log_texts = [str(c[0][0]) for c in app._append_log.call_args_list]
        match = [t for t in log_texts if '404' in t]
        assert len(match) >= 1, f'应包含 "404"，实际日志: {log_texts}'

    @patch('urllib.request.urlopen')
    def test_generic_exception_logs_error_message(self, mock_urlopen):
        """通用 Exception 时日志包含错误信息"""
        app = self._make_app()

        cfg = {
            'imap_server': 'imap.test.com', 'port': 993,
            'email': 'test@test.com', 'ai_base_url': 'https://api.deepseek.com',
            'sender': 'teacher@school.com', 'ai_model': 'deepseek-chat',
        }
        pw = 'password'
        ak = 'sk-key'

        mock_urlopen.side_effect = RuntimeError('连接超时')

        app._run_email_sync(cfg, pw, ak)

        log_texts = [str(c[0][0]) for c in app._append_log.call_args_list]
        match = [t for t in log_texts if '连接超时' in t]
        assert len(match) >= 1, f'应包含 "连接超时"，实际日志: {log_texts}'
