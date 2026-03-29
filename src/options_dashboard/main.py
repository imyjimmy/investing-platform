"""FastAPI application entrypoint for the local options dashboard."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from options_dashboard.api.routes import router
from options_dashboard.services.app_state import get_settings


settings = get_settings()
app = FastAPI(
    title="IBKR Options Visualization Dashboard",
    version="0.1.0",
    description="Local-first dashboard for IB Gateway paper trading and options income analytics.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)

frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(frontend_dist / "index.html")

