from typing import List, Dict
import asyncio
import yt_dlp


class SoundCloudCuratedParser:
    source_name = "soundcloud_curated"

    # ── CONFIGURATION ─────────────────────────────────────────────────────────
    # DJ sets (1–2 hour single tracks) work best — they mimic a radio broadcast.
    # SoundCloud doesn't carry geo data, so coordinates are set manually here.
    STATIONS = [
        {
            "url": "https://soundcloud.com/sam-selis/kokoro-4am-5am?si=9cf5a9d688d7457d9f647e36a143ccb1&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
            "lat": 51.5074, "lng": -0.1278,  # London
            "override_name": "Rinse FM: Saoirse",
            "tags": "House, Techno, UK",
        },
        {
            "url": "https://on.soundcloud.com/M6BeT0cgEwXMY9ECQ4",
            "lat": 54.5973, "lng": -5.9301,  # Belfast
            "override_name": "Bicep (Boiler Room)",
            "tags": "Breakbeat, Live Set",
        },
        {
            "url": "https://soundcloud.com/sam-selis/kbbq-2am-3am?si=33c412d810a24343ab5f806444d8fb79&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
            "lat": 34.0522, "lng": -118.2437,  # Los Angeles
            "override_name": "Soulection Radio 685",
            "tags": "Future Beats, Soul",
        },
    ]
    # ──────────────────────────────────────────────────────────────────────────

    _YDL_OPTS = {
        "quiet": True,
        "skip_download": True,
        # extract_flat: fetch page metadata only — don't resolve the ephemeral
        # CDN stream URL yet, since those expire quickly. The proxy resolves
        # them fresh at playback time.
        "extract_flat": True,
    }

    def _fetch_metadata(self, item: Dict) -> Dict:
        """Blocking yt-dlp metadata fetch — called via asyncio.to_thread."""
        with yt_dlp.YoutubeDL(self._YDL_OPTS) as ydl:
            info = ydl.extract_info(item["url"], download=False)
        return {
            "uuid": f"sc-{info.get('id', item['url'])}",
            "name": item.get("override_name") or info.get("title"),
            "url": item["url"],  # store the original SC page URL
            "country": "SoundCloud",
            "tags": item.get("tags") or "SoundCloud",
            "lat": item["lat"],
            "lng": item["lng"],
            "source": self.source_name,
        }

    async def fetch_and_parse(self) -> List[Dict]:
        print(f"[{self.source_name}] Processing {len(self.STATIONS)} curated tracks...")
        results = []
        for item in self.STATIONS:
            try:
                station = await asyncio.to_thread(self._fetch_metadata, item)
                results.append(station)
                print(f"   -> Found: {station['name']}")
            except Exception as exc:
                print(f"   -> Failed {item['url']}: {exc}")
        print(f"[{self.source_name}] Parsed {len(results)} stations.")
        return results
