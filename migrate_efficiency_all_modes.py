"""
migrate_efficiency_all_modes.py

迁移脚本：重新计算所有历史日期的效率数据。
将效率统计从仅覆盖挑战模式作业，扩展为覆盖所有非驳回的已完成作业。

用法：
    python migrate_efficiency_all_modes.py <data.db路径>

此脚本无项目耦合，用后即删。
"""

import json
import sqlite3
import sys
import datetime
from math import ceil


def main():
    if len(sys.argv) < 2:
        print('用法: python migrate_efficiency_all_modes.py <data.db路径>')
        print('示例: python migrate_efficiency_all_modes.py ./data.db')
        sys.exit(1)

    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    # 1. 读取所有有作业记录的日期
    rows = conn.execute("SELECT date_key, data FROM homeworks").fetchall()
    print(f'找到 {len(rows)} 个日期有作业记录')

    updated_count = 0
    skipped_count = 0
    now_iso = datetime.datetime.now().isoformat()

    for row in rows:
        date_key = row['date_key']
        try:
            homeworks = json.loads(row['data'])
        except json.JSONDecodeError:
            print(f'  [跳过] {date_key}: JSON 解析失败')
            skipped_count += 1
            continue

        # 2. 按新规则计算效率：所有非驳回的已完成作业
        efficiency_hw = [
            h for h in homeworks
            if h.get('status') == 'done' and not h.get('rejected')
        ]

        ratios = []
        for h in efficiency_hw:
            actual = h.get('actualDuration')
            suggested = h.get('suggestedDuration', 0)
            if actual is not None and suggested > 0:
                ratios.append(actual / suggested)

        average_ratio = sum(ratios) / len(ratios) if ratios else 0

        # 3. 读取现有 efficiency 数据，比较是否有变化
        old_row = conn.execute(
            "SELECT data FROM efficiency_history WHERE date_key = ?",
            (date_key,)
        ).fetchone()

        old_ratios = []
        old_avg = 0
        if old_row:
            try:
                old_data = json.loads(old_row['data'])
                old_ratios = old_data.get('ratios', [])
                old_avg = old_data.get('averageRatio', 0)
            except json.JSONDecodeError:
                pass

        # 精度比较（四舍五入到 4 位小数）
        ratios_equal = (
            len(ratios) == len(old_ratios) and
            all(abs(a - b) < 0.0001 for a, b in zip(sorted(ratios), sorted(old_ratios)))
        )

        if ratios_equal and abs(average_ratio - old_avg) < 0.0001:
            skipped_count += 1
            continue

        # 4. 写入
        new_data = json.dumps({
            'averageRatio': average_ratio,
            'ratios': ratios,
        })

        conn.execute(
            "INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
            (date_key, new_data)
        )

        # 记录 last_modified
        conn.execute(
            "INSERT OR REPLACE INTO last_modified (table_name, record_key, last_modified) VALUES (?, ?, ?)",
            ('efficiency_history', date_key, now_iso)
        )

        updated_count += 1
        ratio_str = ', '.join(f'{r:.2f}' for r in ratios[:5])
        if len(ratios) > 5:
            ratio_str += f' ... ({len(ratios)}项)'
        print(f'  [更新] {date_key}: avg={average_ratio:.4f}  ratios=[{ratio_str}]'
              f'  (旧: {old_avg:.4f}, {len(old_ratios)}→{len(ratios)}项)')

    conn.commit()
    conn.close()

    print(f'\n完成！更新 {updated_count} 条，跳过 {skipped_count} 条（无变化）')


if __name__ == '__main__':
    main()
