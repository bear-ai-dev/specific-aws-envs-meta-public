"""Roll up recorded trials into the headline pass@k table.

Each measured run is exactly k attempts, so pass@k is simply whether any of
those k attempts reached reward 1.0. The per-attempt rate and its Wilson
interval come along because that is the number you actually turn when an
environment misses its calibration target.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path


def wilson_interval(n: int, c: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for the per-attempt pass rate."""
    if n == 0:
        return (0.0, 1.0)
    phat = c / n
    denominator = 1 + z**2 / n
    centre = (phat + z**2 / (2 * n)) / denominator
    margin = z * math.sqrt(phat * (1 - phat) / n + z**2 / (4 * n**2)) / denominator
    return (max(0.0, centre - margin), min(1.0, centre + margin))


@dataclass
class RunSummary:
    task: str
    model: str
    k: int
    passes: int
    pass_at_k: float
    per_attempt_rate: float
    per_attempt_ci: tuple[float, float]
    mean_reward: float
    max_reward: float
    mean_cost_usd: float
    mean_agent_steps: float
    stop_reasons: dict[str, int]

    def as_dict(self) -> dict:
        payload = self.__dict__.copy()
        payload["per_attempt_ci"] = list(self.per_attempt_ci)
        return payload


def summarize(summary_path: Path) -> RunSummary:
    data = json.loads(summary_path.read_text())
    trials = data.get("trials", [])
    k = len(trials)
    passes = sum(1 for trial in trials if trial.get("passed"))

    stop_reasons: dict[str, int] = {}
    for trial in trials:
        reason = trial.get("stop_reason", "unknown")
        stop_reasons[reason] = stop_reasons.get(reason, 0) + 1

    def mean(field: str) -> float:
        values = [float(trial.get(field) or 0.0) for trial in trials]
        return sum(values) / len(values) if values else 0.0

    rewards = [float(trial.get("reward") or 0.0) for trial in trials]
    return RunSummary(
        task=data.get("task", summary_path.parent.parent.name),
        model=data.get("model") or data.get("agent", "unknown"),
        k=k,
        passes=passes,
        pass_at_k=1.0 if passes else 0.0,
        per_attempt_rate=(passes / k) if k else 0.0,
        per_attempt_ci=wilson_interval(k, passes),
        mean_reward=mean("reward"),
        max_reward=max(rewards) if rewards else 0.0,
        mean_cost_usd=mean("cost_usd"),
        mean_agent_steps=mean("agent_steps"),
        stop_reasons=stop_reasons,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggregate pass@k across recorded runs")
    parser.add_argument("--traces", default="traces")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a table")
    args = parser.parse_args()

    root = Path(args.traces)
    summaries = [summarize(path) for path in sorted(root.glob("*/*/summary.json"))]
    if not summaries:
        print(f"no summary.json files under {root}")
        return 1

    if args.json:
        print(json.dumps([summary.as_dict() for summary in summaries], indent=2))
        return 0

    header = (
        f"{'task':<40} {'model':<26} {'k':>2} {'passed':>6} "
        f"{'pass@k':>7} {'p/attempt':>10} {'reward':>7} {'$/try':>7}"
    )
    print(header)
    print("-" * len(header))
    for summary in summaries:
        low, high = summary.per_attempt_ci
        print(
            f"{summary.task:<40} {summary.model:<26} {summary.k:>2} {summary.passes:>6} "
            f"{summary.pass_at_k:>7.2f} {summary.per_attempt_rate:>10.2f} "
            f"{summary.mean_reward:>7.3f} {summary.mean_cost_usd:>7.3f}"
            f"   [{low:.2f}, {high:.2f}]"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
