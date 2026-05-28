import json
import os
import sys
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
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'earn', 'amount': 10, 'detail': '测试加分'
        })
        assert status == 200
        assert result.get('balance') == 10

    def test_update_points_spend(self, test_server):
        status, before = _request(test_server, 'GET', '/api/data')
        initial = before['points']['balance']
        _request(test_server, 'POST', '/api/points', {
            'action': 'earn', 'amount': 30, 'detail': '先加'
        })
        status, result = _request(test_server, 'POST', '/api/points', {
            'action': 'spend', 'amount': 10, 'detail': '再减'
        })
        assert status == 200
        assert result.get('balance') == initial + 20


class TestSettingsAPI:
    def test_settings_roundtrip(self, test_server):
        settings = {'dailyBasePoints': 80, 'ratingMultipliers': {'优': 1.2}}
        status, _ = _request(test_server, 'POST', '/api/settings', {'settings': settings})
        assert status == 200

        status, data = _request(test_server, 'GET', '/api/settings')
        assert status == 200
        assert data['dailyBasePoints'] == 80


class TestBountyAPI:
    def test_bounty_workflow(self, test_server):
        tasks = [{
            'id': 'bt1', 'name': '帮妈妈洗碗', 'points': 5,
            'type': 'recurring', 'enabled': True, 'createdAt': 1700000000000,
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
