"""Run a Harbor task end to end and record the trial.

Implements the Harbor task contract directly: build `environment/`, start the
container, run an agent against `instruction.md`, stage `tests/` at `/tests` as
root, run `/tests/test.sh`, and read the reward from
`/logs/verifier/reward.json`.

    python -m harness.run_task --task tasks/03-... --agent oracle
    python -m harness.run_task --task tasks/03-... --agent model \
        --model anthropic/claude-opus-5 --attempts 8
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import sys
import time
import tomllib
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from .agent import AgentRun, Step, run_agent
from .container import Container, DockerError
from .env import int_setting, load_dotenv, setting

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class TrialResult:
    task: str
    agent: str
    model: str | None
    attempt: int
    reward: float
    passed: bool
    subscores: list[dict]
    additional_data: dict
    stop_reason: str
    agent_steps: int
    cost_usd: float
    wall_seconds: float
    error: str | None = None


def load_task(task_dir: Path) -> dict:
    with (task_dir / "task.toml").open("rb") as handle:
        return tomllib.load(handle)


def image_tag(task_dir: Path) -> str:
    return f"awsrl/{task_dir.name}:latest"


def build_image(task_dir: Path, rebuild: bool) -> str:
    tag = image_tag(task_dir)
    if not rebuild:
        exists = os.popen(f"docker images -q {tag}").read().strip()
        if exists:
            return tag
    print(f"[build] {tag}", flush=True)
    Container.build(task_dir / "environment", tag, dockerfile=task_dir / "environment" / "Dockerfile")
    return tag


def run_verifier(container: Container, task_dir: Path, admin_token: str) -> dict:
    container.exec("rm -rf /tests /logs && mkdir -p /logs/verifier", user="root", workdir="/")
    container.copy_in(task_dir / "tests", "/tests")
    container.exec("chown -R root:root /tests && chmod -R go-w /tests", user="root", workdir="/")
    result = container.exec(
        "bash /tests/test.sh",
        user="root",
        workdir="/",
        timeout=1800,
        env={"MOCKAWS_ADMIN_TOKEN": admin_token},
    )
    print(f"[verify] exit={result.exit_code}", flush=True)
    raw = container.exec("cat /logs/verifier/reward.json", user="root", workdir="/", timeout=60)
    if raw.exit_code != 0:
        return {"reward": 0.0, "error": "no reward.json", "verifier_log": result.output[-4000:]}
    try:
        payload = json.loads(raw.output)
    except json.JSONDecodeError:
        return {"reward": 0.0, "error": "unparseable reward.json", "verifier_log": result.output[-4000:]}
    payload["verifier_log"] = result.output[-8000:]
    return payload


def run_oracle(container: Container, task_dir: Path) -> AgentRun:
    container.exec("rm -rf /solution", user="root", workdir="/")
    container.copy_in(task_dir / "solution", "/solution")
    container.exec("chmod -R a+rX /solution", user="root", workdir="/")
    result = container.exec("bash /solution/solve.sh", user="root", workdir="/app", timeout=900)
    run = AgentRun(model="oracle")
    run.stop_reason = "oracle_finished" if result.exit_code == 0 else "oracle_failed"
    run.steps.append(
        Step(step_id=0, source="agent", message="bash /solution/solve.sh", observation=result.render())
    )
    return run


def one_trial(
    task_dir: Path,
    tag: str,
    agent_kind: str,
    attempt: int,
    *,
    model: str | None,
    api_key: str | None,
    max_steps: int,
    reasoning_effort: str | None,
    artifacts_dir: Path,
    cpus: float | None = None,
    memory_mb: int | None = None,
) -> TrialResult:
    task = load_task(task_dir)
    environment = task.get("environment", {})
    admin_token = uuid.uuid4().hex
    started = time.time()
    container = None
    try:
        container = Container.start(
            tag,
            cpus=float(cpus if cpus is not None else environment.get("cpus", 2)),
            memory_mb=int(memory_mb if memory_mb is not None else environment.get("memory_mb", 4096)),
            prefix=f"awsrl-{attempt}",
        )
        if not container.wait_healthy():
            raise DockerError(f"task infrastructure never became ready:\n{container.logs()[-3000:]}")

        if agent_kind == "oracle":
            run = run_oracle(container, task_dir)
        elif agent_kind == "noop":
            run = AgentRun(model="noop")
            run.stop_reason = "noop"
        else:
            if not api_key:
                raise RuntimeError("OPENROUTER_API_KEY is required for --agent model")
            instruction = (task_dir / "instruction.md").read_text()
            run = run_agent(
                container,
                instruction,
                model=model or "",
                api_key=api_key,
                max_steps=max_steps,
                wall_clock_limit=int(task.get("agent", {}).get("timeout_sec", 7200)),
                reasoning_effort=reasoning_effort,
            )

        reward_payload = run_verifier(container, task_dir, admin_token)
        reward = float(reward_payload.get("reward", reward_payload.get("score", 0.0)) or 0.0)

        session_id = f"{task_dir.name}-{agent_kind}-{attempt}-{uuid.uuid4().hex[:8]}"
        trial_dir = artifacts_dir / session_id
        trial_dir.mkdir(parents=True, exist_ok=True)
        (trial_dir / "trajectory.json").write_text(
            json.dumps(run.to_atif(session_id), indent=2), encoding="utf-8"
        )
        (trial_dir / "reward.json").write_text(json.dumps(reward_payload, indent=2), encoding="utf-8")
        container.copy_out("/app", trial_dir / "workspace")

        return TrialResult(
            task=task_dir.name,
            agent=agent_kind,
            model=model,
            attempt=attempt,
            reward=reward,
            passed=reward >= 1.0,
            subscores=reward_payload.get("subscores", []),
            additional_data=reward_payload.get("additional_data", {}),
            stop_reason=run.stop_reason,
            agent_steps=sum(1 for step in run.steps if step.source == "agent"),
            cost_usd=run.cost_usd,
            wall_seconds=time.time() - started,
            error=run.error,
        )
    except Exception as exc:  # noqa: BLE001 - a failed trial is data, not a crash
        return TrialResult(
            task=task_dir.name,
            agent=agent_kind,
            model=model,
            attempt=attempt,
            reward=0.0,
            passed=False,
            subscores=[],
            additional_data={},
            stop_reason="harness_error",
            agent_steps=0,
            cost_usd=0.0,
            wall_seconds=time.time() - started,
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        if container is not None:
            container.remove()


def score_run(results: list[TrialResult]) -> dict:
    """pass@k is measured with exactly k attempts: it passes if any attempt did."""
    total = len(results)
    passes = sum(1 for result in results if result.passed)
    rewards = [result.reward for result in results]
    return {
        "k": total,
        "attempts": total,
        "passes": passes,
        "pass_rate_per_attempt": (passes / total) if total else 0.0,
        f"pass_at_{total}": 1.0 if passes else 0.0,
        "mean_reward": (sum(rewards) / total) if total else 0.0,
        "max_reward": max(rewards) if rewards else 0.0,
    }


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Run a Harbor task")
    parser.add_argument("--task", required=True)
    parser.add_argument("--agent", default="oracle", choices=["oracle", "noop", "model"])
    parser.add_argument("--model")
    parser.add_argument(
        "--attempts",
        type=int,
        default=None,
        help="Attempts to run. Defaults to 1 for oracle/noop and PASS_AT_K for a model.",
    )
    parser.add_argument("--concurrency", type=int, default=int_setting("CONCURRENCY", 4))
    parser.add_argument("--max-steps", type=int, default=int_setting("MAX_STEPS", 90))
    parser.add_argument("--reasoning-effort", default=setting("REASONING_EFFORT"))
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--artifacts", default=None)
    parser.add_argument(
        "--cpus",
        type=float,
        default=None,
        help="Override the task's declared CPU limit (useful when running trials in parallel).",
    )
    parser.add_argument(
        "--memory-mb",
        type=int,
        default=int_setting("TRIAL_MEMORY_MB", 0) or None,
        help="Override the task's declared memory limit.",
    )
    args = parser.parse_args()

    if args.attempts is None:
        args.attempts = int_setting("PASS_AT_K", 8) if args.agent == "model" else 1

    task_dir = Path(args.task).resolve()
    if not (task_dir / "task.toml").exists():
        print(f"not a Harbor task directory: {task_dir}", file=sys.stderr)
        return 2

    tag = build_image(task_dir, args.rebuild)
    api_key = os.environ.get("OPENROUTER_API_KEY")

    label = args.model.replace("/", "_") if args.model else args.agent
    artifacts_dir = Path(args.artifacts) if args.artifacts else ROOT / "traces" / task_dir.name / label
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    results: list[TrialResult] = []
    concurrency = max(1, min(args.concurrency, args.attempts))
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(
                one_trial,
                task_dir,
                tag,
                args.agent,
                attempt,
                model=args.model,
                api_key=api_key,
                max_steps=args.max_steps,
                reasoning_effort=args.reasoning_effort,
                artifacts_dir=artifacts_dir,
                cpus=args.cpus,
                memory_mb=args.memory_mb,
            )
            for attempt in range(1, args.attempts + 1)
        ]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            status = "PASS" if result.passed else "fail"
            print(
                f"[{status}] attempt={result.attempt} reward={result.reward:.4f} "
                f"steps={result.agent_steps} stop={result.stop_reason} "
                f"${result.cost_usd:.3f} {result.wall_seconds:.0f}s"
                + (f" error={result.error}" if result.error else ""),
                flush=True,
            )

    results.sort(key=lambda item: item.attempt)
    summary = {
        "task": task_dir.name,
        "agent": args.agent,
        "model": args.model,
        **score_run(results),
        "trials": [asdict(result) for result in results],
    }
    summary_path = artifacts_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps({k: v for k, v in summary.items() if k != "trials"}, indent=2))
    print(f"artifacts: {artifacts_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
