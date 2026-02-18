import sqlite_utils
from typing import List, Dict

import os

DB_NAME = os.getenv("DATABASE_PATH", "stations.db")

def get_db():
    db = sqlite_utils.Database(DB_NAME)
    # Enable Full Text Search and create table if not exists
    if "stations" not in db.table_names():
        db["stations"].create({
            "uuid": str,
            "name": str,
            "url": str,
            "country": str,
            "tags": str,
            "lat": float,
            "lng": float,
            "source": str,
        }, pk="uuid")
        # Create index for fast geo-lookups
        db["stations"].create_index(["lat", "lng"])
    return db

def upsert_stations(stations: List[Dict]):
    db = get_db()
    # Batch upsert for performance
    db["stations"].upsert_all(stations, pk="uuid")

def query_stations(limit: int = 500):
    db = get_db()
    # Return stations with valid coordinates
    return list(db.query(f"SELECT * FROM stations WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT {limit}"))