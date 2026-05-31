"""
db.py - SQLite 数据库层
单文件数据库 data.db，零依赖，Python 标准库 sqlite3
"""
import datetime
import json
import os
import sqlite3
import threading
from contextlib import contextmanager

_DB_DIR = os.environ.get('PAPACHECK_DB_DIR', os.path.dirname(os.path.abspath(__file__)))
DB_FILE = os.path.join(_DB_DIR, 'data.db')


# ==================== Connection Manager ====================

class _ConnectionManager:
    """线程本地连接管理器：每个线程复用同一个连接，消除频繁创建/销毁开销。"""

    def __init__(self):
        self._local = threading.local()

    def _create_connection(self):
        conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def get(self):
        """获取当前线程的连接，不存在则创建并缓存。"""
        conn = getattr(self._local, 'connection', None)
        if conn is None:
            conn = self._create_connection()
            self._local.connection = conn
        return conn

    def close(self):
        """关闭当前线程的连接（服务关闭时调用）。"""
        conn = getattr(self._local, 'connection', None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            self._local.connection = None


_mgr = _ConnectionManager()


@contextmanager
def _db():
    """数据库连接上下文管理器，自动处理异常回滚。

    注意：不会自动 commit，调用方需要在 with 块内手动调用 conn.commit()。
    """
    conn = _mgr.get()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise


def close_connection():
    """关闭当前线程的数据库连接。服务器关闭时调用。"""
    _mgr.close()


# ==================== Sync ====================

def record_modification(table_name, record_key, timestamp):
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO last_modified (table_name, record_key, last_modified) VALUES (?, ?, ?)",
            (table_name, record_key, timestamp)
        )
        conn.commit()


_DATE_KEY_TABLES = {
    'homeworks', 'daily_settlement', 'efficiency_history',
    'free_time_tasks', 'bounty_submissions', 'bounty_completions',
}
_SINGLE_ROW_TABLES = {
    'shop_items', 'redemptions', 'reward_box', 'settings',
    'active_buffs', 'bounty_tasks', 'badges',
}


def get_modified_since(timestamp):
    with _db() as conn:
        rows = conn.execute(
            "SELECT table_name, record_key, last_modified FROM last_modified WHERE last_modified > ?",
            (timestamp,)
        ).fetchall()

        result = []
        for row in rows:
            table = row['table_name']
            record_key = row['record_key']

            if table in _DATE_KEY_TABLES:
                data = _get_date_data(conn, table, record_key)
            elif table in _SINGLE_ROW_TABLES:
                data = _get_json(conn, table, int(record_key))
            else:
                continue

            result.append({
                'table_name': table,
                'record_key': record_key,
                'data': data,
                'last_modified': row['last_modified'],
            })

        return result


def _classify_change(data):
    if 'subject' in data:
        return 'homeworks'
    if 'dailyBase' in data and 'rating' in data:
        return 'daily_settlement'
    if 'cost' in data or 'baseQuantity' in data:
        return 'shop_items'
    if 'itemId' in data and 'status' in data:
        return 'redemptions'
    if 'quantity' in data and 'name' in data:
        return 'reward_box'
    if 'dailyBasePoints' in data or 'ratingMultipliers' in data:
        return 'settings'
    if 'duration' in data and 'unit' in data:
        return 'active_buffs'
    if 'createdAt' in data and 'points' in data:
        return 'bounty_tasks'
    if 'startedAt' in data:
        return 'bounty_submissions'
    if 'taskId' in data:
        return 'bounty_completions'
    if 'efficiencyRatio' in data:
        return 'efficiency_history'
    return None


def _find_by_uuid(items, uuid):
    for i, item in enumerate(items):
        if isinstance(item, dict) and item.get('id') == uuid:
            return i, item
    return -1, None


