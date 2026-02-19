import sqlite_utils
import os
from typing import List, Dict

# Preferred path (Umbrel volume)
# Ultimate fallback to /tmp/ which is guaranteed writable in Docker
DB_PATH = os.getenv("DATABASE_PATH", "/data/stations.db")
FALLBACK_PATH = "/tmp/stations.db"

def get_db():
    global DB_PATH
    
    # 1. Try Primary Path
    try:
        db_dir = os.path.dirname(DB_PATH)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        
        db = sqlite_utils.Database(DB_PATH)
        # Test if writable
        db.execute("CREATE TABLE IF NOT EXISTS _test (id INTEGER PRIMARY KEY)")
        return db
    except Exception as e:
        print(f"⚠️ Primary storage (/data) failed: {e}")
        
        # 2. Try Fallback Path (Absolute path in /tmp)
        try:
            print(f"🔄 Switching to absolute fallback: {FALLBACK_PATH}")
            DB_PATH = FALLBACK_PATH
            db = sqlite_utils.Database(DB_PATH)
            return db
        except Exception as e2:
            print(f"❌ All file storage failed: {e2}")
            # 3. Final resort: In-Memory (lost on restart, but app stays alive)
            return sqlite_utils.Database(memory=True)

def upsert_stations(stations: List[Dict]):
    if not stations: return
    try:
        db = get_db()
        db["stations"].upsert_all(stations, pk="uuid", alter=True)
        print(f"✅ Success: {len(stations)} stations saved to {DB_PATH}")
    except Exception as e:
        print(f"❌ Write Error: {e}")

def query_stations(limit: int = 2000):
    try:
        db = get_db()
        # Verify table exists before querying
        if "stations" not in db.table_names():
            return []
        return list(db.query(f"SELECT * FROM stations WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT {limit}"))
    except Exception as e:
        print(f"❌ Read Error: {e}")
        return []