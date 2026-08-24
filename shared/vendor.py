#!/usr/bin/env python3
"""Vendor the shared build inputs into every task's build context.

Each task directory has to be a self-contained Harbor task, so shared material
is copied in rather than referenced.

`shared/mockaws` is the *starting point* for a new task, not a running source of
truth. A task's mock AWS has to model whatever its scenario needs, and those
needs conflict across tasks -- one task wants published metrics readable back
through GetMetricStatistics, another only wants them recorded for its verifier.
So once a task has extended its vendored copy, that task owns it, and this
script leaves it alone. `shared/hardening` is genuinely common and is always
refreshed.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "shared" / "mockaws"
HARDENING = ROOT / "shared" / "hardening"
TASKS = ROOT / "tasks"


def main() -> int:
    if not SOURCE.is_dir():
        print(f"missing source package: {SOURCE}", file=sys.stderr)
        return 1
    if not HARDENING.is_dir():
        print(f"missing hardening directory: {HARDENING}", file=sys.stderr)
        return 1

    task_dirs = sorted(path for path in TASKS.iterdir() if (path / "task.toml").exists())
    if not task_dirs:
        print("no task directories found", file=sys.stderr)
        return 1

    wanted = set(sys.argv[1:]) - {"--force"}
    force = "--force" in sys.argv
    if wanted:
        task_dirs = [task for task in task_dirs if task.name in wanted]
        if not task_dirs:
            print(f"no task matched {sorted(wanted)}", file=sys.stderr)
            return 1

    skipped = False
    for task in task_dirs:
        destination = task / "environment" / "mockaws"
        # A task that has extended its vendored copy owns it. Copying over that
        # destroys work, and because this script walks every task by default,
        # one task's re-vendor used to wipe another's.
        diverged = destination.exists() and _diverged(SOURCE, destination)
        if diverged and not force:
            print(f"task-owned, left alone -> {destination.relative_to(ROOT)}")
            skipped = True
        else:
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(
                SOURCE,
                destination,
                ignore=shutil.ignore_patterns("__pycache__", "tests", "*.pyc"),
            )
            print(f"vendored -> {destination.relative_to(ROOT)}")

        hardening = task / "environment" / "hardening"
        if hardening.exists():
            shutil.rmtree(hardening)
        shutil.copytree(HARDENING, hardening, ignore=shutil.ignore_patterns("__pycache__"))
        print(f"vendored -> {hardening.relative_to(ROOT)}")

    if skipped:
        print("\nTask-owned mocks were left as they are. This is the expected state")
        print("for any task that has extended its mock; --force discards those edits.")
    return 0


def _diverged(source: Path, destination: Path) -> bool:
    """True if the vendored copy differs from the shared package in content."""
    for path in source.rglob("*.py"):
        if "__pycache__" in path.parts or "tests" in path.parts:
            continue
        mirror = destination / path.relative_to(source)
        if not mirror.exists() or mirror.read_bytes() != path.read_bytes():
            return True
    for path in destination.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        if not (source / path.relative_to(destination)).exists():
            return True
    return False


if __name__ == "__main__":
    raise SystemExit(main())
