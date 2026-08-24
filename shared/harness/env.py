"""Load `.env` from the repo root so runs need no shell setup.

Values already present in the real environment win, which keeps one-off
overrides on the command line working.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path | None = None) -> dict[str, str]:
    source = path or (ROOT / ".env")
    loaded: dict[str, str] = {}
    if not source.exists():
        return loaded

    for raw_line in source.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or not value:
            continue
        loaded[key] = value
        os.environ.setdefault(key, value)
    return loaded


def setting(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


def int_setting(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default
