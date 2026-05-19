import db
import json

db.init_db()
conn = db._connect()

print("=== homeworks ===")
for r in conn.execute("SELECT date_key, data FROM homeworks"):
    items = json.loads(r['data'])
    print(f"\n{r['date_key']}: {len(items)} items")
    for h in items:
        mode = h.get('mode', '-')
        status = h.get('status', '-')
        subj = h.get('subject', '-')
        content = h.get('content', '-')
        act = h.get('actualDuration', '-')
        sug = h.get('suggestedDuration', '-')
        ratio = act / sug if isinstance(act, (int, float)) and isinstance(sug, (int, float)) and sug > 0 else '-'
        print(f"  {subj} | {content} | mode={mode} | status={status} | actual={act}m | suggested={sug}m | ratio={ratio}")

print("\n=== daily_settlement ===")
for r in conn.execute("SELECT date_key, data FROM daily_settlement"):
    s = json.loads(r['data'])
    print(f"\n{r['date_key']}: basePoints={s.get('basePoints')}, efficiencyBonus={s.get('efficiencyBonus')}, rating={s.get('rating')}, finalPoints={s.get('finalPoints')}")

print("\n=== efficiency_history ===")
for r in conn.execute("SELECT date_key, data FROM efficiency_history"):
    e = json.loads(r['data'])
    print(f"  {r['date_key']}: {e}")

conn.close()
