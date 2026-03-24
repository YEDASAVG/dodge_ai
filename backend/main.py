"""FastAPI application — O2C Graph Explorer."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure backend/ is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import GEMINI_API_KEY
from graph_service import build_graph, get_summary
from routers.graph import router as graph_router
from routers.chat import router as chat_router

# Module-level graph reference — populated on startup
G = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global G
    if not GEMINI_API_KEY:
        print("⚠️  WARNING: GEMINI_API_KEY not set — chat endpoint will fail.")

    # Auto-ingest if database doesn't exist yet
    from config import DB_PATH
    if not DB_PATH.exists():
        print("Database not found — running ingestion...")
        from ingestion import ingest
        ingest()

    print("Building graph...")
    G = build_graph()
    summary = get_summary(G)
    print(f"Graph ready — {summary['total_nodes']} nodes, {summary['total_edges']} edges")
    yield
    G = None


app = FastAPI(title="O2C Graph Explorer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)
app.include_router(chat_router)

# Serve frontend static build if it exists (production)
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    from fastapi.responses import FileResponse

    # Serve static assets
    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the React SPA for any non-API route."""
        file = _frontend_dist / full_path
        if file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(_frontend_dist / "index.html"))