def push_merge(changes):
    with _db() as conn:
        for change in changes:
            change_type = change.get('type')
            uuid = change.get('uuid')
            data = change.get('data', {})
            timestamp = change.get('timestamp', '')
            new_last_modified = data.get('lastModified', timestamp)

            table = _classify_change(data)
            if table is None:
                continue

            if table in _DATE_KEY_TABLES:
                record_key = data.get('date', '')
                if not record_key:
                    continue

                existing = _get_date_data(conn, table, record_key, [])
                if isinstance(existing, list):
                    idx, existing_item = _find_by_uuid(existing, uuid)
                    if existing_item:
                        old_last = existing_item.get('lastModified', '0')
                        if change_type == 'delete':
                            existing[idx]['isDeleted'] = True
                            existing[idx]['lastModified'] = new_last_modified
                        elif new_last_modified > old_last:
                            existing[idx] = data
                    else:
                        existing.append(data)

                    _set_date_data(conn, table, record_key, existing)
                    record_modification(table, record_key, timestamp)
                elif isinstance(existing, dict):
                    old_last = existing.get('lastModified', '0')
                    if change_type == 'delete':
                        data['isDeleted'] = True
                        existing = data
                    elif new_last_modified > old_last:
                        existing = data
                    _set_date_data(conn, table, record_key, existing)
                    record_modification(table, record_key, timestamp)

            elif table in _SINGLE_ROW_TABLES:
                existing = _get_json(conn, table, 1)
                if isinstance(existing, list):
                    idx, existing_item = _find_by_uuid(existing, uuid)
                    if existing_item:
                        old_last = existing_item.get('lastModified', '0')
                        if change_type == 'delete':
                            existing[idx]['isDeleted'] = True
                            existing[idx]['lastModified'] = new_last_modified
                        elif new_last_modified > old_last:
                            existing[idx] = data
                    else:
                        existing.append(data)

                    _set_json(conn, table, existing, 1)
                    record_modification(table, '1', timestamp)
                elif isinstance(existing, dict):
                    old_last = existing.get('lastModified', '0')
                    if change_type == 'delete':
                        data['isDeleted'] = True
                    if change_type == 'delete' or new_last_modified > old_last:
                        existing = data
                    _set_json(conn, table, existing, 1)
                    record_modification(table, '1', timestamp)

        conn.commit()
        return {'ok': True}


# ==================== Helpers ====================

def _row_to_dict(row):
    return {k: row[k] for k in row.keys()}


def _get_json(conn, table, id_value=1):
    row = conn.execute(f"SELECT data FROM {table} WHERE id = ?", (id_value,)).fetchone()
    return json.loads(row['data']) if row else None


def _set_json(conn, table, data, id_value=1):
    conn.execute(f"UPDATE {table} SET data = ? WHERE id = ?",
                 (json.dumps(data, ensure_ascii=False), id_value))


def _get_date_data(conn, table, date_key, default=None):
    row = conn.execute(f"SELECT data FROM {table} WHERE date_key = ?", (date_key,)).fetchone()
    if row:
        return json.loads(row['data'])
    return default


def _set_date_data(conn, table, date_key, data):
    conn.execute(
        f"INSERT OR REPLACE INTO {table} (date_key, data) VALUES (?, ?)",
        (date_key, json.dumps(data, ensure_ascii=False))
    )


def _reset_daily_shop_quantity(conn=None):
    """每日商品数量重置。接受可选 conn 参数，复用已有连接。"""
    own_conn = conn is None
    if own_conn:
        conn = _mgr.get()
    try:
        today = datetime.date.today().isoformat()
        row = conn.execute("SELECT value FROM meta WHERE key = 'last_shop_reset'").fetchone()
        last_reset = row['value'] if row else ''
        if last_reset != today:
            items = json.loads(conn.execute("SELECT data FROM shop_items WHERE id = 1").fetchone()['data'])
            changed = False
            for item in items:
                base = item.get('baseQuantity', 0)
                if base > 0 and item.get('remainingQuantity') != base:
                    item['remainingQuantity'] = base
                    changed = True
            if changed:
                conn.execute("UPDATE shop_items SET data = ? WHERE id = 1", (json.dumps(items, ensure_ascii=False),))
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)", (today,))
            conn.commit()
    finally:
        if own_conn:
            pass  # 连接由调用方管理，不关闭


# ==================== Init ====================

