"""
test_migrate_actual_duration.py - 作业用时迁移脚本单元测试

测试 migrate_actual_duration.py 中的 migrate() 函数：
修正 actualDuration 小于建议挑战时长20%且≤1分钟的异常数据
"""

import json
import os
import sys
import tempfile

import pytest

_PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
_SERVER_DIR = os.path.join(_PROJECT_ROOT, 'PapaCheck.Server')


def _import_migrate_module():
    """导入 migrate_actual_duration 模块，确保从正确的路径导入"""
    if _SERVER_DIR not in sys.path:
        sys.path.insert(0, _SERVER_DIR)
    # 清除可能存在的缓存模块
    for mod in list(sys.modules.keys()):
        if 'migrate_actual_duration' in mod or (mod == 'db' and hasattr(sys.modules[mod], 'DB_FILE')):
            del sys.modules[mod]
    import migrate_actual_duration as mod
    # 重新加载以确保使用最新的代码
    import importlib
    importlib.reload(mod)
    return mod


# ========== 固定数据 ==========

def _make_hw(hw_id, subject, status, mode, actual_duration, suggested_duration):
    return {
        'id': hw_id,
        'subject': subject,
        'content': f'测试作业 {hw_id}',
        'mode': mode,
        'suggestedDuration': suggested_duration,
        'basePoints': 10,
        'status': status,
        'actualDuration': actual_duration,
    }


@pytest.fixture
def db_path():
    """创建临时 SQLite 数据库，写入固定数据供测试"""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_file = os.path.join(tmpdir, 'test.db')
        import sqlite3
        conn = sqlite3.connect(db_file)

        # 创建 homeworks 表
        conn.execute(
            'CREATE TABLE IF NOT EXISTS homeworks (date_key TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT \'[]\')'
        )
        # 创建 efficiency_history 表
        conn.execute(
            'CREATE TABLE IF NOT EXISTS efficiency_history (date_key TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT \'{}\')'
        )
        # 创建 meta 表
        conn.execute(
            'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
        )

        # ---- 写入测试数据 ----
        # 日期1: 有两条匹配条件的作业
        hw_list_1 = [
            # Scenario 1: actualDuration=1, suggestedDuration=10 → 应修正为10
            _make_hw('hw_1a', '语文', 'done', 'challenge', 1, 10),
            # Scenario 2: 正常作业，不应修正
            _make_hw('hw_1b', '数学', 'done', 'challenge', 5, 20),
            # Scenario 3: actualDuration=1, suggestedDuration=3 (1 > 3*0.2=0.6, <=1) → 不修正
            _make_hw('hw_1c', '英语', 'done', 'challenge', 1, 3),
            # pending 状态的作业，不应处理
            _make_hw('hw_1d', '科学', 'pending', 'challenge', None, 10),
        ]
        conn.execute(
            'INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)',
            ('2026-06-01', json.dumps(hw_list_1, ensure_ascii=False))
        )

        # 日期2: 一条匹配 + efficiency_history 记录
        hw_list_2 = [
            # Scenario 5: actualDuration=0, suggestedDuration=5 → 应修正为5
            _make_hw('hw_2a', '数学', 'done', 'challenge', 0, 5),
            # 正常
            _make_hw('hw_2b', '语文', 'done', 'challenge', 8, 10),
        ]
        conn.execute(
            'INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)',
            ('2026-06-02', json.dumps(hw_list_2, ensure_ascii=False))
        )
        # 写入 efficiency_history
        conn.execute(
            'INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)',
            ('2026-06-02', json.dumps({
                'averageRatio': 0.4,
                'ratios': [0.0, 0.8]
            }, ensure_ascii=False))
        )

        conn.commit()
        conn.close()
        yield db_file


