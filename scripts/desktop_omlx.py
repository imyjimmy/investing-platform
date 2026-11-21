"""Start the configured local inference service as a child of the desktop app."""
import os
import socket
import sys
from pathlib import Path
from urllib.parse import urlsplit

from investing_platform.config import DashboardSettings


def main() -> None:
    settings = DashboardSettings.load()
    if os.getenv("INVESTING_PLATFORM_AUTOSTART_OMLX", "1").lower() not in {"1", "true", "yes", "on"}:
        return
    endpoint = urlsplit(settings.llm_base_url)
    if settings.llm_provider != "omlx" or endpoint.scheme != "http" or endpoint.hostname not in {"localhost", "127.0.0.1", "::1"}:
        return
    host = "127.0.0.1" if endpoint.hostname == "localhost" else endpoint.hostname
    port = endpoint.port or 80
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return
    except OSError:
        pass
    executable = Path(sys.executable).with_name("omlx")
    models = Path(os.getenv("OMLX_MODEL_DIR", "~/models/mlx-community")).expanduser()
    # exec preserves the child PID so Tauri owns only the service it started.
    os.execv(executable, [str(executable), "serve", "--host", host, "--port", str(port), "--model-dir", str(models)])


if __name__ == "__main__":
    main()
