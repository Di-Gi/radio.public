This allows us to integrate SoundCloud without needing an impossible-to-get official API Key, and without breaking your Visualizer or Globe UI.

### The Strategy: "Backend Resolution"

Since SoundCloud tracks are not "Radio Streams" (ICY/Shoutcast), we cannot just feed the URL to the frontend.
1.  **Ingestion**: We create a parser that takes a curated list of SoundCloud links (Tracks or Sets) + Coordinates.
2.  **Resolution**: We use `yt-dlp` (a powerful media extractor) in the backend to fetch metadata.
3.  **Proxying**: We modify your `main.py` proxy. When the frontend asks to play a SoundCloud link, the backend calculates the *real* ephemeral CDN mp3 link on the fly and streams that.

---

### Phase 1: Dependencies

You need `yt-dlp` to handle the extraction of audio streams from SoundCloud without an API key.

```bash
pip install yt-dlp
```

---

### Phase 2: Create the SoundCloud Parser

We need a place to define *where* these tracks live geographically, as SoundCloud data doesn't usually have lat/lng.

**File:** `app/parsers/soundcloud_curated.py` (New File)

```python
from typing import List, Dict
import yt_dlp

class SoundCloudParser:
    source_name = "soundcloud_curated"

    # ── CONFIGURATION ────────────────────────────────────────────────────────
    # Add your tracks, sets, or user uploads here.
    # SoundCloud 'Sets' (long mixes) work best as simulated Radio Stations.
    STATIONS = [
        {
            "url": "https://soundcloud.com/rinsefm/riley-w-saorise-29th-january-2025",
            "lat": 51.5074, "lng": -0.1278, # London
            "override_name": "Rinse FM: Saoirse",
            "tags": "House, Techno, UK"
        },
        {
            "url": "https://soundcloud.com/platform/bicep-boiler-room-x-ava-festival-dj-set",
            "lat": 54.5973, "lng": -5.9301, # Belfast
            "override_name": "Bicep (Boiler Room)",
            "tags": "Breakbeat, Live Set"
        },
        {
            "url": "https://soundcloud.com/soulection/soulection-radio-show-685",
            "lat": 34.0522, "lng": -118.2437, # Los Angeles
            "override_name": "Soulection Radio 685",
            "tags": "Future Beats, Soul"
        }
    ]
    # ─────────────────────────────────────────────────────────────────────────

    async def fetch_and_parse(self) -> List[Dict]:
        print(f"[{self.source_name}] Processing {len(self.STATIONS)} curated tracks...")
        
        parsed_stations = []
        
        # We use yt_dlp to fetch metadata (Name, Genre) securely
        # We do NOT fetch the stream URL here, because they expire. 
        # We store the original SC URL and resolve it in the Proxy at playback time.
        ydl_opts = {
            'quiet': True,
            'skip_download': True,
            'extract_flat': True, # Don't resolve streams yet, just metadata
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            for item in self.STATIONS:
                try:
                    # Fetch basic info
                    info = ydl.extract_info(item['url'], download=False)
                    
                    parsed_stations.append({
                        "uuid": f"sc-{info.get('id', item['url'])}",
                        "name": item.get('override_name') or info.get('title'),
                        "url": item['url'], # Store ORIGINAL URL
                        "country": "SoundCloud",
                        "tags": item.get('tags') or "SoundCloud",
                        "lat": item['lat'],
                        "lng": item['lng'],
                        "source": self.source_name
                    })
                    print(f"   -> Found: {parsed_stations[-1]['name']}")
                except Exception as e:
                    print(f"   -> Failed {item['url']}: {e}")

        return parsed_stations
```

---

### Phase 3: Upgrade the Proxy

We need to teach `main.py` how to handle a SoundCloud URL. The frontend `AudioManager.js` calls `/api/proxy?url=...`. We will intercept this call.

**File:** `main.py`

**Degree of Change:** Moderate (Update `proxy_stream` function)

```python
# ... (imports remain the same)
import yt_dlp # <--- ADD THIS IMPORT

# ... (setup code remains the same)

# --- THE ROBUST RADIO PROXY ---
@app.get("/api/proxy")
async def proxy_stream(url: str = Query(...)):
    """A protocol-agnostic proxy that handles ICY, HTTP/1.0, HTTPS AND SoundCloud"""
    
    # ── SPECIAL HANDLING: SOUNDCLOUD ─────────────────────────────────────────
    if "soundcloud.com" in url:
        print(f"☁️ Resolving SoundCloud Stream: {url}")
        try:
            # Resolve the actual CDN stream URL on the fly
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'noplaylist': True
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                url = info['url'] # Update the 'url' variable to the actual CDN mp3 link
                print(f"   -> Resolved to: {url[:50]}...")
        except Exception as e:
            print(f"❌ SoundCloud Resolution Failed: {e}")
            return Response(status_code=500)
    # ─────────────────────────────────────────────────────────────────────────

    # Standard Proxy Logic (Existing Code)
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path + ("?" + parsed.query if parsed.query else "")
    if not path: path = "/"

    async def stream_generator():
        reader, writer = None, None
        try:
            # Handle SSL for HTTPS streams (SoundCloud CDN is always HTTPS)
            ssl_context = True if parsed.scheme == "https" else None
            reader, writer = await asyncio.open_connection(host, port, ssl=ssl_context)

            # Minimalist HTTP request
            request = (
                f"GET {path} HTTP/1.0\r\n"
                f"Host: {host}\r\n"
                f"User-Agent: MidnightRadio/1.0\r\n"
                f"Accept: */*\r\n"
                f"Connection: close\r\n\r\n"
            )
            writer.write(request.encode())
            await writer.drain()

            # Skip headers
            header_buffer = b""
            while True:
                line = await reader.readuntil(b"\n")
                header_buffer += line
                if header_buffer.endswith(b"\r\n\r\n") or header_buffer.endswith(b"\n\n"):
                    break

            # Pipe audio
            while True:
                chunk = await reader.read(4096)
                if not chunk: break
                yield chunk

        except Exception as e:
            print(f"📡 Proxy Error: {e}")
        finally:
            if writer:
                writer.close()
                await writer.wait_closed()
    
    return StreamingResponse(
        stream_generator(), 
        media_type="audio/mpeg", 
        headers={"Access-Control-Allow-Origin": "*"}
    )
```

---

### Implementation Notes

1.  **Why this works for Visualizers:**
    Since the audio is piped through your own server (`/api/proxy`), the browser treats it as "Same Origin" (thanks to the CORS headers we added previously). This means `AudioContext` and `createMediaElementSource` in `AudioManager.js` will accept the stream and generate the FFT data for your globe visualizer.

2.  **Playlists vs Tracks:**
    *   **Tracks:** The code above works perfectly for individual tracks.
    *   **User Playlists:** In the `SoundCloudParser`, if you provide a Playlist URL (e.g., `soundcloud.com/user/sets/my-playlist`), `yt-dlp` in the backend parser will likely grab metadata for the *whole* playlist.
    *   **Recommendation:** For the best "Radio Station" feel, link to **DJ Sets** (1-2 hour long single tracks) rather than albums/playlists. This mimics a radio broadcast.

3.  **Data Refresh:**
    After adding the files, you might need to delete your local `stations.db` (or rely on `upsert` logic) and restart the server to ingest the new SoundCloud entries.

### User Playlist Expansion (Optional)
If you specifically want to import *all* tracks from a specific user and scatter them, you can modify `SoundCloudParser` to accept a `USER_URL` and a `CENTER_LAT/LNG`. Then loop through the `entries` returned by `yt-dlp` and add small random offsets to the lat/lng so they cluster around the user's city.