"""
test_migrate_settlement.py — Settlement 数据迁移测试（TDD）
每个测试用例创建独立临时数据库，执行迁移后验证。
运行: python tools/test_migrate_settlement.py
"""
import json
import os
import sqlite3
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

MIGRATION_VERSION = 'settlement_v2'

pass_count = 0
fail_count = 0


def create_tables(conn):
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
        CREATE TABLE IF NOT EXISTS efficiency_history (
            date_key TEXT PRIMARY KEY,
            data TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
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
        CREATE TABLE IF NOT EXISTS reward_box (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS badges (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS active_buffs (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL DEFAULT '[]'
        );
        INSERT OR IGNORE INTO points (id, balance) VALUES (1, 0);
        INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}');
        INSERT OR IGNORE INTO shop_items (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO redemptions (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO reward_box (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO badges (id, data) VALUES (1, '[]');
        INSERT OR IGNORE INTO active_buffs (id, data) VALUES (1, '[]');
    """)


def make_old_settlement(rating, base_points=30, efficiency_bonus=5,
                          challenge_count=1, timer_count=1,
                          submitted_at="20:30", rated_at="21:00"):
    total = base_points + efficiency_bonus
    final = 0 if rating == '差' else total * 2.0
    return {
        'basePoints': base_points,
        'efficiencyBonus': efficiency_bonus,
        'totalBeforeRating': total,
        'challengeCount': challenge_count,
        'timerCount': timer_count,
        'rating': rating,
        'multiplier': 2.0,
        'finalPoints': final,
        'submittedAt': submitted_at,
        'ratedAt': rated_at,
    }


def make_homework(hw_id, mode='challenge', status='done', base_points=10,
                  rejected=False, suggested_duration=20, actual_duration=15):
    return {
        'id': hw_id,
        'subject': 'math',
        'content': 'test homework',
        'mode': mode,
        'suggestedDuration': suggested_duration,
        'basePoints': base_points,
        'status': status,
        'startedAt': '09:00',
        'completedAt': '09:15',
        'actualDuration': actual_duration,
        'rejected': rejected,
    }


def db_path(name):
    return os.path.join(tempfile.gettempdir(), f'_test_migrate_{name}.db')


def clean_db(path):
    if os.path.exists(path):
        os.remove(path)


def assert_eq(actual, expected, msg):
    global pass_count, fail_count
    if actual == expected:
        pass_count += 1
        print(f'  ✓ {msg}')
    else:
        fail_count += 1
        print(f'  ✗ {msg}')
        print(f'    expected: {expected!r}')
        print(f'    actual:   {actual!r}')


def assert_true(condition, msg):
    global pass_count, fail_count
    if condition:
        pass_count += 1
        print(f'  ✓ {msg}')
    else:
        fail_count += 1
        print(f'  ✗ {msg}')


def assert_false(condition, msg):
    assert_true(not condition, msg)


# ============================================================
#  Test Cases
# ============================================================


def tc01_empty_db():
    """TC-1: 空数据库 — 迁移标记写入，无错误"""
    print('\nTC-1: 空数据库')
    path = db_path('tc01')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT value FROM meta WHERE key = 'migration_version'").fetchone()
    assert_true(row is not None, "meta 表有 migration_version")
    if row:
        assert_eq(row['value'], MIGRATION_VERSION, "migration_version = settlement_v2")
    count = conn.execute("SELECT COUNT(*) as c FROM daily_settlement").fetchone()['c']
    assert_eq(count, 0, "settlement 表为空")
    conn.close()
    clean_db(path)


def tc02_challenge_only():
    """TC-2: 已评级 — 仅挑战成功作业"""
    print('\nTC-2: 已评级 — 仅挑战成功作业')
    path = db_path('tc02')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 50, "dailyBase=50")
    assert_eq(data['homeworkBonus'], 10, "homeworkBonus=10")
    assert_eq(data['totalBeforeRating'], 60, "totalBeforeRating=60")
    assert_eq(data['doneCount'], 1, "doneCount=1")
    assert_eq(data['rating'], '优', "rating 保留")
    assert_eq(data['multiplier'], 2.0, "multiplier 保留")
    assert_eq(data['finalPoints'], 20, "finalPoints 不变(旧值)")
    assert_false('basePoints' in data, "basePoints 已移除")
    assert_false('efficiencyBonus' in data, "efficiencyBonus 已移除")
    assert_false('challengeCount' in data, "challengeCount 已移除")
    assert_false('timerCount' in data, "timerCount 已移除")
    conn.close()
    clean_db(path)


def tc03_timer_only():
    """TC-3: 已评级 — 仅 timer 作业"""
    print('\nTC-3: 已评级 — 仅 timer 作业')
    path = db_path('tc03')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [make_homework('hw1', mode='timer', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('良', base_points=10, efficiency_bonus=0,
                            challenge_count=0, timer_count=1)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 50, "dailyBase=50")
    assert_eq(data['homeworkBonus'], 0, "homeworkBonus=0(timer不贡献)")
    assert_eq(data['totalBeforeRating'], 50, "totalBeforeRating=50")
    assert_eq(data['doneCount'], 1, "doneCount=1")
    conn.close()
    clean_db(path)


def tc04_mixed_challenge_timer():
    """TC-4: 已评级 — 混合 challenge + timer"""
    print('\nTC-4: 已评级 — 混合 challenge + timer')
    path = db_path('tc04')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [
        make_homework('hw1', mode='challenge', status='done', base_points=10),
        make_homework('hw2', mode='timer', status='done', base_points=5),
    ]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=15, efficiency_bonus=0,
                            challenge_count=1, timer_count=1)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 50, "dailyBase=50")
    assert_eq(data['homeworkBonus'], 10, "homeworkBonus=10(仅challenge)")
    assert_eq(data['totalBeforeRating'], 60, "totalBeforeRating=60")
    assert_eq(data['doneCount'], 2, "doneCount=2")
    conn.close()
    clean_db(path)


def tc05_rejected_challenge():
    """TC-5: 已评级 — 被驳回的 challenge 作业不计入"""
    print('\nTC-5: 已评级 — 被驳回 challenge 不计入')
    path = db_path('tc05')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [
        make_homework('hw1', mode='challenge', status='done', base_points=10, rejected=True),
        make_homework('hw2', mode='timer', status='done', base_points=5),
    ]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=15, efficiency_bonus=0,
                            challenge_count=1, timer_count=1)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['homeworkBonus'], 0, "homeworkBonus=0(rejected不计)")
    assert_eq(data['doneCount'], 1, "doneCount=1(仅timer)")
    conn.close()
    clean_db(path)


def tc06_overtime_demoted():
    """TC-6: 已评级 — 挑战超时降级为 timer 不计入 bonus"""
    print('\nTC-6: 已评级 — 挑战超时降级')
    path = db_path('tc06')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [make_homework('hw1', mode='timer', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('良', base_points=10, efficiency_bonus=0,
                            challenge_count=0, timer_count=1)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['homeworkBonus'], 0, "homeworkBonus=0(超时降级,不计)")
    assert_eq(data['doneCount'], 1, "doneCount=1")
    conn.close()
    clean_db(path)


def tc07_pending_not_counted():
    """TC-7: 已评级 — pending 作业不参与计算"""
    print('\nTC-7: 已评级 — pending 不参与')
    path = db_path('tc07')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [
        make_homework('hw1', mode='challenge', status='done', base_points=10),
        make_homework('hw2', mode='challenge', status='pending', base_points=5),
    ]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['homeworkBonus'], 10, "homeworkBonus=10(pending不计)")
    assert_eq(data['doneCount'], 1, "doneCount=1(pending不计)")
    conn.close()
    clean_db(path)


def tc08_unrated_deleted():
    """TC-8: 未评级 — 删除记录"""
    print('\nTC-8: 未评级 — 删除')
    path = db_path('tc08')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    s = make_old_settlement(None, base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    s['rating'] = None
    s['multiplier'] = None
    s['finalPoints'] = None
    s['ratedAt'] = None
    s['submittedAt'] = None
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    assert_true(row is None, "未评级记录已删除")
    conn.close()
    clean_db(path)


def tc09_custom_daily_base():
    """TC-9: 已评级 — 自定义 dailyBasePoints=80"""
    print('\nTC-9: 已评级 — 自定义 dailyBasePoints=80')
    path = db_path('tc09')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 80}),))
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 80, "dailyBase=80")
    assert_eq(data['totalBeforeRating'], 90, "totalBeforeRating=90")
    conn.close()
    clean_db(path)


def tc10_no_daily_base_setting():
    """TC-10: 已评级 — settings 无 dailyBasePoints，回退默认 50"""
    print('\nTC-10: 已评级 — 默认 dailyBase=50')
    path = db_path('tc10')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({}),))
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 50, "dailyBase=50(默认)")
    assert_eq(data['totalBeforeRating'], 60, "totalBeforeRating=60")
    conn.close()
    clean_db(path)


def tc11_idempotent():
    """TC-11: 幂等性 — 第二次执行跳过"""
    print('\nTC-11: 幂等性')
    path = db_path('tc11')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)
    count1 = _get_settlement_count(path)

    migrate(path)
    count2 = _get_settlement_count(path)
    assert_eq(count1, count2, "二次执行数据条数不变")
    assert_eq(count1, 1, "仍为 1 条已评级记录")
    clean_db(path)


def _get_settlement_count(db_path_):
    conn = sqlite3.connect(db_path_)
    c = conn.execute("SELECT COUNT(*) as c FROM daily_settlement").fetchone()[0]
    conn.close()
    return c


def tc12_points_unchanged():
    """TC-12: 积分余额不变"""
    print('\nTC-12: 积分余额不变')
    path = db_path('tc12')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    conn.execute("UPDATE points SET balance = 500 WHERE id = 1")
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    bal = conn.execute("SELECT balance FROM points WHERE id = 1").fetchone()['balance']
    assert_eq(bal, 500, "积分余额不变=500")
    conn.close()
    clean_db(path)


def tc13_no_homeworks():
    """TC-13: 已评级 — 无对应 homeworks 记录"""
    print('\nTC-13: 已评级 — 无 homeworks')
    path = db_path('tc13')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['dailyBase'], 50, "dailyBase=50")
    assert_eq(data['homeworkBonus'], 0, "homeworkBonus=0(无作业)")
    assert_eq(data['doneCount'], 0, "doneCount=0")
    assert_eq(data['totalBeforeRating'], 50, "totalBeforeRating=50")
    conn.close()
    clean_db(path)


def tc14_multiple_dates():
    """TC-14: 多日期批量迁移"""
    print('\nTC-14: 多日期批量迁移')
    path = db_path('tc14')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))

    dates = ['2025-01-01', '2025-01-02', '2025-01-03']
    for i, dk in enumerate(dates):
        hw = [make_homework(f'hw{dk}', mode='challenge', status='done', base_points=5 + i * 5)]
        conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                     (dk, json.dumps(hw, ensure_ascii=False)))
        s = make_old_settlement('优' if i < 2 else '良',
                                base_points=5 + i * 5, efficiency_bonus=0,
                                challenge_count=1, timer_count=0)
        conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                     (dk, json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT date_key, data FROM daily_settlement ORDER BY date_key").fetchall()
    assert_eq(len(rows), 3, "3 条记录全部保留")

    expected_bonus = [5, 10, 15]
    for row, exp_bonus in zip(rows, expected_bonus):
        data = json.loads(row['data'])
        assert_eq(data['homeworkBonus'], exp_bonus, f"{row['date_key']} homeworkBonus={exp_bonus}")
        assert_eq(data['dailyBase'], 50, f"{row['date_key']} dailyBase=50")
        assert_eq(data['doneCount'], 1, f"{row['date_key']} doneCount=1")
    conn.close()
    clean_db(path)


def tc15_viewed_at_preserved():
    """TC-15: 含 viewedAt 字段的 settlement，迁移后保留"""
    print('\nTC-15: viewedAt 保留')
    path = db_path('tc15')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [make_homework('hw1', mode='challenge', status='done', base_points=10)]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    s['viewedAt'] = '09:30'
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data.get('viewedAt'), '09:30', "viewedAt 保留")
    assert_eq(data['dailyBase'], 50, "dailyBase=50")
    conn.close()
    clean_db(path)


def tc16_missing_basepoints():
    """TC-16: homework 缺 basePoints 字段时 fallback 到 10"""
    print('\nTC-16: 缺 basePoints fallback')
    path = db_path('tc16')
    clean_db(path)
    conn = sqlite3.connect(path)
    create_tables(conn)
    conn.execute("UPDATE settings SET data = ? WHERE id = 1",
                 (json.dumps({'dailyBasePoints': 50}),))
    hw = [{
        'id': 'hw1',
        'subject': 'math',
        'content': 'test',
        'mode': 'challenge',
        'suggestedDuration': 20,
        'status': 'done',
        'startedAt': '09:00',
        'completedAt': '09:15',
        'actualDuration': 15,
    }]
    conn.execute("INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(hw, ensure_ascii=False)))
    s = make_old_settlement('优', base_points=10, efficiency_bonus=0,
                            challenge_count=1, timer_count=0)
    conn.execute("INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
                 ('2025-01-01', json.dumps(s, ensure_ascii=False)))
    conn.commit()
    conn.close()

    from migrate_settlement import migrate
    migrate(path)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT data FROM daily_settlement WHERE date_key = '2025-01-01'").fetchone()
    data = json.loads(row['data'])
    assert_eq(data['homeworkBonus'], 10, "homeworkBonus=10(fallback)")
    assert_eq(data['totalBeforeRating'], 60, "totalBeforeRating=60")
    conn.close()
    clean_db(path)


# ============================================================
#  Main
# ============================================================

if __name__ == '__main__':
    print('=' * 60)
    print('  Settlement 数据迁移测试')
    print('=' * 60)

    tc01_empty_db()
    tc02_challenge_only()
    tc03_timer_only()
    tc04_mixed_challenge_timer()
    tc05_rejected_challenge()
    tc06_overtime_demoted()
    tc07_pending_not_counted()
    tc08_unrated_deleted()
    tc09_custom_daily_base()
    tc10_no_daily_base_setting()
    tc11_idempotent()
    tc12_points_unchanged()
    tc13_no_homeworks()
    tc14_multiple_dates()
    tc15_viewed_at_preserved()
    tc16_missing_basepoints()

    print(f'\n{"=" * 60}')
    print(f'  结果: {pass_count} 通过, {fail_count} 失败')
    print(f'{"=" * 60}')
    sys.exit(0 if fail_count == 0 else 1)