class TestMigrateActualDuration:

    def test_fixes_matching_records(self, db_path):
        """Scenario: 迁移发现并修正符合条件的作业记录"""
        mod = _import_migrate_module()
        mod.migrate(db_path)

        # 验证
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        rows = dict(
            conn.execute("SELECT date_key, data FROM homeworks").fetchall()
        )
        hw_1 = json.loads(rows['2026-06-01'])
        hw_2 = json.loads(rows['2026-06-02'])

        # hw_1a: 1→10（应修正）
        assert hw_1[0]['actualDuration'] == 10, f"expected 10, got {hw_1[0]['actualDuration']}"
        # hw_1b: 5→5（不应修正）
        assert hw_1[1]['actualDuration'] == 5, f"expected 5, got {hw_1[1]['actualDuration']}"
        # hw_1c: 1→1（不应修正，1 > 3*0.2=0.6）
        assert hw_1[2]['actualDuration'] == 1, f"expected 1, got {hw_1[2]['actualDuration']}"
        # hw_2a: 0→5（应修正）
        assert hw_2[0]['actualDuration'] == 5, f"expected 5, got {hw_2[0]['actualDuration']}"

        conn.close()

    def test_updates_efficiency_history(self, db_path):
        """Scenario: 迁移同时更新 efficiency_history"""
        mod = _import_migrate_module()
        mod.migrate(db_path)

        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        eff_row = conn.execute(
            "SELECT data FROM efficiency_history WHERE date_key = '2026-06-02'"
        ).fetchone()
        assert eff_row is not None
        eff = json.loads(eff_row['data'])
        # 修正后：hw_2a=5/5=1.0, hw_2b=8/10=0.8 → ratios=[1.0, 0.8], avg=0.9
        assert eff['ratios'] == [1.0, 0.8], f"expected [1.0, 0.8], got {eff['ratios']}"
        assert abs(eff['averageRatio'] - 0.9) < 0.001, f"expected ~0.9, got {eff['averageRatio']}"

        conn.close()

    def test_idempotent_on_rerun(self, db_path):
        """Scenario: 迁移幂等性 - 重复运行不重复修正"""
        mod = _import_migrate_module()
        mod.migrate(db_path)  # 第一次运行

        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        # 检查 meta 表已有标记
        meta = conn.execute(
            "SELECT value FROM meta WHERE key = 'migrated_actual_duration'"
        ).fetchone()
        assert meta is not None

        # 第二次运行，应跳过
        mod.migrate(db_path)

        conn.close()

    def test_does_not_modify_non_matching_records(self, db_path):
        """Scenario: 不修改不匹配条件的记录"""
        mod = _import_migrate_module()
        mod.migrate(db_path)

        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        rows = dict(
            conn.execute("SELECT date_key, data FROM homeworks").fetchall()
        )
        hw_1 = json.loads(rows['2026-06-01'])

        # hw_1b: actualDuration=5, suggestedDuration=20, 5 > 20*0.2=4, 不应修正
        assert hw_1[1]['actualDuration'] == 5
        # hw_1c: actualDuration=1, suggestedDuration=3, 1 > 3*0.2=0.6, 不应修正
        assert hw_1[2]['actualDuration'] == 1
        # hw_1d: pending 状态，不应处理
        assert hw_1[3]['actualDuration'] is None

        conn.close()

    def test_script_can_run_from_any_directory(self, db_path):
        """Scenario: 迁移脚本可从非 Server 目录运行（使用 --db 参数）"""
        import subprocess
        result = subprocess.run(
            [sys.executable, os.path.join(_SERVER_DIR, 'migrate_actual_duration.py'),
             '--db', db_path],
            capture_output=True, text=True, cwd=_PROJECT_ROOT
        )
        assert result.returncode == 0, f"脚本运行失败: {result.stderr}"
        assert '修正了 2 条作业记录' in result.stdout, f"未找到修正记录: {result.stdout}"

    def test_script_idempotent_via_cli(self, db_path):
        """Scenario: 通过 CLI 运行也是幂等的"""
        import subprocess
        script = os.path.join(_SERVER_DIR, 'migrate_actual_duration.py')

        # 第一次运行
        subprocess.run(
            [sys.executable, script, '--db', db_path],
            capture_output=True, text=True, cwd=_PROJECT_ROOT
        )
        # 第二次运行
        result = subprocess.run(
            [sys.executable, script, '--db', db_path],
            capture_output=True, text=True, cwd=_PROJECT_ROOT
        )
        assert result.returncode == 0
        assert '已迁移过' in result.stdout, f"期望跳过，得到: {result.stdout}"