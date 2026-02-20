import uvicorn
import asyncio
import importlib
import pkgutil
from urllib.parse import urlparse
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
import os
import subprocess
import yt_dlp
import httpx

from app.database import upsert_stations, query_stations
import app.parsers as parsers_package


_EXT_TO_MEDIA_TYPE = {
    "aac":  "audio/aac",
    "m4a":  "audio/mp4",
    "mp3":  "audio/mpeg",
    "ogg":  "audio/ogg",
    "opus": "audio/ogg; codecs=opus",
    "mp4":  "audio/mp4",
}

def _resolve_soundcloud_url(url: str) -> tuple[str, str]:
    """Resolve a SoundCloud page URL to its ephemeral CDN audio URL via yt-dlp.

    Returns (cdn_url, media_type).
    Runs synchronously — always call via asyncio.to_thread from async context.

    Format preference: direct HTTP progressive streams first (browser-compatible),
    HLS/m3u8 last — browsers cannot play an HLS manifest via a plain <audio> element.
    SoundCloud always exposes http_mp3_128 alongside the higher-quality HLS stream.
    """
    ydl_opts = {
        # Prefer progressive HTTP streams; HLS requires a dedicated player
        "format": "http_mp3_128/bestaudio[protocol=https]/bestaudio[protocol=http]/bestaudio",
        "quiet": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    ext      = info.get("ext", "mp3")
    protocol = info.get("protocol", "?")
    media_type = _EXT_TO_MEDIA_TYPE.get(ext, "audio/mpeg")
    print(f"   -> Format: {ext} via {protocol} ({media_type})")
    return info["url"], media_type

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Initializing Geo-Radio Services...")
    asyncio.create_task(asyncio.to_thread(run_ingestion))
    yield

app = FastAPI(lifespan=lifespan)

# --- THE ROBUST RADIO PROXY ---
@app.get("/api/proxy")
async def proxy_stream(url: str = Query(...)):
    """A protocol-agnostic proxy that handles ICY, HTTP/1.0, HTTPS, and SoundCloud."""
    media_type = "audio/mpeg"

    # ── YOUTUBE: pipe yt-dlp download directly (live streams are HLS-only) ──────
    # YouTube live streams have no progressive HTTP format — HLS is the only option.
    # Rather than proxying the manifest (which the browser can't parse), we let
    # yt-dlp fetch and concatenate HLS segments internally and pipe raw audio out.
    #
    # asyncio.create_subprocess_exec is not supported on Windows SelectorEventLoop,
    # so we run subprocess.Popen in a thread pool and bridge chunks via asyncio.Queue.
    if "youtube.com" in url or "youtu.be" in url:
        print(f"Streaming YouTube via yt-dlp pipe: {url[:80]}")

        async def youtube_stream():
            q: asyncio.Queue = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def _pipe():
                proc = subprocess.Popen(
                    [
                        "yt-dlp",
                        # Format 91 = lowest-bandwidth HLS (144p, AAC audio track).
                        # No audio-only formats exist for YouTube live streams —
                        # all are HLS TS (video+audio). We pick 91 to minimise
                        # bandwidth; Chrome's FFmpeg demuxer extracts the audio.
                        "--format", "91/92/93/bestaudio",
                        "--output", "-",
                        "--quiet",
                        "--no-playlist",
                        "--js-runtimes", "node",
                        url,
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                try:
                    while chunk := proc.stdout.read(4096):
                        loop.call_soon_threadsafe(q.put_nowait, chunk)
                finally:
                    stderr_out = proc.stderr.read().decode(errors="replace").strip()
                    if stderr_out:
                        print(f"   -> yt-dlp stderr:\n{stderr_out[:1000]}")
                    if proc.poll() is None:
                        proc.kill()
                    proc.wait()
                    print(f"   -> yt-dlp pipe closed (rc={proc.returncode})")
                    loop.call_soon_threadsafe(q.put_nowait, None)

            pipe_task = loop.run_in_executor(None, _pipe)
            try:
                while (chunk := await q.get()) is not None:
                    yield chunk
            finally:
                await pipe_task

        return StreamingResponse(
            youtube_stream(),
            # TS container (MPEG-2 Transport Stream) — Chrome's FFmpeg demuxer
            # can extract the AAC audio track from it via the <audio> element.
            media_type="video/mp2t",
            headers={"Access-Control-Allow-Origin": "*"},
        )
    # ─────────────────────────────────────────────────────────────────────────

    # ── SOUNDCLOUD: resolve + stream via httpx (CDN uses HTTP/1.1 + redirects) ─
    if "soundcloud.com" in url:
        print(f"Resolving SoundCloud stream: {url}")
        try:
            cdn_url, media_type = await asyncio.to_thread(_resolve_soundcloud_url, url)
            print(f"   -> Resolved to: {cdn_url[:80]}...")
        except Exception as exc:
            print(f"SoundCloud resolution failed: {exc}")
            return Response(status_code=502)

        async def soundcloud_stream():
            async with httpx.AsyncClient(follow_redirects=True) as client:
                async with client.stream("GET", cdn_url) as r:
                    print(f"   -> CDN response: HTTP {r.status_code} | content-type: {r.headers.get('content-type', 'n/a')}")
                    async for chunk in r.aiter_bytes(4096):
                        yield chunk

        return StreamingResponse(
            soundcloud_stream(),
            media_type=media_type,
            headers={"Access-Control-Allow-Origin": "*"},
        )
    # ─────────────────────────────────────────────────────────────────────────

    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path + ("?" + parsed.query if parsed.query else "")
    if not path: path = "/"

    async def stream_generator():
        reader, writer = None, None
        try:
            # Handle SSL for HTTPS streams, otherwise plain TCP
            ssl_context = True if parsed.scheme == "https" else None
            reader, writer = await asyncio.open_connection(host, port, ssl=ssl_context)

            # Send a minimalist HTTP request
            # We explicitly DON'T ask for ICY metadata to keep the stream clean
            request = (
                f"GET {path} HTTP/1.0\r\n"
                f"Host: {host}\r\n"
                f"User-Agent: MidnightRadio/1.0\r\n"
                f"Accept: */*\r\n"
                f"Connection: close\r\n\r\n"
            )
            writer.write(request.encode())
            await writer.drain()

            # Read and log upstream headers, then discard them
            header_buffer = b""
            while True:
                line = await reader.readuntil(b"\n")
                header_buffer += line
                if header_buffer.endswith(b"\r\n\r\n") or header_buffer.endswith(b"\n\n"):
                    break
            raw_headers = header_buffer.decode(errors="replace")
            status_line = raw_headers.splitlines()[0] if raw_headers else "(empty)"
            ct = next((l.split(":", 1)[1].strip() for l in raw_headers.splitlines() if l.lower().startswith("content-type")), "n/a")
            print(f"📡 TCP proxy upstream: {status_line} | content-type: {ct} | proxied as: {media_type}")

            # Now just pipe the raw audio data
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
        media_type=media_type,
        headers={"Access-Control-Allow-Origin": "*"}
    )

# --- DATABASE & INGESTION ---
def run_ingestion():
    for _, name, is_pkg in pkgutil.iter_modules(parsers_package.__path__):
        if is_pkg: continue
        full_module_name = f"app.parsers.{name}"
        try:
            module = importlib.import_module(full_module_name)
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, type) and hasattr(attr, 'fetch_and_parse') and hasattr(attr, 'source_name'):
                    parser_instance = attr()
                    loop = asyncio.new_event_loop()
                    try:
                        stations = loop.run_until_complete(parser_instance.fetch_and_parse())
                        if stations: upsert_stations(stations)
                    finally:
                        loop.close()
        except Exception as e:
            print(f"❌ Ingestion Error: {e}")

@app.get("/api/stations")
def get_stations():
    return query_stations(limit=2000)

# Silence the favicon 404 logs
@app.get("/favicon.ico")
def favicon(): return Response(status_code=204)


# python only development
# app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
# (for production)
# app.mount("/", StaticFiles(directory="dist", html=True), name="static")
base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_path = os.path.join(base_path, "dist")

if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)