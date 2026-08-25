#!/usr/bin/env python3
"""Freeze replay-affecting inputs and public evidence references."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "harness" / "cohort.json").read_text())
TASK4_CONFIG = json.loads((ROOT / "harness" / "task4-cohort.json").read_text())
CONTROLS_CONFIG = json.loads((ROOT / "harness" / "controls.json").read_text())
RECORDED_RUNTIME_TASK_SHA256 = {
    "01-entitlement-overage-lines": "92e4b98286ca4dd72881f59542ae4c17ad010f9910e29839c725cedbffe00ab3",
    "02-measurement-failure-dlq": "399555755149536b509b00884f9821e6478e28670fdbc49447dfe5798396c8f8",
    "03-customer-communication-dispatch": "714b5d0c7986d9f77975acf5a6543040141ebcb06f5ea01580fa53c84f623801",
    "04-iam-role-validation": "901ad305d007256b8411eae1365d7d18dfc3d23115a938459d83ede510ac486a",
}


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


def harbor_version() -> str:
    try:
        return subprocess.check_output(["harbor", "--version"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return "0.18.0"


def main() -> None:
    tasks = {
        Path(entry["path"]).name: directory_sha256(ROOT / entry["path"])
        for entry in CONTROLS_CONFIG["tasks"]
    }
    runtime_files = (
        "harness/harbor_agents.py",
        "harness/mini-swe-bedrock.yaml",
        "harness/mini-swe-openrouter.yaml",
        "harness/mini-swe-meta-responses.yaml",
        "harness/mini-swe-bedrock-anthropic-v2.yaml",
    )
    controls_manifest = ROOT / "sample-run" / "manifests" / "public-controls-validation.json"
    transformation = ROOT / "sample-run" / "manifests" / "public-transformation.json"
    redaction = ROOT / "sample-run" / "indexes" / "redaction-manifest.json"
    payload = {
        "schema_version": 2,
        "cohorts": [
            {
                "job_name": CONFIG["job_name"],
                "config": "harness/cohort.json",
            },
            {
                "job_name": TASK4_CONFIG["job_name"],
                "config": "harness/task4-cohort.json",
            },
        ],
        "evidence_roots": [
            "sample-run/trajectories",
        ],
        "attempts_per_task_model": CONFIG["n_attempts"],
        "validity_rule": (
            "numeric verifier reward, agent process started, no Harbor exception, "
            "native and normalized trajectories, verifier report, and reward; "
            "submitted deliverable included where available"
        ),
        "harbor_version": harbor_version(),
        "mini_swe_agent_version": "2.4.5",
        "models": {
            "muse-spark-1.2": "openrouter/meta/muse-spark-1.2",
            "opus-5": "bedrock/us.anthropic.claude-opus-5",
            "muse-spark-1.2-direct": "meta/responses/muse-spark-1.2",
        },
        "agent": "mini-swe-agent",
        "reasoning_effort": "high",
        "reproduction_environment": CONFIG["environment"]["type"],
        "recorded_environment": "managed AWS sandbox",
        "recorded_runtime_task_sha256": RECORDED_RUNTIME_TASK_SHA256,
        "public_task_sha256": tasks,
        "cohort_config_sha256": sha256(ROOT / "harness" / "cohort.json"),
        "task4_cohort_config_sha256": sha256(
            ROOT / "harness" / "task4-cohort.json"
        ),
        "controls_config_sha256": sha256(ROOT / "harness" / "controls.json"),
        "runtime_file_sha256": {
            path: sha256(ROOT / path) for path in runtime_files
        },
        "publication_transformation": transformation.relative_to(ROOT).as_posix(),
        "publication_transformation_sha256": sha256(transformation),
        "publication_controls_validation": controls_manifest.relative_to(ROOT).as_posix(),
        "publication_controls_validation_sha256": sha256(controls_manifest),
        "redaction_manifest_sha256": sha256(redaction),
    }
    destination = ROOT / "sample-run" / "manifests" / "frozen-cohort.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(destination.relative_to(ROOT))


if __name__ == "__main__":
    main()
