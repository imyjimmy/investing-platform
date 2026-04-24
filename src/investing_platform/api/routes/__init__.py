"""FastAPI routers grouped by product domain."""

from __future__ import annotations

from fastapi import APIRouter

from .account import router as account_router
from .analytics import router as analytics_router
from .execution import router as execution_router
from .market import router as market_router
from .research import router as research_router
from .sources import router as sources_router
from .system import router as system_router


router = APIRouter(prefix="/api")
router.include_router(system_router)
router.include_router(account_router)
router.include_router(market_router)
router.include_router(analytics_router)
router.include_router(execution_router)
router.include_router(sources_router)
router.include_router(research_router)
