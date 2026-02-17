from typing import List, Dict
import httpx
import json

class RadioBrowserParser:
    source_name = "radio_browser_api"

    # URL to fetch (using a reliable mirror)
    # For local testing, you can swap this with a local file read
    DATA_URL = "https://de1.api.radio-browser.info/json/stations/topclick/500"

    async def fetch_and_parse(self) -> List[Dict]:
        print(f"[{self.source_name}] Fetching data...")
        
        # In a real scenario, we might page through results or read a local dump
        async with httpx.AsyncClient() as client:
            resp = await client.get(self.DATA_URL)
            data = resp.json()

        parsed_stations = []
        
        for item in data:
            # Smart Sub-Parsing: Only take items with valid Geo data
            if item.get('geo_lat') and item.get('geo_long'):
                parsed_stations.append({
                    "uuid": item.get('stationuuid'),
                    "name": item.get('name', '').strip(),
                    "url": item.get('url_resolved'),
                    "country": item.get('country'),
                    "tags": item.get('tags'),
                    "lat": float(item['geo_lat']),
                    "lng": float(item['geo_long']),
                    "source": self.source_name
                })
        
        print(f"[{self.source_name}] Parsed {len(parsed_stations)} valid geo-stations.")
        return parsed_stations