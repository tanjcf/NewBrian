import json
import sqlite3

db = sqlite3.connect(r"C:\Users\Administrator\.codecn\.codecn\brain.db")
db.row_factory = sqlite3.Row
rows = db.execute(
    """
    SELECT id, task_type, status, error_code,
           substr(error_detail, 1, 800) AS detail,
           started_at, finished_at
    FROM brain_task
    WHERE error_code != '' OR task_type LIKE '%render%'
    ORDER BY started_at DESC
    LIMIT 30
    """
).fetchall()
print(json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2))
try:
    engines = db.execute("SELECT * FROM brain_engine_runtime").fetchall()
    print("engines", json.dumps([dict(r) for r in engines], ensure_ascii=False, indent=2))
except Exception as exc:
    print("no engines", exc)
