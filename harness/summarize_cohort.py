#!/usr/bin/env python3
"""Build the machine-readable trial index and pass-rate matrix."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from math import comb
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TASKS = (
    "01-entitlement-overage-lines",
    "02-measurement-failure-dlq",
    "03-customer-communication-dispatch",
    "04-iam-role-validation",
)
TASK_ALIASES = {
    "meteringco-entitlement-overage-lines": TASKS[0],
    "meteringco-measurement-failure-dlq": TASKS[1],
    "meteringco-customer-communication-dis": TASKS[2],
    "meteringco-customer-communication-dispatch": TASKS[2],
    "meteringco-iam-role-validation": TASKS[3],
    "02-entitlement-overage-lines": TASKS[0],
    "04-measurement-failure-dlq": TASKS[1],
    "05-customer-communication-dispatch": TASKS[2],
    "14-iam-role-validation": TASKS[3],
    **{task: task for task in TASKS},
}
MUSE_OPENROUTER = "openrouter/meta/muse-spark-1.2"
MUSE_DIRECT = "meta/responses/muse-spark-1.2"
OPUS = "bedrock/us.anthropic.claude-opus-5"
MODEL_ALIASES = {
    "openrouter/meta/muse-spark-1.2": (MUSE_OPENROUTER, "Muse Spark 1.2"),
    "openai/muse-spark-1.2": (MUSE_DIRECT, "Muse Spark 1.2"),
    "bedrock/us.anthropic.claude-opus-5": (OPUS, "Opus 5"),
    "bedrock/converse/us.anthropic.claude-opus-5": (OPUS, "Opus 5"),
}
MODEL_ORDER = (
    MUSE_OPENROUTER,
    MUSE_DIRECT,
    OPUS,
)
EXPECTED_SOLVES = {
    (TASKS[0], MUSE_OPENROUTER): 0,
    (TASKS[0], OPUS): 8,
    (TASKS[1], MUSE_OPENROUTER): 2,
    (TASKS[1], OPUS): 8,
    (TASKS[2], MUSE_OPENROUTER): 5,
    (TASKS[2], OPUS): 8,
    (TASKS[3], MUSE_DIRECT): 4,
    (TASKS[3], OPUS): 8,
}
DEFAULT_ROOTS = (
    ROOT / "sample-run" / "trajectories",
)


def display_path(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def first_existing(*paths: Path) -> Path | None:
    return next((path for path in paths if path.is_file()), None)


def task_name(result: dict, trial_dir: Path) -> str | None:
    configured = Path(
        str((((result.get("config") or {}).get("task") or {}).get("path") or ""))
    ).name
    if configured in TASK_ALIASES:
        return TASK_ALIASES[configured]
    prefix = trial_dir.name.rsplit("__", 1)[0]
    return TASK_ALIASES.get(prefix)


def load_trials(evidence_roots: tuple[Path, ...]) -> list[dict]:
    trials = []
    seen = set()
    for evidence_root in evidence_roots:
        for result_path in sorted(evidence_root.rglob("result.json")):
            trial_dir = result_path.parent
            if trial_dir.resolve() in seen:
                continue
            seen.add(trial_dir.resolve())
            try:
                result = json.loads(result_path.read_text())
            except (OSError, json.JSONDecodeError):
                continue

            task = task_name(result, trial_dir)
            agent = (result.get("config") or {}).get("agent") or {}
            raw_model = agent.get("model_name")
            if task not in TASKS or raw_model not in MODEL_ALIASES:
                continue
            model, model_label = MODEL_ALIASES[raw_model]
            reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get(
                "reward"
            )
            native = trial_dir / "mini-swe-agent.trajectory.json"
            normalized = trial_dir / "trajectory.json"
            text_trajectory = trial_dir / "mini-swe-agent.txt"
            verifier = first_existing(
                trial_dir / "verifier" / "reward.json",
                trial_dir / "verifier" / "output.json",
            )
            report = trial_dir / "verifier" / "report.txt"
            deliverable = trial_dir / "verifier" / "deliverable"
            agent_started = bool((result.get("agent_execution") or {}).get("started_at"))
            has_deliverable = deliverable.is_dir()
            is_canonical_trajectory = "trajectories" in trial_dir.parts
            valid = (
                result.get("exception_info") is None
                and agent_started
                and isinstance(reward, (int, float))
                and native.is_file()
                and normalized.is_file()
                and text_trajectory.is_file()
                and verifier is not None
                and report.is_file()
                and (has_deliverable or is_canonical_trajectory)
            )
            trial_id = str(result.get("trial_name") or trial_dir.name)
            trial = {
                "task": task,
                "task_label": f"Task {int(task.split('-', 1)[0])}",
                "model": model,
                "model_label": model_label,
                "trial": trial_id,
                "reward": float(reward) if isinstance(reward, (int, float)) else None,
                "passed": bool(valid and float(reward) >= 1.0),
                "valid": valid,
                "trial_dir": display_path(trial_dir),
                "result": display_path(result_path),
                "trajectory": display_path(native) if native.is_file() else None,
                "normalized_trajectory": (
                    display_path(normalized) if normalized.is_file() else None
                ),
                "text_trajectory": (
                    display_path(text_trajectory) if text_trajectory.is_file() else None
                ),
                "verifier": display_path(verifier) if verifier else None,
                "verifier_report": display_path(report) if report.is_file() else None,
                "deliverable": display_path(deliverable) if has_deliverable else None,
                "evidence_scope": (
                    "complete trial with submitted deliverable"
                    if has_deliverable
                    else "canonical trajectory and verifier evidence"
                ),
                "exception_info": result.get("exception_info"),
                "input_tokens": (result.get("agent_result") or {}).get("n_input_tokens"),
                "cache_tokens": (result.get("agent_result") or {}).get("n_cache_tokens"),
                "output_tokens": (result.get("agent_result") or {}).get("n_output_tokens"),
                "reported_cost_usd": (result.get("agent_result") or {}).get("cost_usd"),
            }
            trials.append(trial)

    model_rank = {model: rank for rank, model in enumerate(MODEL_ORDER)}
    task_rank = {task: rank for rank, task in enumerate(TASKS)}
    return sorted(
        trials,
        key=lambda item: (
            task_rank[item["task"]],
            model_rank[item["model"]],
            item["trial"],
        ),
    )


def pass_at_k(n: int, c: int, k: int) -> float:
    if c == 0:
        return 0.0
    if n - c < k:
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def render_matrix(trials: list[dict]) -> str:
    cells = defaultdict(list)
    for trial in trials:
        if trial["valid"]:
            cells[(trial["task"], trial["model"])].append(trial)
    lines = [
        "| Task | Model | Solves `c/n` | pass@1 | pass@3 | pass@8 |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    labels = {canonical: label for canonical, label in MODEL_ALIASES.values()}
    for task, model in EXPECTED_SOLVES:
        cell = cells[(task, model)]
        n = len(cell)
        c = sum(item["passed"] for item in cell)
        task_number = int(task.split("-", 1)[0])
        values = [pass_at_k(n, c, k) for k in (1, 3, 8)]
        lines.append(
            f"| [Task {task_number}](../../tasks/{task}/instruction.md) | "
            f"{labels[model]} | {c}/{n} | "
            + " | ".join(f"{value:.4f}" for value in values)
            + " |"
        )
    return "\n".join(lines) + "\n"


def validate_cells(trials: list[dict]) -> None:
    for key, expected_solves in EXPECTED_SOLVES.items():
        cell = [
            trial
            for trial in trials
            if trial["valid"] and (trial["task"], trial["model"]) == key
        ]
        if len(cell) != 8 or sum(item["passed"] for item in cell) != expected_solves:
            raise SystemExit(
                f"unexpected cell {key}: n={len(cell)} "
                f"solves={sum(item['passed'] for item in cell)}"
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence_dirs", type=Path, nargs="*")
    args = parser.parse_args()
    roots = tuple(path.resolve() for path in args.evidence_dirs) or DEFAULT_ROOTS
    trials = load_trials(roots)
    validate_cells(trials)

    index_dir = ROOT / "sample-run" / "indexes"
    index_dir.mkdir(parents=True, exist_ok=True)
    (index_dir / "trials.json").write_text(json.dumps(trials, indent=2) + "\n")
    (index_dir / "pass-rate-matrix.md").write_text(render_matrix(trials))
    by_model = {}
    labels = {canonical: label for canonical, label in MODEL_ALIASES.values()}
    for model in MODEL_ORDER:
        cell = [trial for trial in trials if trial["valid"] and trial["model"] == model]
        if cell:
            by_model[model] = {
                "label": labels[model],
                "scored": len(cell),
                "solved": sum(t["passed"] for t in cell),
            }
    controls = None
    control_manifest = ROOT / "sample-run" / "manifests" / "public-controls-validation.json"
    if control_manifest.is_file():
        controls = json.loads(control_manifest.read_text())["summary"]
    summary = {
        "cohort_directories": [display_path(path) for path in roots],
        "scored_valid_trials": sum(trial["valid"] for trial in trials),
        "trials_excluded_no_attempt": sum(not trial["valid"] for trial in trials),
        "denominator_policy": (
            "numeric verifier reward, agent process started, no Harbor exception, "
            "native, normalized, and text trajectories, verifier report, and reward; submitted "
            "deliverables are included where the source evidence package provided them"
        ),
        "by_model": by_model,
        "public_controls": controls,
    }
    (index_dir / "execution-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )
    print(f"indexed={len(trials)} valid={sum(t['valid'] for t in trials)}")


if __name__ == "__main__":
    main()
