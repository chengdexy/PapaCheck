"""
gen_test_data.py - 生成测试数据
向 data.db 写入模拟数据，方便管理端图表功能测试
用法:
  python gen_test_data.py           # 默认 60 天
  python gen_test_data.py -d 200    # 200 天
  python gen_test_data.py -d 90     # 90 天
"""
import argparse
import json
import os
import random
import sqlite3
import sys
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(SCRIPT_DIR, 'PapaCheck.Server', 'data.db')

SUBJECTS = [
    {'id': 'chinese', 'name': '语文'},
    {'id': 'math', 'name': '数学'},
    {'id': 'english', 'name': '英语'},
    {'id': 'sport', 'name': '体育'},
    {'id': 'other', 'name': '其他'},
]

CONTENT_POOL = {
    'chinese': ['生字练习', '阅读理解', '写日记', '背诵古诗', '造句练习'],
    'math': ['口算练习', '应用题', '奥数题', '竖式计算', '几何图形'],
    'english': ['单词背诵', '英语阅读', '英语听力', '英语对话', '字母书写'],
    'sport': ['跳绳练习', '跑步训练', '拍球练习', '仰卧起坐', '广播体操'],
    'other': ['画画', '手工', '练字', '收拾书包', '整理房间'],
}

RATINGS = [
    {'rating': '优', 'weight': 25},
    {'rating': '良', 'weight': 35},
    {'rating': '可', 'weight': 25},
    {'rating': '差', 'weight': 15},
]

RATING_MULTIPLIERS = { '优': 2.0, '良': 1.5, '可': 1.2, '差': 0 }

SHOP_TEMPLATES = [
    {'name': '游戏时间', 'type': 'time', 'points': 30, 'durationMinutes': 30},
    {'name': '看动画片', 'type': 'time', 'points': 20, 'durationMinutes': 20},
    {'name': '小玩具', 'type': 'item', 'points': 50, 'durationMinutes': 0},
    {'name': '冰淇淋', 'type': 'item', 'points': 15, 'durationMinutes': 0},
    {'name': '周末加餐', 'type': 'buff', 'points': 40, 'durationMinutes': 0, 'buffDuration': 1, 'buffUnit': 'days'},
    {'name': '公园游玩', 'type': 'time', 'points': 60, 'durationMinutes': 60},
    {'name': '贴纸奖励', 'type': 'item', 'points': 10, 'durationMinutes': 0},
    {'name': '故事时间', 'type': 'time', 'points': 25, 'durationMinutes': 15},
]


