import json
import os
import sys
import shutil
import socket
import threading
import time
import tempfile
import urllib.request
import urllib.error

import pytest
pytest.skip("已迁移到 Node.js，旧测试已过时", allow_module_level=True)


_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

_server_dir = os.path.join(_PROJECT_ROOT, 'PapaCheck.Server')


def _get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def _request(port, method, path, data=None):
    url = f'http://localhost:{port}{path}'
    body = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=body, method=method)
    if body:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            content = resp.read().decode('utf-8')
            try:
                return resp.status, json.loads(content)
            except json.JSONDecodeError:
                return resp.status, content
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


def _request_raw(port, method, path, body, content_type='application/json'):
    url = f'http://localhost:{port}{path}'
    data = body.encode('utf-8') if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', content_type)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


@pytest.fixture(scope='class')
def test_server():
    old_dir = os.environ.get('PAPACHECK_DB_DIR')
    tmpdir = tempfile.mkdtemp()
    os.environ['PAPACHECK_DB_DIR'] = tmpdir

    for mod in list(sys.modules):
        if mod.startswith('PapaCheck.Server') or mod == 'db':
            del sys.modules[mod]
    if _server_dir not in sys.path:
        sys.path.insert(0, _server_dir)
    import db
    db.init_db()

    for mod in list(sys.modules):
        if mod.startswith('PapaCheck.Server'):
            del sys.modules[mod]
    import server as server_mod
    os.makedirs(os.path.join(tmpdir, 'tts_cache'), exist_ok=True)
    port = _get_free_port()
    server_mod.PORT = port
    server_mod.init_server(quiet=True)

    thread = threading.Thread(target=server_mod.main, daemon=True)
    thread.start()
    time.sleep(1)

    yield port

    if hasattr(server_mod, '_server') and server_mod._server is not None:
        server_mod._server.shutdown()
    thread.join(timeout=2)
    db.close_connection()

    if old_dir is not None:
        os.environ['PAPACHECK_DB_DIR'] = old_dir
    else:
        del os.environ['PAPACHECK_DB_DIR']
    try:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception:
        pass


class TestGetAPI:
    # Feature: 数据查询 API
    #   Scenario: GET /api/data 返回完整数据结构
    #     Given 服务端已启动且数据库已初始化
    #     When 客户端请求 GET /api/data
    #     Then 返回状态码 200 且响应包含 points、homeworks、settings、bountyTasks 字段
    def test_get_data_returns_complete_data_structure(self, test_server):
        status, data = _request(test_server, 'GET', '/api/data')
        assert status == 200
        assert 'points' in data
        assert 'homeworks' in data
        assert 'settings' in data
        assert 'bountyTasks' in data

    # Feature: 设置查询 API
    #   Scenario: 未保存设置时 GET /api/settings 返回空字典
    #     Given 服务端已启动且未保存任何设置
    #     When 客户端请求 GET /api/settings
    #     Then 返回状态码 200 且响应为字典类型
    def test_get_settings_returns_dict_when_no_settings_saved(self, test_server):
        status, data = _request(test_server, 'GET', '/api/settings')
        assert status == 200
        assert isinstance(data, dict)


class TestHomeworksAPI:
    # Feature: 作业管理 API
    #   Scenario: 保存作业后再查询返回已保存的作业
    #     Given 服务端已启动
    #     When 客户端 POST 保存作业到指定日期，然后 GET 查询该日期的作业
    #     Then 返回状态码 200 且查询结果包含已保存的作业数据
    def test_save_homeworks_then_get_returns_saved_homeworks(self, test_server):
        date_key = '2025-06-15'
        hw = [{'id': 'hw1', 'subject': 'math', 'content': '练习册', 'status': 'pending'}]
        status, _ = _request(test_server, 'POST', f'/api/homeworks/{date_key}', {'homeworks': hw})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/homeworks/{date_key}')
        assert status == 200
        assert len(data) == 1
        assert data[0]['id'] == 'hw1'


