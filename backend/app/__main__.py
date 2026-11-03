"""Start the PWNviz backend using ``API_HOST`` / ``API_PORT`` from the environment.

Usage (inside WSL, from the ``backend`` directory):

    python -m app

Set ``PWNVIZ_RELOAD=1`` for uvicorn auto-reload during development.
"""

from __future__ import annotations

import os

import uvicorn

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.main import app


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    reload_enabled = os.environ.get("PWNVIZ_RELOAD", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    target: str | object = (
        "app.main:app"
        if reload_enabled
        else app
    )
    uvicorn.run(
        target,
        host=settings.api_host,
        port=settings.api_port,
        reload=reload_enabled,
        reload_dirs=[str(settings.backend_root)] if reload_enabled else None,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
