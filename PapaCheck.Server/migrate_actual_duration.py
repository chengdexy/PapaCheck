"""
migrate_actual_duration.py - 一次性脚本：修正 actualDuration 异常数据

规则：actualDuration <= suggestedDuration * 0.2 且 actualDuration <= 1 时，
      修正 actualDuration = suggestedDuration
同时修正对应的 efficiency_history 数据
幂等性：通过 meta 表标记 'migrated_actual_duration' 防止重复执行

用法：python migrate_actual_duration.py [--db PATH]
"""

import json
import os
import sys
import datetime

# 支持指定数据库路径
if '--db' in sys.argv:
    db_idx = sys.argv.index('--db')
    DB_FILE = sys.argv[db_idx + 1]
else:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from db import DB_FILE

import sqlite3


def clamp_actual_duration(actual_duration, suggested_duration):
    """与 app.js 中 clampActualDuration 相同的逻辑"""
    if suggested_duration > 0 and actual_duration <= suggested_duration * 0.2 and actual_duration <= 1:
        return suggested_duration
    return actual_duration


def migrate(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # 1. 检查是否已迁移
    meta_row = conn.execute(
        "SELECT value FROM meta WHERE key = 'migrated_actual_duration'"
    ).fetchone()
    if meta_row:
        print(f"已迁移过（{meta_row['value']}），跳过")
        conn.close()
        return

    # 2. 读取所有作业数据
    hw_rows = conn.execute("SELECT date_key, data FROM homeworks").fetchall()
    total_fixed = 0
    fixed_dates = set()

    for row in hw_rows:
        date_key = row['date_key']
        hw_list = json.loads(row['data'])
        date_fixed = 0

        for hw in hw_list:
            if (hw.get('status') == 'done'
                    and hw.get('actualDuration') is not None
                    and hw.get('suggestedDuration', 0) > 0):
                old_val = hw['actualDuration']
                new_val = clamp_actual_duration(old_val, hw['suggestedDuration'])
                if new_val != old_val:
                    hw['actualDuration'] = new_val
                    date_fixed += 1
                    total_fixed += 1
                    print(f"  {date_key} {hw.get('subject', '?')}: "
                          f"{old_val}分钟 -> {new_val}分钟 "
                          f"(建议{hw['suggestedDuration']}分钟)")

        if date_fixed > 0:
            fixed_dates.add(date_key)
            conn.execute(
                "UPDATE homeworks SET data = ? WHERE date_key = ?",
                (json.dumps(hw_list, ensure_ascii=False), date_key)
            )

    # 3. 修正 efficiency_history
    for date_key in fixed_dates:
        eff_row = conn.execute(
            "SELECT data FROM efficiency_history WHERE date_key = ?",
            (date_key,)
        ).fetchone()

        # 重新从修正后的作业数据计算效率比
        hw_row = conn.execute(
            "SELECT data FROM homeworks WHERE date_key = ?",
            (date_key,)
        ).fetchone()
        if not hw_row:
            continue

        hw_list = json.loads(hw_row['data'])
        done_hw = [h for h in hw_list if h.get('status') == 'done' and not h.get('rejected')]
        challenge_success = [h for h in done_hw if h.get('mode') == 'challenge']

        ratios = []
        for hw in challenge_success:
            if hw.get('actualDuration') is not None and hw.get('suggestedDuration', 0) > 0:
                ratios.append(hw['actualDuration'] / hw['suggestedDuration'])

        average_ratio = sum(ratios) / len(ratios) if ratios else 0

        if eff_row:
            eff_data = json.loads(eff_row['data'])
            eff_data['averageRatio'] = average_ratio
            eff_data['ratios'] = ratios
            conn.execute(
                "UPDATE efficiency_history SET data = ? WHERE date_key = ?",
                (json.dumps(eff_data, ensure_ascii=False), date_key)
            )
        else:
            conn.execute(
                "INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
                (date_key, json.dumps({'averageRatio': average_ratio, 'ratios': ratios}, ensure_ascii=False))
            )

        print(f"  效率历史 {date_key}: averageRatio={average_ratio:.4f}, ratios={ratios}")

    # 4. 写入迁移标记
    now = datetime.datetime.now().isoformat()
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        ('migrated_actual_duration', now)
    )

    conn.commit()
    conn.close()

    print(f"\n迁移完成：修正了 {total_fixed} 条作业记录，涉及 {len(fixed_dates)} 天")
    if total_fixed == 0:
        print("无需修正的数据")


if __name__ == '__main__':
    migrate(DB_FILE)