class TestPointsAPI:
    # Feature: 积分管理 API
    #   Scenario: 赚取积分后余额增加
    #     Given 服务端已启动且当前积分为已知余额
    #     When 客户端 POST 赚取 10 积分
    #     Then 返回状态码 200 且余额等于原余额加 10
    def test_earn_points_increases_balance(self, test_server):
        _, before = _request(test_server, 'GET', '/api/data')
        before_balance = before['points']['balance']
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'earn', 'amount': 10, 'detail': '测试加分'
        })
        assert status == 200
        assert result.get('balance') == before_balance + 10

    # Feature: 积分管理 API
    #   Scenario: 消费积分后余额减少
    #     Given 服务端已启动且账户有足够余额
    #     When 客户端 POST 消费 10 积分
    #     Then 返回状态码 200 且余额等于消费前余额减 10
    def test_spend_points_decreases_balance(self, test_server):
        _, before = _request(test_server, 'GET', '/api/data')
        before_balance = before['points']['balance']
        _request(test_server, 'POST', '/api/points', {
            'action': 'earn', 'amount': 10, 'detail': '确保有余额'
        })
        _, after_earn = _request(test_server, 'GET', '/api/data')
        balance_after_earn = after_earn['points']['balance']
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'spend', 'amount': 10, 'detail': '消费'
        })
        assert status == 200
        assert result.get('balance') == balance_after_earn - 10

    # Feature: 积分管理 API
    #   Scenario: 消费超过余额时不报错
    #     Given 服务端已启动
    #     When 客户端 POST 消费超过当前余额的积分
    #     Then 返回状态码 200 且响应中包含 balance 字段
    def test_spend_more_than_balance_does_not_error(self, test_server):
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'spend', 'amount': 100, 'detail': '超额消费'
        })
        assert status == 200
        assert 'balance' in result

    # Feature: 积分管理 API
    #   Scenario: 发送无效 JSON 返回错误状态码
    #     Given 服务端已启动
    #     When 客户端 POST 非法 JSON 内容到 /api/points
    #     Then 返回 400 或 500 状态码
    def test_post_invalid_json_returns_error_status(self, test_server):
        code, content = _request_raw(test_server, 'POST', '/api/points',
                                      'this is not json')
        assert code in (400, 500)


class TestSettingsAPI:
    # Feature: 设置管理 API
    #   Scenario: 保存设置返回成功
    #     Given 服务端已启动
    #     When 客户端 POST 保存设置数据
    #     Then 返回状态码 200
    def test_save_settings_returns_success(self, test_server):
        settings = {'dailyBasePoints': 80, 'ratingMultipliers': {'优': 1.2}}
        status, _ = _request(test_server, 'POST', '/api/settings', {'settings': settings})
        assert status == 200

    # Feature: 设置管理 API
    #   Scenario: 保存设置后再查询返回已保存的值
    #     Given 服务端已启动
    #     When 客户端 POST 保存设置，然后 GET 查询设置
    #     Then 返回状态码 200 且查询结果包含之前保存的值
    def test_get_settings_returns_previously_saved_values(self, test_server):
        settings = {'dailyBasePoints': 80}
        _request(test_server, 'POST', '/api/settings', {'settings': settings})
        status, data = _request(test_server, 'GET', '/api/settings')
        assert status == 200
        assert data['dailyBasePoints'] == 80


