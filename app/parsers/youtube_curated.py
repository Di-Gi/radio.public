from typing import List, Dict
import asyncio
import random
import yt_dlp


class YoutubeParser:
    source_name = "youtube_curated"

    # ── CONFIGURATION ─────────────────────────────────────────────────────────
    # Works for single videos, live streams, and playlists.
    # Coordinates must be set manually — YouTube carries no geo data.
    SOURCES = [
        {
            "url": "https://www.youtube.com/live/jfKfPfyJRdk?si=YTBGFHS4viRmmU34",
            "lat": 48.8566, "lng": 2.3522,  # Paris
            "override_name": "Lofi Girl Radio",
            "tags": "LoFi, Study, Chill",
        },
        {
            "url": "https://youtu.be/c0-hvjV2A5Y?si=GrN9RS7MjhN8zZeP",
            "lat": 51.5074, "lng": -0.1278,  # London
            "override_name": "Fred Again - London set",
            "tags": "House, Funk",
        },
    ]
    # ──────────────────────────────────────────────────────────────────────────

    _YDL_OPTS = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "ignoreerrors": True,
    }

    def _fetch_source(self, source: Dict) -> List[Dict]:
        """Blocking yt-dlp metadata fetch — called via asyncio.to_thread."""
        with yt_dlp.YoutubeDL(self._YDL_OPTS) as ydl:
            info = ydl.extract_info(source["url"], download=False)

        if info is None:
            return []

        if "entries" in info:
            # Playlist — scatter up to 10 entries around the source coordinates
            return [
                self._format_entry(entry, source, scatter=True)
                for entry in info["entries"][:10]
                if entry
            ]
        else:
            return [self._format_entry(info, source)]

    def _format_entry(self, info: Dict, source: Dict, scatter: bool = False) -> Dict:
        lat = source["lat"] + (random.uniform(-0.05, 0.05) if scatter else 0)
        lng = source["lng"] + (random.uniform(-0.05, 0.05) if scatter else 0)

        video_id = info.get("id", "")
        # Construct a canonical watch URL from the video ID.
        # extract_flat does not reliably populate info['url'] for single videos.
        url = f"https://www.youtube.com/watch?v={video_id}" if video_id else source["url"]

        return {
            "uuid": f"yt-{video_id}",
            "name": source.get("override_name") or info.get("title", "Unknown"),
            "url": url,
            "country": "YouTube",
            "tags": source.get("tags", "YouTube"),
            "lat": lat,
            "lng": lng,
            "source": self.source_name,
        }

    async def fetch_and_parse(self) -> List[Dict]:
        print(f"[{self.source_name}] Processing {len(self.SOURCES)} YouTube sources...")
        results = []
        for source in self.SOURCES:
            try:
                entries = await asyncio.to_thread(self._fetch_source, source)
                results.extend(entries)
                for e in entries:
                    print(f"   -> Found: {e['name']} ({e['url']})")
            except Exception as exc:
                print(f"   -> Failed {source['url']}: {exc}")
        print(f"[{self.source_name}] Parsed {len(results)} stations.")
        return results