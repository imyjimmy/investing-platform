"""Optional browser-rendered HTML fetches for investor PDF discovery."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

from investing_platform.config import DashboardSettings, InvestorBrowserProvider


DEFAULT_SCRAPLING_BINARY = Path(sys.executable).with_name("scrapling")

DEFAULT_BROWSER_COMMANDS: dict[InvestorBrowserProvider, str] = {
    "lightpanda": "lightpanda fetch --obey-robots --dump html --wait-ms 12000 --log-level fatal {url}",
    "obscura": "obscura fetch --dump html --wait 12 --wait-until load --quiet {url}",
    "disabled": "",
    "scrapling": (
        f"{shlex.quote(str(DEFAULT_SCRAPLING_BINARY if DEFAULT_SCRAPLING_BINARY.exists() else Path('scrapling')))} "
        "extract fetch {url} {output} --headless --timeout {timeout_ms} --wait 8000"
    ),
    "custom": "",
}

DISALLOWED_BROWSER_COMMAND_TOKENS = (
    "--stealth",
    "stealth",
    "--proxy",
    "proxy=",
    "captcha",
    "turnstile",
    "fingerprint",
    "cloakbrowser",
    "humanize",
)
MAX_RENDERED_HTML_CHARS = 12_000_000


@dataclass(frozen=True, slots=True)
class RenderedPage:
    url: str
    html: str
    provider: InvestorBrowserProvider


class BrowserPageFetcher:
    """Run an installed renderer and return public page HTML.

    The adapter intentionally stays at the rendered-HTML boundary. It does not
    configure proxies, stealth mode, CAPTCHA handling, or fingerprint overrides.
    """

    def __init__(self, settings: DashboardSettings) -> None:
        self._provider = settings.investor_browser_provider
        self._command_template = (settings.investor_browser_command or "").strip()
        self._timeout_seconds = max(1.0, settings.investor_browser_timeout_seconds)

    @property
    def provider(self) -> InvestorBrowserProvider:
        return self._provider

    @property
    def enabled(self) -> bool:
        return self._provider != "disabled" and bool(self._command_template or DEFAULT_BROWSER_COMMANDS[self._provider])

    @property
    def timeout_seconds(self) -> float:
        return self._timeout_seconds

    def render(self, url: str) -> RenderedPage | None:
        if not self.enabled:
            return None

        command_template = self._command_template or DEFAULT_BROWSER_COMMANDS[self._provider]
        output_path = self._temporary_output_path(command_template)
        try:
            args = self._command_args(command_template, url, output_path)
            if not args or self._uses_disallowed_capability(args):
                return None

            result = subprocess.run(
                args,
                capture_output=True,
                check=False,
                text=True,
                timeout=self._timeout_seconds,
            )

            if result.returncode != 0:
                return None

            output = self._command_output(result.stdout, output_path)
            html = self._extract_html(output)
            if html is None:
                return None
            return RenderedPage(url=url, html=html, provider=self._provider)
        except (OSError, subprocess.TimeoutExpired):
            return None
        finally:
            if output_path is not None:
                output_path.unlink(missing_ok=True)

    def _command_args(self, command_template: str, url: str, output_path: Path | None) -> list[str]:
        try:
            raw_args = shlex.split(command_template)
        except ValueError:
            return []
        if not raw_args:
            return []
        format_values = {
            "url": url,
            "output": str(output_path or ""),
            "timeout_ms": str(int(self._timeout_seconds * 1000)),
        }
        try:
            args = [part.format(**format_values) for part in raw_args]
        except (IndexError, KeyError, ValueError):
            return []
        if "{url}" not in command_template:
            args.append(url)
        return args

    def _temporary_output_path(self, command_template: str) -> Path | None:
        if "{output}" not in command_template:
            return None
        handle = tempfile.NamedTemporaryFile(prefix="investing-browser-", suffix=".html", delete=False)
        try:
            return Path(handle.name)
        finally:
            handle.close()

    def _command_output(self, stdout: str, output_path: Path | None) -> str:
        if output_path is not None and output_path.exists():
            return output_path.read_text(encoding="utf-8", errors="ignore")
        return stdout

    def _uses_disallowed_capability(self, args: list[str]) -> bool:
        joined = " ".join(args).lower()
        return any(token in joined for token in DISALLOWED_BROWSER_COMMAND_TOKENS)

    def _extract_html(self, output: str) -> str | None:
        trimmed = output.strip()
        if not trimmed:
            return None

        lowered = trimmed.lower()
        html_start = min(
            (index for index in (lowered.find("<!doctype"), lowered.find("<html")) if index >= 0),
            default=-1,
        )
        if html_start > 0:
            trimmed = trimmed[html_start:]
        if not trimmed.lstrip().startswith("<"):
            return None
        return trimmed[:MAX_RENDERED_HTML_CHARS]