class TestBountyAPI:
    # Feature: 悬赏任务管理 API
    #   Scenario: 保存悬赏任务返回成功
    #     Given 服务端已启动
    #     When 客户端 POST 保存悬赏任务列表
    #     Then 返回状态码 200
    def test_save_bounty_tasks_returns_success(self, test_server):
        tasks = [{
            'id': 'bt1', 'name': '帮妈妈洗碗', 'points': 5,
            'type': 'recurring', 'enabled': True, 'createdAt': 1700000000000,
        }]
        status, _ = _request(test_server, 'POST', '/api/bounty-tasks', {'items': tasks})
        assert status == 200

    # Feature: 悬赏任务管理 API
    #   Scenario: 保存悬赏任务后再查询返回已保存的任务
    #     Given 服务端已启动
    #     When 客户端 POST 保存悬赏任务，然后 GET 查询悬赏任务
    #     Then 返回状态码 200 且查询结果包含已保存的任务
    def test_get_bounty_tasks_returns_saved_tasks(self, test_server):
        tasks = [{
            'id': 'bt2', 'name': '整理书架', 'points': 10,
            'type': 'once', 'enabled': True, 'createdAt': 1700000000100,
        }]
        _request(test_server, 'POST', '/api/bounty-tasks', {'items': tasks})
        status, data = _request(test_server, 'GET', '/api/bounty-tasks')
        assert status == 200
        assert len(data) == 1

    # Feature: 悬赏提交管理 API
    #   Scenario: 保存悬赏提交后再查询返回已保存的提交
    #     Given 服务端已启动
    #     When 客户端 POST 保存悬赏提交到指定日期，然后 GET 查询该日期的提交
    #     Then 返回状态码 200 且查询结果包含已保存的提交
    def test_save_bounty_submissions_then_get_returns_them(self, test_server):
        date_key = '2025-06-15'
        subs = [{'taskId': 'bt1', 'status': 'doing'}]
        status, _ = _request(test_server, 'POST', f'/api/bounty-submissions/{date_key}', {'submissions': subs})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/bounty-submissions/{date_key}')
        assert status == 200
        assert len(data) == 1


class TestResetDateAPI:
    # Feature: 日期重置 API
    #   Scenario: 重置日期后该日期的作业被清空
    #     Given 服务端已启动且指定日期已有作业数据
    #     When 客户端 POST 重置该日期
    #     Then 返回状态码 200 且该日期的作业为空列表
    def test_reset_date_clears_homeworks_for_that_date(self, test_server):
        date_key = '2025-06-16'
        hw = [{'id': 'hw_reset', 'subject': 'test', 'content': 'reset me', 'status': 'pending'}]
        _request(test_server, 'POST', f'/api/homeworks/{date_key}', {'homeworks': hw})
        status, _ = _request(test_server, 'POST', '/api/reset-date', {'date': date_key})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/homeworks/{date_key}')
        assert status == 200
        assert len(data) == 0


class TestStaticFiles:
    # Feature: 静态文件服务
    #   Scenario: 根路径提供 index.html
    #     Given 服务端已启动且 Web 根目录包含 index.html
    #     When 客户端请求 GET /index.html
    #     Then 返回状态码 200 且内容包含 PapaCheck 或 html 标识
    def test_index_html_is_served_at_root(self, test_server):
        status, content = _request(test_server, 'GET', '/index.html')
        assert status == 200
        assert 'PapaCheck' in content or 'html' in content.lower()

    # Feature: 静态文件服务
    #   Scenario: 请求不存在的路径返回 404
    #     Given 服务端已启动
    #     When 客户端请求 GET 不存在的路径
    #     Then 返回状态码 404
    def test_nonexistent_path_returns_404(self, test_server):
        status, _ = _request(test_server, 'GET', '/nonexistent-path-xyz')
        assert status == 404


def _inject_apk_dir(server_mod, with_apk=True):
    tmpdir = tempfile.mkdtemp()
    apk_dir = os.path.join(tmpdir, 'apk')
    os.makedirs(apk_dir, exist_ok=True)
    original = server_mod._WEB_ROOT
    server_mod._WEB_ROOT = tmpdir
    if with_apk:
        return tmpdir, original, apk_dir
    else:
        os.rmdir(apk_dir)
        return tmpdir, original


def _restore_web_root(server_mod, tmpdir, original):
    server_mod._WEB_ROOT = original
    shutil.rmtree(tmpdir, ignore_errors=True)


