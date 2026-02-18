import uvicorn
import asyncio
import importlib
import pkgutil
from urllib.parse import urlparse
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles

from app.database import upsert_stations, query_stations
import app.parsers as parsers_package

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Initializing Geo-Radio Services...")
    asyncio.create_task(asyncio.to_thread(run_ingestion))
    yield

app = FastAPI(lifespan=lifespan)

# --- THE ROBUST RADIO PROXY ---
@app.get("/api/proxy")
async def proxy_stream(url: str = Query(...)):
    """A protocol-agnostic proxy that handles ICY, HTTP/1.0 and HTTPS"""
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

            # Skip the headers manually
            # We look for the double newline (\r\n\r\n) that separates headers from audio
            header_buffer = b""
            while True:
                line = await reader.readuntil(b"\n")
                header_buffer += line
                if header_buffer.endswith(b"\r\n\r\n") or header_buffer.endswith(b"\n\n"):
                    break

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
    
    # Updated: Add CORS header to allow clean AudioContext analysis
    return StreamingResponse(
        stream_generator(), 
        media_type="audio/mpeg", 
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
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)