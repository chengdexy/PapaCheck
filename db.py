"""
db.py - SQLite 数据库层
单文件数据库 data.db，零依赖，Python 标准库 sqlite3
"""
import json
import os
import sqlite3

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.db')


def _connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    conn = _connect()
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

        INSERT OR IGNORE INTO points (id, balance) VALUES (1, 0);
        INSERT OR IGNORE INTO shop_items (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO redemptions (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO badges (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO reward_box (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}');
    """)
    conn.commit()
    conn.close()


# ==================== Full Data ====================

def get_full_data():
    """返回与旧 JSON 格式兼容的完整数据"""
    _reset_daily_shop_quantity()
    conn = _connect()
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

    conn.close()
    return data


# ==================== Homeworks ====================

def get_homeworks(date_key):
    conn = _connect()
    row = conn.execute("SELECT data FROM homeworks WHERE date_key = ?", (date_key,)).fetchone()
    conn.close()
    return json.loads(row['data']) if row else []


def save_homeworks(date_key, items):
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
        (date_key, json.dumps(items, ensure_ascii=False))
    )
    conn.commit()
    conn.close()


# ==================== Settlement ====================

def get_settlement(date_key):
    conn = _connect()
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = ?", (date_key,)).fetchone()
    conn.close()
    return json.loads(row['data']) if row else None


def save_settlement(date_key, data):
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
        (date_key, json.dumps(data, ensure_ascii=False))
    )
    conn.commit()
    conn.close()


# ==================== Points ====================

def get_points_balance():
    conn = _connect()
    balance = conn.execute("SELECT balance FROM points WHERE id = 1").fetchone()['balance']
    conn.close()
    return balance


def update_points(action, amount, detail):
    conn = _connect()
    cur = conn.execute("SELECT balance FROM points WHERE id = 1")
    balance = cur.fetchone()['balance']

    if action == 'spend':
        balance -= amount
    else:
        balance += amount

    conn.execute("UPDATE points SET balance = ? WHERE id = 1", (balance,))

    import datetime
    today = datetime.date.today().isoformat()
    conn.execute(
        "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)",
        (today, amount if action == 'earn' else 0, amount if action == 'spend' else 0, balance, detail)
    )
    conn.commit()
    conn.close()
    return balance


def reset_points():
    conn = _connect()
    conn.execute("UPDATE points SET balance = 0 WHERE id = 1")
    conn.execute("DELETE FROM points_history")
    conn.commit()
    conn.close()


# ==================== Shop ====================

def get_shop_items():
    _reset_daily_shop_quantity()
    conn = _connect()
    data = conn.execute("SELECT data FROM shop_items WHERE id = 1").fetchone()['data']
    conn.close()
    return json.loads(data)


def save_shop_items(items):
    conn = _connect()
    conn.execute("UPDATE shop_items SET data = ? WHERE id = 1", (json.dumps(items, ensure_ascii=False),))
    conn.commit()
    conn.close()


def _reset_daily_shop_quantity():
    import datetime
    today = datetime.date.today().isoformat()
    conn = _connect()
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
    conn.close()


# ==================== Redemptions ====================

def get_redemptions():
    conn = _connect()
    data = conn.execute("SELECT data FROM redemptions WHERE id = 1").fetchone()['data']
    conn.close()
    return json.loads(data)


def save_redemptions(items):
    conn = _connect()
    conn.execute("UPDATE redemptions SET data = ? WHERE id = 1", (json.dumps(items, ensure_ascii=False),))
    conn.commit()
    conn.close()


# ==================== Efficiency ====================

def get_efficiency(date_key):
    conn = _connect()
    row = conn.execute("SELECT data FROM efficiency_history WHERE date_key = ?", (date_key,)).fetchone()
    conn.close()
    return json.loads(row['data']) if row else None


def save_efficiency(date_key, data):
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
        (date_key, json.dumps(data, ensure_ascii=False))
    )
    conn.commit()
    conn.close()


# ==================== FreeTime ====================

def get_free_time(date_key):
    conn = _connect()
    row = conn.execute("SELECT data FROM free_time_tasks WHERE date_key = ?", (date_key,)).fetchone()
    conn.close()
    return json.loads(row['data']) if row else []


def save_free_time(date_key, tasks):
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO free_time_tasks (date_key, data) VALUES (?, ?)",
        (date_key, json.dumps(tasks, ensure_ascii=False))
    )
    conn.commit()
    conn.close()


# ==================== Settings ====================

def get_settings():
    conn = _connect()
    data = conn.execute("SELECT data FROM settings WHERE id = 1").fetchone()['data']
    conn.close()
    return json.loads(data)


def save_settings(data):
    conn = _connect()
    conn.execute("UPDATE settings SET data = ? WHERE id = 1", (json.dumps(data, ensure_ascii=False),))
    conn.commit()
    conn.close()


# ==================== Import / Export ====================

def import_full_data(data):
    """从完整 JSON 对象导入"""
    conn = _connect()
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
    for dk, v in data.get('efficiencyHistory', {}).items():
        conn.execute("INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
                     (dk, json.dumps(v, ensure_ascii=False)))
    for dk, v in data.get('freeTimeTasks', {}).items():
        conn.execute("INSERT OR REPLACE INTO free_time_tasks (date_key, data) VALUES (?, ?)",
                     (dk, json.dumps(v, ensure_ascii=False)))
    conn.commit()
    conn.close()


def reset_date(date_key):
    conn = _connect()
    conn.execute("DELETE FROM homeworks WHERE date_key = ?", (date_key,))
    conn.execute("DELETE FROM daily_settlement WHERE date_key = ?", (date_key,))
    conn.execute("DELETE FROM efficiency_history WHERE date_key = ?", (date_key,))
    conn.execute("DELETE FROM free_time_tasks WHERE date_key = ?", (date_key,))
    conn.execute("DELETE FROM meta WHERE key = 'last_shop_reset'")
    conn.commit()
    conn.close()


# ==================== Reward Box ====================

def get_reward_box():
    conn = _connect()
    data = conn.execute("SELECT data FROM reward_box WHERE id = 1").fetchone()['data']
    conn.close()
    return json.loads(data)


def save_reward_box(items):
    conn = _connect()
    conn.execute("UPDATE reward_box SET data = ? WHERE id = 1", (json.dumps(items, ensure_ascii=False),))
    conn.commit()
    conn.close()


def _row_to_dict(row):
    return {k: row[k] for k in row.keys()}