class TestVersionAPI:

    # Feature: 版本查询 API
    #   Scenario: 无 APK 文件时返回默认版本号
    #     Given 服务端已启动且 APK 目录不存在
    #     When 客户端请求 GET /api/version
    #     Then 返回状态码 200 且 clientVersion 为默认值 '1.0.0'
    def test_version_api_returns_default_when_no_apk(self, test_server):
        import server as server_mod
        tmpdir, original = _inject_apk_dir(server_mod, with_apk=False)
        try:
            status, data = _request(test_server, 'GET', '/api/version')
            assert status == 200
            assert data == {'clientVersion': '1.0.0'}
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    # Feature: 版本查询 API
    #   Scenario: 有单个 APK 文件时返回该 APK 的版本号
    #     Given 服务端已启动且 APK 目录包含一个 PapaCheck-2.1.0.apk
    #     When 客户端请求 GET /api/version
    #     Then 返回状态码 200 且 clientVersion 为 '2.1.0'
    def test_version_api_returns_apk_version(self, test_server):
        import server as server_mod
        tmpdir, original, apk_dir = _inject_apk_dir(server_mod)
        try:
            apk_path = os.path.join(apk_dir, 'PapaCheck-2.1.0.apk')
            with open(apk_path, 'wb') as f:
                f.write(b'dummy apk')
            status, data = _request(test_server, 'GET', '/api/version')
            assert status == 200
            assert data == {'clientVersion': '2.1.0'}
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    # Feature: 版本查询 API
    #   Scenario: 有多个 APK 文件时返回最新版本号
    #     Given 服务端已启动且 APK 目录包含多个不同版本的 APK
    #     When 客户端请求 GET /api/version
    #     Then 返回状态码 200 且 clientVersion 为版本号最大的那个
    def test_version_api_returns_latest_apk_version(self, test_server):
        import server as server_mod
        tmpdir, original, apk_dir = _inject_apk_dir(server_mod)
        try:
            for ver in ['1.0.0', '1.9.0', '2.0.1', '1.5.0']:
                apk_path = os.path.join(apk_dir, f'PapaCheck-{ver}.apk')
                with open(apk_path, 'wb') as f:
                    f.write(b'dummy apk ' + ver.encode())
            status, data = _request(test_server, 'GET', '/api/version')
            assert status == 200
            assert data == {'clientVersion': '2.0.1'}
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    # Feature: APK 下载 API
    #   Scenario: 无 APK 文件时下载返回 404
    #     Given 服务端已启动且 APK 目录不存在
    #     When 客户端请求 GET /api/download
    #     Then 返回状态码 404
    def test_download_api_returns_404_when_no_apk(self, test_server):
        import server as server_mod
        tmpdir, original = _inject_apk_dir(server_mod, with_apk=False)
        try:
            status, _ = _request(test_server, 'GET', '/api/download')
            assert status == 404
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    # Feature: APK 下载 API
    #   Scenario: 有 APK 文件时下载返回文件内容
    #     Given 服务端已启动且 APK 目录包含一个 APK 文件
    #     When 客户端请求 GET /api/download
    #     Then 返回状态码 200 且响应内容包含 APK 文件数据
    def test_download_api_returns_apk_file_content(self, test_server):
        import server as server_mod
        tmpdir, original, apk_dir = _inject_apk_dir(server_mod)
        try:
            apk_content = b'dummy apk content for testing'
            apk_path = os.path.join(apk_dir, 'PapaCheck-3.0.0.apk')
            with open(apk_path, 'wb') as f:
                f.write(apk_content)
            status, content = _request(test_server, 'GET', '/api/download')
            assert status == 200
            assert isinstance(content, str)
            assert 'dummy apk content' in content
        finally:
            _restore_web_root(server_mod, tmpdir, original)