def _connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_tables(conn):
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
    """)


def weighted_choice(items):
    total = sum(item['weight'] for item in items)
    r = random.randint(1, total)
    cumulative = 0
    for item in items:
        cumulative += item['weight']
        if r <= cumulative:
            return item['rating']
    return items[0]['rating']


def pick_mode():
    return random.choice(['challenge', 'timer'])


def generate_test_data(days):
    end_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=days - 1)

    dates = []
    d = start_date
    while d <= end_date:
        dates.append(d)
        d += timedelta(days=1)

    all_homeworks = {}
    all_settlements = {}
    all_efficiency = {}
    total_points_balance = 0
    points_history = []
    point_id = 1

    for date_obj in dates:
        date_key = date_obj.strftime('%Y-%m-%d')

        num_hw = random.randint(3, 6)
        hw_list = []
        for i in range(num_hw):
            subj = random.choice(SUBJECTS)
            content = random.choice(CONTENT_POOL[subj['id']])

            is_done = random.random() < 0.75
            suggested_duration = random.choice([10, 15, 20, 25, 30])
            base_pts = random.choice([5, 10, 10, 10, 15])

            hw = {
                'id': f'hw_{date_key}_{i}',
                'subject': subj['id'],
                'content': content,
                'mode': pick_mode(),
                'suggestedDuration': suggested_duration,
                'basePoints': base_pts,
                'status': 'done' if is_done else 'pending',
                'startedAt': None,
                'completedAt': None,
                'actualDuration': None,
            }

            if is_done:
                ratio = random.uniform(0.4, 1.6)
                actual = max(1, round(suggested_duration * ratio))
                hw['actualDuration'] = actual
                start_h = random.randint(8, 20)
                start_m = random.randint(0, 59)
                hw['startedAt'] = f'{start_h:02d}:{start_m:02d}'
                end_time = start_h * 60 + start_m + actual
                hw['completedAt'] = f'{end_time // 60 % 24:02d}:{end_time % 60:02d}'

                if random.random() < 0.08:
                    hw['rejected'] = True

            hw_list.append(hw)

        done_hw = [h for h in hw_list if h['status'] == 'done' and not h.get('rejected')]
        challenge_success = [h for h in done_hw if h['mode'] == 'challenge']

        daily_base = 50
        homework_bonus = sum(h.get('basePoints', 10) for h in challenge_success)
        total_before_rating = daily_base + homework_bonus

        ratios = []
        for h in challenge_success:
            if h['actualDuration'] is not None and h['suggestedDuration'] > 0:
                r = h['actualDuration'] / h['suggestedDuration']
                ratios.append(r)

        avg_ratio = round(sum(ratios) / len(ratios), 2) if ratios else 0

        has_settlement = random.random() < 0.85
        if has_settlement and done_hw:
            rating = weighted_choice(RATINGS)

            mult = RATING_MULTIPLIERS[rating]

            final_points = 0 if rating == '差' else round(total_before_rating * mult)

            settlement = {
                'dailyBase': daily_base,
                'homeworkBonus': homework_bonus,
                'totalBeforeRating': total_before_rating,
                'doneCount': len(done_hw),
                'rating': rating,
                'multiplier': mult,
                'finalPoints': final_points,
                'submittedAt': f'{random.randint(17,21):02d}:{random.randint(0,59):02d}',
                'ratedAt': f'{random.randint(18,22):02d}:{random.randint(0,59):02d}',
            }

            all_settlements[date_key] = settlement

            if final_points > 0:
                total_points_balance += final_points
                points_history.append({
                    'id': point_id,
                    'date': date_key,
                    'earned': final_points,
                    'spent': 0,
                    'balance': total_points_balance,
                    'detail': f'完成作业，评级{rating}',
                })
                point_id += 1

            if random.random() < 0.3 and total_points_balance >= 10:
                spend = random.randint(5, min(30, total_points_balance))
                total_points_balance -= spend
                points_history.append({
                    'id': point_id,
                    'date': date_key,
                    'earned': 0,
                    'spent': spend,
                    'balance': total_points_balance,
                    'detail': f'兑换商品',
                })
                point_id += 1
        else:
            settlement = {
                'dailyBase': daily_base,
                'homeworkBonus': homework_bonus,
                'totalBeforeRating': total_before_rating,
                'doneCount': len(done_hw),
                'rating': None,
                'multiplier': None,
                'finalPoints': None,
                'submittedAt': None,
                'ratedAt': None,
            }
            all_settlements[date_key] = settlement

        all_homeworks[date_key] = hw_list

        eff_data = {
            'averageRatio': avg_ratio,
            'ratios': [round(r, 2) for r in ratios],
        }
        all_efficiency[date_key] = eff_data

    now = datetime.now()
    shop_items = []
    for i, tmpl in enumerate(SHOP_TEMPLATES):
        base_qty = random.randint(2, 5) if tmpl['type'] != 'buff' else 1
        item = {
            'id': f'shop_{i}',
            'name': tmpl['name'],
            'points': tmpl['points'],
            'type': tmpl['type'],
            'durationMinutes': tmpl['durationMinutes'],
            'baseQuantity': base_qty,
            'remainingQuantity': base_qty,
            'createdAt': int((now - timedelta(days=random.randint(10, 60))).timestamp() * 1000),
        }
        if tmpl['type'] == 'buff':
            item['buffDuration'] = tmpl.get('buffDuration', 1)
            item['buffUnit'] = tmpl.get('buffUnit', 'days')
        shop_items.append(item)

    reward_box = []
    reward_templates = random.sample(SHOP_TEMPLATES, min(3, len(SHOP_TEMPLATES)))
    for i, tmpl in enumerate(reward_templates):
        reward_box.append({
            'id': f'rw_{i}',
            'name': tmpl['name'],
            'type': tmpl['type'],
            'durationMinutes': tmpl['durationMinutes'] if tmpl['type'] == 'time' else 0,
            'quantity': 1,
            'createdAt': int((now - timedelta(days=random.randint(5, 30))).timestamp() * 1000),
        })

    redemptions = []
    for i in range(random.randint(8, 15)):
        tmpl = random.choice(SHOP_TEMPLATES)
        rd = now - timedelta(days=random.randint(1, days))
        redemptions.append({
            'id': f'rd_{i}',
            'itemName': tmpl['name'],
            'itemType': tmpl['type'],
            'durationMinutes': tmpl['durationMinutes'] if tmpl['type'] == 'time' else 0,
            'points': tmpl['points'],
            'status': random.choice(['pending', 'fulfilled']),
            'createdAt': rd.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
        })

    settings = {
        'dailyBasePoints': 100,
        'homeworkBonusPerTask': 10,
        'homeworkDefaultSuggestedDuration': 20,
        'ratingMultipliers': RATING_MULTIPLIERS,
        'shopDefaultPoints': 50,
        'theme': 'dark',
        'bgmEnabled': True,
        'ttsEnabled': True,
    }

    conn = _connect()
    conn.execute("DELETE FROM homeworks")
    conn.execute("DELETE FROM daily_settlement")
    conn.execute("DELETE FROM efficiency_history")
    conn.execute("DELETE FROM points_history")
    conn.execute("DELETE FROM free_time_tasks")
    conn.execute("DELETE FROM meta")
    conn.execute("DELETE FROM shop_items")
    conn.execute("DELETE FROM redemptions")
    conn.execute("DELETE FROM reward_box")
    conn.execute("DELETE FROM settings")
    conn.execute("DELETE FROM badges")
    conn.execute("DELETE FROM active_buffs")
    conn.execute("DELETE FROM points")

    conn.execute("INSERT OR REPLACE INTO points (id, balance) VALUES (1, ?)", (total_points_balance,))

    for ph in points_history:
        conn.execute(
            "INSERT INTO points_history (id, date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?, ?)",
            (ph['id'], ph['date'], ph['earned'], ph['spent'], ph['balance'], ph['detail']),
        )

    for date_key, hw_list in all_homeworks.items():
        conn.execute(
            "INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)",
            (date_key, json.dumps(hw_list, ensure_ascii=False)),
        )

    for date_key, settlement in all_settlements.items():
        conn.execute(
            "INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)",
            (date_key, json.dumps(settlement, ensure_ascii=False)),
        )

    for date_key, eff in all_efficiency.items():
        conn.execute(
            "INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)",
            (date_key, json.dumps(eff, ensure_ascii=False)),
        )

    conn.execute(
        "INSERT OR REPLACE INTO shop_items (id, data) VALUES (1, ?)",
        (json.dumps(shop_items, ensure_ascii=False),),
    )

    conn.execute(
        "INSERT OR REPLACE INTO redemptions (id, data) VALUES (1, ?)",
        (json.dumps(redemptions, ensure_ascii=False),),
    )

    conn.execute(
        "INSERT OR REPLACE INTO reward_box (id, data) VALUES (1, ?)",
        (json.dumps(reward_box, ensure_ascii=False),),
    )

    conn.execute(
        "INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)",
        (json.dumps(settings, ensure_ascii=False),),
    )

    conn.execute(
        "INSERT OR REPLACE INTO badges (id, data) VALUES (1, '[]')"
    )
    conn.execute(
        "INSERT OR REPLACE INTO active_buffs (id, data) VALUES (1, '[]')"
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)",
        (now.strftime('%Y-%m-%d'),),
    )

    conn.commit()
    conn.close()

    total_rated = sum(1 for s in all_settlements.values() if s.get('rating'))
    total_unrated = sum(1 for s in all_settlements.values() if not s.get('rating'))
    rating_dist = {}
    for s in all_settlements.values():
        r = s.get('rating')
        if r:
            rating_dist[r] = rating_dist.get(r, 0) + 1

    print(f'✅ 测试数据已写入: {DB_FILE}')
    print(f'   数据天数: {days} 天')
    print(f'   作业条目: {sum(len(v) for v in all_homeworks.values())} 条')
    print(f'   已评级天数: {total_rated} 天')
    print(f'   未评级天数: {total_unrated} 天')
    print(f'   评级分布: {rating_dist}')
    print(f'   积分总额: {total_points_balance}')
    print(f'   商店商品: {len(shop_items)} 个')
    print(f'   兑换记录: {len(redemptions)} 条')
    print(f'   奖励箱: {len(reward_box)} 个')
    print(f'   积分变动: {len(points_history)} 条')


def main():
    parser = argparse.ArgumentParser(description='向 data.db 生成测试数据')
    parser.add_argument('-d', type=int, default=60, help='生成数据的天数（默认 60）')
    args = parser.parse_args()

    if args.d < 1:
        print('❌ 天数必须 >= 1')
        sys.exit(1)

    if not os.path.exists(os.path.dirname(DB_FILE)):
        print(f'❌ 数据库目录不存在: {os.path.dirname(DB_FILE)}')
        print('   请确保在项目根目录下运行')
        sys.exit(1)

    conn = _connect()
    init_tables(conn)
    conn.close()

    generate_test_data(args.d)


if __name__ == '__main__':
    main()
