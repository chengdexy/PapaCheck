"""
migration.py - 一键 JSON → SQLite 迁移 + 数据初始化
用法: python migration.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')


def migrate():
    print("=" * 50)
    print("  PapaCheck（爸~检查！）数据迁移: JSON → SQLite")
    print("=" * 50)

    db.init_db()

    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"\n  [✓] 读取 data.json ({len(json.dumps(data, ensure_ascii=False))} bytes)")

        db.import_full_data(data)
        print(f"  [✓] 迁移完成")

        bak = DATA_FILE + '.bak'
        os.rename(DATA_FILE, bak)
        print(f"  [✓] data.json 已备份为 data.json.bak")
    else:
        print("\n  [!] data.json 不存在，初始化空白数据库")
        db.init_db()

    db.save_homeworks("2026-05-18", [])
    db.save_settlement("2026-05-18", {})
    db.save_efficiency("2026-05-18", {})

    print(f"\n  [✓] 数据库文件: data.db")
    print(f"  [✓] 数据已初始化")
    print("\n  现在可以运行: python server.py")
    print("=" * 50)


if __name__ == '__main__':
    migrate()