class TestPingAPI:
    # Feature: 心跳检测 API
    #   Scenario: ping 请求返回 ok 状态和服务器时间戳
    #     Given 服务端已启动
    #     When 客户端请求 GET /api/ping
    #     Then 返回状态码 200 且 ok 为 True 且包含含 ISO 时间格式的 serverTime
    def test_ping_returns_ok_with_server_timestamp(self, test_server):
        status, data = _request(test_server, 'GET', '/api/ping')
        assert status == 200
        assert data.get('ok') is True
        assert 'serverTime' in data
        assert 'T' in data['serverTime']


class TestSyncAPI:
    # Feature: 数据同步 API
    #   Scenario: push 接口接受变更列表
    #     Given 服务端已启动
    #     When 客户端 POST 包含变更记录的同步推送请求
    #     Then 返回状态码 200 且 ok 为 True
    def test_sync_push_accepts_change_list(self, test_server):
        changes = [{
            'type': 'upsert',
            'uuid': 'test-id-001',
            'data': {'id': 'test-id-001', 'subject': 'math', 'content': 'test', 'status': 'pending'},
            'timestamp': '2025-06-15T10:00:00+00:00',
        }]
        status, data = _request(test_server, 'POST', '/api/sync/push', {'changes': changes})
        assert status == 200
        assert data.get('ok') is True

    # Feature: 数据同步 API
    #   Scenario: push 接口接受空变更列表
    #     Given 服务端已启动
    #     When 客户端 POST 空的变更列表
    #     Then 返回状态码 200 且 ok 为 True
    def test_sync_push_accepts_empty_change_list(self, test_server):
        status, data = _request(test_server, 'POST', '/api/sync/push', {'changes': []})
        assert status == 200
        assert data.get('ok') is True

    # Feature: 数据同步 API
    #   Scenario: 指定上次同步时间后 pull 返回增量变更
    #     Given 服务端已启动
    #     When 客户端 GET /api/sync/pull 并提供 lastSync 时间戳
    #     Then 返回状态码 200 且包含 changes 列表和 serverTime
    def test_sync_pull_returns_changes_since_last_sync(self, test_server):
        status, data = _request(test_server, 'GET', '/api/sync/pull?lastSync=2025-01-01T00:00:00+00:00')
        assert status == 200
        assert 'changes' in data
        assert 'serverTime' in data
        assert isinstance(data['changes'], list)

    # Feature: 数据同步 API
    #   Scenario: 不提供上次同步时间时 pull 返回全部变更
    #     Given 服务端已启动
    #     When 客户端 GET /api/sync/pull 不提供 lastSync 参数
    #     Then 返回状态码 200 且包含 changes 列表和 serverTime
    def test_sync_pull_without_timestamp_returns_all_changes(self, test_server):
        status, data = _request(test_server, 'GET', '/api/sync/pull')
        assert status == 200
        assert 'changes' in data
        assert isinstance(data['changes'], list)
        assert 'serverTime' in data

    # Feature: 数据同步 API
    #   Scenario: pull 响应包含必需字段
    #     Given 服务端已启动且已通过 push_merge 写入变更数据
    #     When 客户端 GET /api/sync/pull 并提供 lastSync 时间戳
    #     Then 返回状态码 200 且每条变更包含 table_name、record_key、data、last_modified 字段
    def test_sync_pull_response_includes_required_fields(self, test_server):
        import server as server_mod

        changes = [{
            'type': 'upsert',
            'uuid': 'fmt-test-001',
            'data': {
                'id': 'fmt-test-001', 'subject': 'math', 'content': 'format test',
                'status': 'pending', 'lastModified': '2025-06-15T10:00:00+00:00',
            },
            'timestamp': '2025-06-15T10:00:00+00:00',
        }]
        server_mod.db.push_merge(changes)

        status, data = _request(test_server, 'GET', '/api/sync/pull?lastSync=2025-06-15T09:00:00+00:00')
        assert status == 200
        assert 'changes' in data
        for change in data['changes']:
            assert 'table_name' in change
            assert 'record_key' in change
            assert 'data' in change
            assert 'last_modified' in change
