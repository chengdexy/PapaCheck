"""
migrate_settlement.py — Settlement 数据迁移脚本
将 daily_settlement 表从旧格式迁移到新格式。
用法:
  python tools/migrate_settlement.py                  # 迁移默认数据库
  python tools/migrate_settlement.py /path/to/db      # 迁移指定数据库
"""
import json
import os
import shutil
import sqlite3
import sys

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DB = os.path.join(_BASE, 'PapaCheck.Server', 'data.db')
MIGRATION_VERSION = 'settlement_v2'
DEFAULT_DAILY_BASE = 50


def migrate(db_path=None):
    if db_path is None:
        db_path = _DEFAULT_DB

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute("SELECT value FROM meta WHERE key = 'migration_version'").fetchone()
    if row and row['value'] == MIGRATION_VERSION:
        print('迁移已完成，跳过')
        conn.close()
        return

    backup_path = db_path + '.bak.' + MIGRATION_VERSION
    if not os.path.exists(backup_path):
        conn.close()
        shutil.copy2(db_path, backup_path)
        print(f'已备份数据库至: {backup_path}')
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

    settings_row = conn.execute("SELECT data FROM settings WHERE id = 1").fetchone()
    settings = json.loads(settings_row['data']) if settings_row else {}
    daily_base = settings.get('dailyBasePoints', DEFAULT_DAILY_BASE)

    settlements = conn.execute("SELECT date_key, data FROM daily_settlement").fetchall()

    updated = 0
    deleted = 0
    for s in settlements:
        date_key = s['date_key']
        data = json.loads(s['data'])

        if data.get('rating') is not None:
            hw_row = conn.execute(
                "SELECT data FROM homeworks WHERE date_key = ?", (date_key,)
            ).fetchone()
            hw_list = json.loads(hw_row['data']) if hw_row else []

            challenge_success = [
                h for h in hw_list
                if h.get('mode') == 'challenge'
                and h.get('status') == 'done'
                and not h.get('rejected')
            ]
            done_hw = [
                h for h in hw_list
                if h.get('status') == 'done'
                and not h.get('rejected')
            ]

            homework_bonus = sum(h.get('basePoints', 10) for h in challenge_success)

            data['dailyBase'] = daily_base
            data['homeworkBonus'] = homework_bonus
            data['totalBeforeRating'] = daily_base + homework_bonus
            data['doneCount'] = len(done_hw)

            data.pop('basePoints', None)
            data.pop('efficiencyBonus', None)
            data.pop('challengeCount', None)
            data.pop('timerCount', None)

            conn.execute(
                "UPDATE daily_settlement SET data = ? WHERE date_key = ?",
                (json.dumps(data, ensure_ascii=False), date_key)
            )
            updated += 1
        else:
            conn.execute("DELETE FROM daily_settlement WHERE date_key = ?", (date_key,))
            deleted += 1

    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('migration_version', ?)",
        (MIGRATION_VERSION,)
    )
    conn.commit()
    conn.close()

    print(f'迁移完成: {updated} 条已评级记录已更新, {deleted} 条未评级记录已删除')


if __name__ == '__main__':
    db_arg = sys.argv[1] if len(sys.argv) > 1 else None
    migrate(db_arg)
