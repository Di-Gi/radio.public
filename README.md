### Project Structure

Create a folder named `geo-radio` and set up this structure:

```text
geo-radio/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py          # API & App Logic
    ├── database.py      # SQLite wrapper
    ├── parsers/         # DROP NEW PARSERS HERE
    │   ├── __init__.py
    │   └── radio_browser.py
    └── static/
        ├── index.html   # The Midnight Globe UI
        └── style.css
```

---

The architecture is designed for extensibility. If you find a new list of stations (e.g., a local CSV file or a different API), you do not need to rewrite the app.

1.  Create a new file: `app/parsers/my_custom_list.py`.
2.  Add a class structure like this:

```python
import csv

class MyLocalParser:
    source_name = "local_csv_dump"

    async def fetch_and_parse(self):
        # Logic to read a local file or different API
        # Return list of dicts: 
        # [{'uuid': '...', 'name': '...', 'url': '...', 'lat': 50.0, 'lng': 10.0}]
        return []
```

3.  **Restart the container** (or hit the `/api/refresh` endpoint). The `main.py` script automatically discovers this file, runs the class, and upserts the data into the SQLite database.

### Key Features Summary

1.  **Minimalist:** Python FastAPI backend + Plain JS frontend. No build steps (Webpack/React) required.
2.  **Midnight Aesthetic:** Uses Globe.gl with black/green wireframe styling.
3.  **Data Agnostic:** The `parsers/` folder allows you to write specific "sub-parsers" for messy data sources (JSON, CSV, XML) and normalize them into the central SQLite DB.
4.  **Resilient:** If a stream URL is dead, the UI simply catches the error. If the API is down, it serves from the local SQLite cache.