import os
import sys
import importlib
import tempfile

import pytest


_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))


@pytest.fixture
def temp_db_dir():
    old_dir = os.environ.get('PAPACHECK_DB_DIR')
    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ['PAPACHECK_DB_DIR'] = tmpdir
        yield tmpdir
        if old_dir is not None:
            os.environ['PAPACHECK_DB_DIR'] = old_dir
        else:
            del os.environ['PAPACHECK_DB_DIR']


def _import_db():
    server_dir = os.path.join(_PROJECT_ROOT, 'PapaCheck.Server')
    if server_dir not in sys.path:
        sys.path.insert(0, server_dir)
    if 'db' in sys.modules:
        del sys.modules['db']
    import db as _db
    return _db


@pytest.fixture
def db(temp_db_dir):
    _db = _import_db()
    _db.init_db()
    yield _db
    _db.close_connection()


@pytest.fixture
def sample_homeworks():
    return [
        {
            'id': 'hw1',
            'subject': 'math',
            'content': '练习册第15页',
            'mode': 'challenge',
            'suggestedDuration': 20,
            'basePoints': 10,
            'status': 'pending',
        },
        {
            'id': 'hw2',
            'subject': 'english',
            'content': '朗读Unit5单词',
            'mode': 'timer',
            'suggestedDuration': 15,
            'basePoints': 5,
            'status': 'done',
        },
    ]


@pytest.fixture
def sample_bounty_tasks():
    return [
        {
            'id': 'bt1',
            'name': '帮妈妈洗碗',
            'points': 5,
            'type': 'recurring',
            'enabled': True,
            'createdAt': 1700000000000,
        },
        {
            'id': 'bt2',
            'name': '整理书架',
            'points': 10,
            'type': 'once',
            'enabled': True,
            'createdAt': 1700000000100,
        },
    ]


@pytest.fixture
def test_date():
    return '2025-06-15'
