import sqlite3
import sys

db_path = r'C:\Users\Administrator\AppData\Roaming\AgentSC\AgentSC\agentsc.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM file_events WHERE day='2026-07-27'")
print('events today:', cur.fetchone()[0])

cur.execute("SELECT type, COUNT(*) FROM file_events WHERE day='2026-07-27' GROUP BY type")
print('by type:', cur.fetchall())

cur.execute("""
  SELECT
    SUM(CASE WHEN type = 'created' THEN 1 ELSE 0 END) AS created_count,
    SUM(CASE WHEN type = 'deleted' THEN 1 ELSE 0 END) AS deleted_count,
    SUM(CASE WHEN type = 'created' THEN COALESCE(size, 0) ELSE 0 END) AS created_bytes,
    SUM(CASE WHEN type = 'deleted' THEN COALESCE(size, 0) ELSE 0 END) AS deleted_bytes
  FROM file_events
  WHERE day = '2026-07-27'
""")
print('daily stats:', cur.fetchone())

conn.close()
