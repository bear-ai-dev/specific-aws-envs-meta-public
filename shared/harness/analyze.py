"""Mine recorded trajectories for the behaviours that separate passes from failures.

Reward alone says an attempt failed; it does not say why. This walks the ATIF
trajectories alongside their reward documents and extracts behavioural
evidence — did the attempt read the specification, did it use the feedback
loop, did it stop early, which spec rules did the verifier flag — so the
failure-mode analysis rests on counts rather than impressions.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Behavioural probes, matched against the text of every command the attempt ran.
PROBES: dict[str, re.Pattern[str]] = {
    "read_spec": re.compile(r"(billing-spec|attribution-spec|cutover-runbook|capacity-spec|docs/)", re.I),
    "ran_feedback_loop": re.compile(r"\bmake\s+check\b|verify\.py", re.I),
    "ran_job_directly": re.compile(r"(measure_datastore|reconcile|cutover|plan_and_harden)\.py", re.I),
    "inspected_endpoint": re.compile(r"(boto3|aws\s+--endpoint|curl\s+.*4566)", re.I),
    "listed_pricing": re.compile(r"(get_products|pricing)", re.I),
    "searched_code": re.compile(r"\b(rg|grep|ag)\b", re.I),
    "probed_holdout": re.compile(r"(/var/lib/task-data|holdout|_admin)", re.I),
}


@dataclass
class Attempt:
    task: str
    model: str
    session: str
    reward: float
    passed: bool
    stop_reason: str
    agent_steps: int
    tool_calls: int
    bash_calls: int
    write_calls: int
    failed_commands: int
    reasoning_chars: int
    cost_usd: float
    signals: list[str] = field(default_factory=list)
    behaviours: dict[str, int] = field(default_factory=dict)
    overfit_to_fixture: bool = False
    final_message: str = ""


def _walk_signals(payload: Any, found: set[str]) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key == "signals" and isinstance(value, list):
                found.update(str(item) for item in value)
            else:
                _walk_signals(value, found)
    elif isinstance(payload, list):
        for item in payload:
            _walk_signals(item, found)


def load_attempt(session_dir: Path, task: str, model: str) -> Attempt | None:
    trajectory_path = session_dir / "trajectory.json"
    reward_path = session_dir / "reward.json"
    if not trajectory_path.exists() or not reward_path.exists():
        return None

    trajectory = json.loads(trajectory_path.read_text())
    reward_doc = json.loads(reward_path.read_text())
    reward = float(reward_doc.get("reward", reward_doc.get("score", 0.0)) or 0.0)

    signals: set[str] = set()
    _walk_signals(reward_doc.get("additional_data", {}), signals)

    behaviours = Counter()
    bash_calls = write_calls = failed_commands = tool_calls = 0
    reasoning_chars = 0
    final_message = ""

    for step in trajectory.get("steps", []):
        source = step.get("source")
        if source == "agent":
            reasoning_chars += len(step.get("reasoning") or "")
            if not step.get("tool_calls"):
                final_message = step.get("message") or final_message
            for call in step.get("tool_calls") or []:
                tool_calls += 1
                name = call.get("name")
                arguments = str(call.get("arguments") or "")
                if name == "bash":
                    bash_calls += 1
                elif name == "write_file":
                    write_calls += 1
                for probe, pattern in PROBES.items():
                    if pattern.search(arguments):
                        behaviours[probe] += 1
        elif source == "tool":
            if (step.get("metrics") or {}).get("exit_code") not in (0, None):
                failed_commands += 1

    metrics = trajectory.get("final_metrics", {})
    return Attempt(
        task=task,
        model=model,
        session=session_dir.name,
        reward=reward,
        passed=reward >= 1.0,
        stop_reason=metrics.get("stop_reason", "unknown"),
        agent_steps=int(metrics.get("agent_steps") or 0),
        tool_calls=tool_calls,
        bash_calls=bash_calls,
        write_calls=write_calls,
        failed_commands=failed_commands,
        reasoning_chars=reasoning_chars,
        cost_usd=float(metrics.get("total_cost_usd") or 0.0),
        signals=sorted(signals),
        behaviours=dict(behaviours),
        overfit_to_fixture=bool(reward_doc.get("additional_data", {}).get("overfit_to_fixture")),
        final_message=(final_message or "")[:1200],
    )


def collect(traces_root: Path) -> list[Attempt]:
    attempts: list[Attempt] = []
    for task_dir in sorted(p for p in traces_root.iterdir() if p.is_dir()):
        for model_dir in sorted(p for p in task_dir.iterdir() if p.is_dir()):
            for session_dir in sorted(p for p in model_dir.iterdir() if p.is_dir()):
                attempt = load_attempt(session_dir, task_dir.name, model_dir.name)
                if attempt is not None:
                    attempts.append(attempt)
    return attempts


def group_report(attempts: list[Attempt]) -> dict[str, Any]:
    grouped: dict[tuple[str, str], list[Attempt]] = {}
    for attempt in attempts:
        grouped.setdefault((attempt.task, attempt.model), []).append(attempt)

    report: dict[str, Any] = {}
    for (task, model), group in sorted(grouped.items()):
        passes = [a for a in group if a.passed]
        failures = [a for a in group if not a.passed]

        signal_counts = Counter()
        for attempt in failures:
            signal_counts.update(attempt.signals)

        behaviour_rates: dict[str, dict[str, float]] = {}
        for probe in PROBES:
            def rate(subset: list[Attempt]) -> float:
                if not subset:
                    return float("nan")
                return sum(1 for a in subset if a.behaviours.get(probe)) / len(subset)

            behaviour_rates[probe] = {
                "passing": round(rate(passes), 3),
                "failing": round(rate(failures), 3),
            }

        def mean(subset: list[Attempt], field_name: str) -> float:
            if not subset:
                return float("nan")
            return round(sum(getattr(a, field_name) for a in subset) / len(subset), 2)

        report[f"{task}::{model}"] = {
            "attempts": len(group),
            "passes": len(passes),
            "mean_reward": round(sum(a.reward for a in group) / len(group), 4),
            "stop_reasons": dict(Counter(a.stop_reason for a in group)),
            "top_failure_signals": signal_counts.most_common(12),
            "overfit_to_fixture_count": sum(1 for a in group if a.overfit_to_fixture),
            "behaviour_rate_pass_vs_fail": behaviour_rates,
            "mean_tool_calls": {
                "passing": mean(passes, "tool_calls"),
                "failing": mean(failures, "tool_calls"),
            },
            "mean_reasoning_chars": {
                "passing": mean(passes, "reasoning_chars"),
                "failing": mean(failures, "reasoning_chars"),
            },
            "mean_failed_commands": {
                "passing": mean(passes, "failed_commands"),
                "failing": mean(failures, "failed_commands"),
            },
        }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarise failure modes across recorded trials")
    parser.add_argument("--traces", default="traces")
    parser.add_argument("--out", help="Write the JSON report here as well as stdout")
    args = parser.parse_args()

    root = Path(args.traces)
    if not root.is_dir():
        print(f"no traces directory at {root}")
        return 1

    attempts = collect(root)
    if not attempts:
        print(f"no trajectories found under {root}")
        return 1

    report = {
        "total_attempts": len(attempts),
        "groups": group_report(attempts),
    }
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.out:
        Path(args.out).write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
