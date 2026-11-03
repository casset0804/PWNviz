"""PWNviz FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import routes_capabilities, routes_health, routes_samples
from app.core.config import get_settings
from app.core.errors import PwnvizError
from app.core.logging import configure_logging

logger = logging.getLogger("pwnviz")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info("PWNviz backend %s starting", __version__)
    logger.info("settings: %s", settings.describe())
    yield
    logger.info("PWNviz backend shutting down")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="PWNviz API",
        summary="Real GDB/MI3 driven memory visualization for PWN teaching",
        version=__version__,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(routes_health.router)
    app.include_router(routes_capabilities.router, prefix="/api/v1")
    app.include_router(routes_samples.router, prefix="/api/v1")

    @app.exception_handler(PwnvizError)
    async def _pwnviz_error(_: Request, exc: PwnvizError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content={"error": exc.to_payload()}
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "Request validation failed.",
                    "detail": exc.errors(),
                }
            },
        )

    @app.get("/", include_in_schema=False)
    async def index() -> dict[str, str]:
        return {
            "service": "PWNviz backend",
            "version": __version__,
            "health": "/health",
            "capabilities": "/api/v1/capabilities",
            "samples": "/api/v1/samples",
            "docs": "/docs",
        }

    return app


app = create_app()
