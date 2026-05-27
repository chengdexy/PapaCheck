import json, os, sqlite3

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB = os.path.join(_BASE, 'PapaCheck.Server', 'data.db')

conn = sqlite3.connect(_DB)
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT value FROM meta WHERE key = 'migration_version'").fetchone()
print('迁移版本:', row['value'] if row else '未迁移')

rows = conn.execute("SELECT date_key, data FROM daily_settlement ORDER BY date_key DESC").fetchall()
print(f'共 {len(rows)} 条记录:')
for r in rows:
    d = json.loads(r['data'])
    print(f"  {r['date_key']}: dailyBase={d.get('dailyBase')}, homeworkBonus={d.get('homeworkBonus')}, totalBefore={d.get('totalBeforeRating')}, doneCount={d.get('doneCount')}, rating={d.get('rating')}, finalPoints={d.get('finalPoints')}")

conn.close()