def init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS points (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                balance INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS points_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                earned INTEGER NOT NULL DEFAULT 0,
                spent INTEGER NOT NULL DEFAULT 0,
                balance INTEGER NOT NULL DEFAULT 0,
                detail TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS homeworks (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS daily_settlement (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS shop_items (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS redemptions (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS efficiency_history (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS free_time_tasks (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS badges (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS reward_box (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS active_buffs (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS bounty_tasks (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS bounty_submissions (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]'
            );

            -- bounty_completions 存储每日完成记录，
            -- 客户端通过 _total 键（作为特殊 date_key）存储全局累加计数器。
            -- _total 不会被 reset_date() 清除，用于跨天累计计数。
            CREATE TABLE IF NOT EXISTS bounty_completions (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS last_modified (
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                last_modified TEXT NOT NULL,
                PRIMARY KEY (table_name, record_key)
            );

            INSERT OR IGNORE INTO points (id, balance) VALUES (1, 0);
            INSERT OR IGNORE INTO shop_items (id, data) VALUES (1, '[]');
            INSERT OR IGNORE INTO redemptions (id, data) VALUES (1, '[]');
            INSERT OR IGNORE INTO badges (id, data) VALUES (1, '[]');
            INSERT OR IGNORE INTO reward_box (id, data) VALUES (1, '[]');
            INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}');
            INSERT OR IGNORE INTO active_buffs (id, data) VALUES (1, '[]');
            INSERT OR IGNORE INTO bounty_tasks (id, data) VALUES (1, '[]');
        """)
        conn.commit()


# ==================== Full Data ====================

def get_full_data():
    """返回与旧 JSON 格式兼容的完整数据"""
    with _db() as conn:
        _reset_daily_shop_quantity(conn)
        data = {
            'points': {
                'balance': conn.execute("SELECT balance FROM points WHERE id = 1").fetchone()['balance'],
                'history': [_row_to_dict(r) for r in conn.execute("SELECT * FROM points_history ORDER BY id ASC")],
            },
            'badges': json.loads(conn.execute("SELECT data FROM badges WHERE id = 1").fetchone()['data']),
            'history': {},
            'tasks': {},
            'homeworks': {},
            'dailySettlement': {},
            'shopItems': json.loads(conn.execute("SELECT data FROM shop_items WHERE id = 1").fetchone()['data']),
            'redemptions': json.loads(conn.execute("SELECT data FROM redemptions WHERE id = 1").fetchone()['data']),
            'rewardBox': json.loads(conn.execute("SELECT data FROM reward_box WHERE id = 1").fetchone()['data']),
            'settings': json.loads(conn.execute("SELECT data FROM settings WHERE id = 1").fetchone()['data']),
            'activeBuffs': json.loads(conn.execute("SELECT data FROM active_buffs WHERE id = 1").fetchone()['data']),
            'efficiencyHistory': {},
            'freeTimeTasks': {},
        }

        for row in conn.execute("SELECT date_key, data FROM homeworks"):
            data['homeworks'][row['date_key']] = json.loads(row['data'])

        for row in conn.execute("SELECT date_key, data FROM daily_settlement"):
            data['dailySettlement'][row['date_key']] = json.loads(row['data'])

        for row in conn.execute("SELECT date_key, data FROM efficiency_history"):
            data['efficiencyHistory'][row['date_key']] = json.loads(row['data'])

        for row in conn.execute("SELECT date_key, data FROM free_time_tasks"):
            data['freeTimeTasks'][row['date_key']] = json.loads(row['data'])

        data['bountyTasks'] = json.loads(conn.execute("SELECT data FROM bounty_tasks WHERE id = 1").fetchone()['data'])

        data['bountySubmissions'] = {}
        for row in conn.execute("SELECT date_key, data FROM bounty_submissions"):
            data['bountySubmissions'][row['date_key']] = json.loads(row['data'])

        data['bountyCompletions'] = {}
        for row in conn.execute("SELECT date_key, data FROM bounty_completions"):
            data['bountyCompletions'][row['date_key']] = json.loads(row['data'])

        return data


# ==================== Homeworks ====================

def get_homeworks(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'homeworks', date_key, [])


def save_homeworks(date_key, items):
    with _db() as conn:
        _set_date_data(conn, 'homeworks', date_key, items)
        conn.commit()
    record_modification('homeworks', date_key, datetime.datetime.now().isoformat())


def move_homework(from_date, to_date, hw_id):
    with _db() as conn:
        from_list = _get_date_data(conn, 'homeworks', from_date)
        if from_list is None:
            return None
        idx = next((i for i, h in enumerate(from_list) if h.get('id') == hw_id), -1)
        if idx == -1:
            return None
        hw = from_list.pop(idx)
        _set_date_data(conn, 'homeworks', from_date, from_list)

        to_list = _get_date_data(conn, 'homeworks', to_date, [])
        to_list.append(hw)
        _set_date_data(conn, 'homeworks', to_date, to_list)

        conn.commit()
        return hw


# ==================== Settlement ====================

def get_settlement(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'daily_settlement', date_key)


def save_settlement(date_key, data):
    with _db() as conn:
        _set_date_data(conn, 'daily_settlement', date_key, data)
        conn.commit()
    record_modification('daily_settlement', date_key, datetime.datetime.now().isoformat())


# ==================== Points ====================

def get_points_balance():
    with _db() as conn:
        return conn.execute("SELECT balance FROM points WHERE id = 1").fetchone()['balance']


def update_points(action, amount, detail):
    with _db() as conn:
        cur = conn.execute("SELECT balance FROM points WHERE id = 1")
        balance = cur.fetchone()['balance']

        if action == 'spend':
            balance -= amount
        else:
            balance += amount

        conn.execute("UPDATE points SET balance = ? WHERE id = 1", (balance,))

        today = datetime.date.today().isoformat()
        conn.execute(
            "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)",
            (today, amount if action == 'earn' else 0, amount if action == 'spend' else 0, balance, detail)
        )
        conn.commit()
        return balance


def reset_points():
    with _db() as conn:
        conn.execute("UPDATE points SET balance = 0 WHERE id = 1")
        conn.execute("DELETE FROM points_history")
        conn.commit()


# ==================== Shop ====================

def get_shop_items():
    with _db() as conn:
        _reset_daily_shop_quantity(conn)
        return _get_json(conn, 'shop_items')


def save_shop_items(items):
    with _db() as conn:
        _set_json(conn, 'shop_items', items)
        conn.commit()
    record_modification('shop_items', '1', datetime.datetime.now().isoformat())


# ==================== Redemptions ====================

def get_redemptions():
    with _db() as conn:
        return _get_json(conn, 'redemptions')


def save_redemptions(items):
    with _db() as conn:
        _set_json(conn, 'redemptions', items)
        conn.commit()
    record_modification('redemptions', '1', datetime.datetime.now().isoformat())


# ==================== Efficiency ====================

def get_efficiency(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'efficiency_history', date_key)


def save_efficiency(date_key, data):
    with _db() as conn:
        _set_date_data(conn, 'efficiency_history', date_key, data)
        conn.commit()
    record_modification('efficiency_history', date_key, datetime.datetime.now().isoformat())


# ==================== FreeTime ====================

def get_free_time(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'free_time_tasks', date_key, [])


def save_free_time(date_key, tasks):
    with _db() as conn:
        _set_date_data(conn, 'free_time_tasks', date_key, tasks)
        conn.commit()
    record_modification('free_time_tasks', date_key, datetime.datetime.now().isoformat())


# ==================== Settings ====================

def get_settings():
    with _db() as conn:
        return _get_json(conn, 'settings')


def save_settings(data):
    with _db() as conn:
        _set_json(conn, 'settings', data)
        conn.commit()
    record_modification('settings', '1', datetime.datetime.now().isoformat())


# ==================== Bounty Tasks ====================

def get_bounty_tasks():
    with _db() as conn:
        return _get_json(conn, 'bounty_tasks')


def save_bounty_tasks(items):
    with _db() as conn:
        _set_json(conn, 'bounty_tasks', items)
        conn.commit()
    record_modification('bounty_tasks', '1', datetime.datetime.now().isoformat())


def get_bounty_submissions(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'bounty_submissions', date_key, [])


def save_bounty_submissions(date_key, data):
    with _db() as conn:
        _set_date_data(conn, 'bounty_submissions', date_key, data)
        conn.commit()
    record_modification('bounty_submissions', date_key, datetime.datetime.now().isoformat())


def get_bounty_completions(date_key):
    with _db() as conn:
        return _get_date_data(conn, 'bounty_completions', date_key, {})


def save_bounty_completions(date_key, data):
    with _db() as conn:
        _set_date_data(conn, 'bounty_completions', date_key, data)
        conn.commit()
    record_modification('bounty_completions', date_key, datetime.datetime.now().isoformat())


# ==================== Active Buffs ====================

def get_active_buffs():
    with _db() as conn:
        return _get_json(conn, 'active_buffs')


def save_active_buffs(items):
    with _db() as conn:
        _set_json(conn, 'active_buffs', items)
        conn.commit()
    record_modification('active_buffs', '1', datetime.datetime.now().isoformat())


# ==================== Import / Export ====================

def import_full_data(data):
    """从完整 JSON 对象导入"""
    with _db() as conn:
        conn.execute("UPDATE points SET balance = ? WHERE id = 1",
                     (data.get('points', {}).get('balance', 0) if isinstance(data.get('points'), dict) else data.get('points', 0),))
        conn.execute("DELETE FROM points_history")
        for h in data.get('points', {}).get('history', []) if isinstance(data.get('points'), dict) else []:
            conn.execute(
                "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)",
                (h.get('date', ''), h.get('earned', 0), h.get('spent', 0), h.get('balance', 0), h.get('detail', ''))
            )
        conn.execute("UPDATE badges SET data = ? WHERE id = 1",
                     (json.dumps(data.get('badges', []), ensure_ascii=False),))
        for dk, v in data.get('homeworks', {}).items():
            conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        for dk, v in data.get('dailySettlement', {}).items():
            conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        conn.execute("UPDATE shop_items SET data = ? WHERE id = 1",
                     (json.dumps(data.get('shopItems', []), ensure_ascii=False),))
        conn.execute("UPDATE redemptions SET data = ? WHERE id = 1",
                     (json.dumps(data.get('redemptions', []), ensure_ascii=False),))
        conn.execute("UPDATE reward_box SET data = ? WHERE id = 1",
                     (json.dumps(data.get('rewardBox', []), ensure_ascii=False),))
        conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                     (json.dumps(data.get('settings', {}), ensure_ascii=False),))
        conn.execute("UPDATE active_buffs SET data = ? WHERE id = 1",
                     (json.dumps(data.get('activeBuffs', []), ensure_ascii=False),))
        for dk, v in data.get('efficiencyHistory', {}).items():
            conn.execute("INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        for dk, v in data.get('freeTimeTasks', {}).items():
            conn.execute("INSERT OR REPLACE INTO free_time_tasks (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        conn.execute("UPDATE bounty_tasks SET data = ? WHERE id = 1",
                     (json.dumps(data.get('bountyTasks', []), ensure_ascii=False),))
        for dk, v in data.get('bountySubmissions', {}).items():
            conn.execute("INSERT OR REPLACE INTO bounty_submissions (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        for dk, v in data.get('bountyCompletions', {}).items():
            conn.execute("INSERT OR REPLACE INTO bounty_completions (date_key, data) VALUES (?, ?)",
                         (dk, json.dumps(v, ensure_ascii=False)))
        conn.commit()


def reset_date(date_key):
    with _db() as conn:
        conn.execute("DELETE FROM homeworks WHERE date_key = ?", (date_key,))
        conn.execute("DELETE FROM daily_settlement WHERE date_key = ?", (date_key,))
        conn.execute("DELETE FROM efficiency_history WHERE date_key = ?", (date_key,))
        conn.execute("DELETE FROM free_time_tasks WHERE date_key = ?", (date_key,))
        conn.execute("DELETE FROM bounty_submissions WHERE date_key = ?", (date_key,))
        conn.execute("DELETE FROM bounty_completions WHERE date_key = ?", (date_key,))

        buffs = json.loads(conn.execute("SELECT data FROM active_buffs WHERE id = 1").fetchone()['data'])
        before_count = len(buffs)
        parts = date_key.split('-')
        iso_prefix = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
        buffs = [b for b in buffs if b.get('startDate','') != date_key and not b.get('startDate','').startswith(iso_prefix)]
        if len(buffs) != before_count:
            conn.execute("UPDATE active_buffs SET data = ? WHERE id = 1", (json.dumps(buffs, ensure_ascii=False),))

        conn.execute("DELETE FROM meta WHERE key = 'last_shop_reset'")
        conn.commit()


# ==================== Reward Box ====================

def get_reward_box():
    with _db() as conn:
        return _get_json(conn, 'reward_box')


def save_reward_box(items):
    with _db() as conn:
        _set_json(conn, 'reward_box', items)
        conn.commit()
    record_modification('reward_box', '1', datetime.datetime.now().isoformat())