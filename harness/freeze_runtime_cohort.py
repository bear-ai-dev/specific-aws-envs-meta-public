#!/usr/bin/env python3
"""Freeze replay-affecting inputs for a specific runtime cohort config."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(candidate for candidate in path.rglob("*") if candidate.is_file()):
        if ".git" in item.parts or "__pycache__" in item.parts or item.name == ".DS_Store":
            continue
        digest.update(item.relative_to(path).as_posix().encode())
        digest.update(b"\0")
        digest.update(item.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    config_path = (ROOT / args.config).resolve()
    output_path = (ROOT / args.output).resolve()
    config = json.loads(config_path.read_text())

    task_hashes = {}
    for entry in config["tasks"]:
        task_path = ROOT / entry["path"]
        task_hashes[task_path.name] = directory_sha256(task_path)

    referenced_files = {ROOT / "harness" / "harbor_agents.py"}
    for agent in config["agents"]:
        kwargs = agent.get("kwargs") or {}
        for key in ("config_file", "model_registry_file"):
            if kwargs.get(key):
                referenced_files.add(ROOT / kwargs[key])

    payload = {
        "cohort": config["job_name"],
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "attempts_per_task_model": config["n_attempts"],
        "concurrent_trials": config["n_concurrent_trials"],
        "environment": config["environment"]["type"],
        "harbor_version": "0.18.0",
        "mini_swe_agent_version": "2.4.5",
        "models": [
            agent.get("model_name") or agent.get("name")
            for agent in config["agents"]
        ],
        "reasoning_effort": (
            "high"
            if any(agent.get("model_name") for agent in config["agents"])
            else None
        ),
        "task_sha256": task_hashes,
        "cohort_config": config_path.relative_to(ROOT).as_posix(),
        "cohort_config_sha256": sha256(config_path),
        "runtime_file_sha256": {
            path.relative_to(ROOT).as_posix(): sha256(path)
            for path in sorted(referenced_files)
        },
        "validity_rule": (
            "numeric verifier reward, complete trajectory, complete verifier "
            "artifact, no Harbor exception, and exact frozen task/config variant"
        ),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(output_path.relative_to(ROOT))


if __name__ == "__main__":
    main()
