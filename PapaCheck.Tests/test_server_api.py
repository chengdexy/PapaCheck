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
    def test_get_data_returns_full_json(self, test_server):
        status, data = _request(test_server, 'GET', '/api/data')
        assert status == 200
        assert 'points' in data
        assert 'homeworks' in data
        assert 'settings' in data
        assert 'bountyTasks' in data

    def test_get_settings_default(self, test_server):
        status, data = _request(test_server, 'GET', '/api/settings')
        assert status == 200
        assert isinstance(data, dict)


class TestHomeworksAPI:
    def test_save_and_get_homeworks(self, test_server):
        date_key = '2025-06-15'
        hw = [{'id': 'hw1', 'subject': 'math', 'content': '练习册', 'status': 'pending'}]
        status, _ = _request(test_server, 'POST', f'/api/homeworks/{date_key}', {'homeworks': hw})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/homeworks/{date_key}')
        assert status == 200
        assert len(data) == 1
        assert data[0]['id'] == 'hw1'


class TestPointsAPI:
    def test_update_points_earn(self, test_server):
        _, before = _request(test_server, 'GET', '/api/data')
        before_balance = before['points']['balance']
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'earn', 'amount': 10, 'detail': '测试加分'
        })
        assert status == 200
        assert result.get('balance') == before_balance + 10

    def test_spend_points_reduces_balance(self, test_server):
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

    def test_spend_exceeds_balance_allowed(self, test_server):
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'spend', 'amount': 100, 'detail': '超额消费'
        })
        assert status == 200
        assert 'balance' in result

    def test_post_invalid_json_returns_error(self, test_server):
        code, content = _request_raw(test_server, 'POST', '/api/points',
                                      'this is not json')
        assert code in (400, 500)


class TestSettingsAPI:
    def test_save_settings(self, test_server):
        settings = {'dailyBasePoints': 80, 'ratingMultipliers': {'优': 1.2}}
        status, _ = _request(test_server, 'POST', '/api/settings', {'settings': settings})
        assert status == 200

    def test_get_saved_settings(self, test_server):
        settings = {'dailyBasePoints': 80}
        _request(test_server, 'POST', '/api/settings', {'settings': settings})
        status, data = _request(test_server, 'GET', '/api/settings')
        assert status == 200
        assert data['dailyBasePoints'] == 80


class TestBountyAPI:
    def test_save_bounty_tasks(self, test_server):
        tasks = [{
            'id': 'bt1', 'name': '帮妈妈洗碗', 'points': 5,
            'type': 'recurring', 'enabled': True, 'createdAt': 1700000000000,
        }]
        status, _ = _request(test_server, 'POST', '/api/bounty-tasks', {'items': tasks})
        assert status == 200

    def test_get_saved_bounty_tasks(self, test_server):
        tasks = [{
            'id': 'bt2', 'name': '整理书架', 'points': 10,
            'type': 'once', 'enabled': True, 'createdAt': 1700000000100,
        }]
        _request(test_server, 'POST', '/api/bounty-tasks', {'items': tasks})
        status, data = _request(test_server, 'GET', '/api/bounty-tasks')
        assert status == 200
        assert len(data) == 1

    def test_bounty_submissions_crud(self, test_server):
        date_key = '2025-06-15'
        subs = [{'taskId': 'bt1', 'status': 'doing'}]
        status, _ = _request(test_server, 'POST', f'/api/bounty-submissions/{date_key}', {'submissions': subs})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/bounty-submissions/{date_key}')
        assert status == 200
        assert len(data) == 1


class TestResetDateAPI:
    def test_reset_date(self, test_server):
        date_key = '2025-06-16'
        hw = [{'id': 'hw_reset', 'subject': 'test', 'content': 'reset me', 'status': 'pending'}]
        _request(test_server, 'POST', f'/api/homeworks/{date_key}', {'homeworks': hw})
        status, _ = _request(test_server, 'POST', '/api/reset-date', {'date': date_key})
        assert status == 200

        status, data = _request(test_server, 'GET', f'/api/homeworks/{date_key}')
        assert status == 200
        assert len(data) == 0


class TestStaticFiles:
    def test_index_html_served(self, test_server):
        status, content = _request(test_server, 'GET', '/index.html')
        assert status == 200
        assert 'PapaCheck' in content or 'html' in content.lower()

    def test_404_for_nonexistent(self, test_server):
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

    def test_version_without_apk_returns_default(self, test_server):
        import server as server_mod
        tmpdir, original = _inject_apk_dir(server_mod, with_apk=False)
        try:
            status, data = _request(test_server, 'GET', '/api/version')
            assert status == 200
            assert data == {'clientVersion': '1.0.0'}
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    def test_version_with_single_apk(self, test_server):
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

    def test_version_with_multiple_apks_returns_latest(self, test_server):
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

    def test_download_without_apk_returns_404(self, test_server):
        import server as server_mod
        tmpdir, original = _inject_apk_dir(server_mod, with_apk=False)
        try:
            status, _ = _request(test_server, 'GET', '/api/download')
            assert status == 404
        finally:
            _restore_web_root(server_mod, tmpdir, original)

    def test_download_with_apk_returns_file(self, test_server):
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
    def test_ping_returns_ok_and_server_time(self, test_server):
        status, data = _request(test_server, 'GET', '/api/ping')
        assert status == 200
        assert data.get('ok') is True
        assert 'serverTime' in data
        assert 'T' in data['serverTime']


class TestSyncAPI:
    def test_push_accepts_changes(self, test_server):
        changes = [{
            'type': 'upsert',
            'uuid': 'test-id-001',
            'data': {'id': 'test-id-001', 'subject': 'math', 'content': 'test', 'status': 'pending'},
            'timestamp': '2025-06-15T10:00:00+00:00',
        }]
        status, data = _request(test_server, 'POST', '/api/sync/push', {'changes': changes})
        assert status == 200
        assert data.get('ok') is True

    def test_push_empty_changes(self, test_server):
        status, data = _request(test_server, 'POST', '/api/sync/push', {'changes': []})
        assert status == 200
        assert data.get('ok') is True

    def test_pull_with_last_sync(self, test_server):
        status, data = _request(test_server, 'GET', '/api/sync/pull?lastSync=2025-01-01T00:00:00+00:00')
        assert status == 200
        assert 'changes' in data
        assert 'serverTime' in data
        assert isinstance(data['changes'], list)

    def test_pull_without_last_sync_returns_all(self, test_server):
        status, data = _request(test_server, 'GET', '/api/sync/pull')
        assert status == 200
        assert 'changes' in data
        assert isinstance(data['changes'], list)
        assert 'serverTime' in data

    def test_pull_response_format(self, test_server):
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
