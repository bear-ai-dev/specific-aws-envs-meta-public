#!/usr/bin/env python3
"""Export plot-ready per-trial metrics from the canonical Meta sample cohort."""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "sample-run/indexes/trials.json"
MANIFEST_PATH = ROOT / "sample-run/manifests/frozen-cohort.json"
OUTPUT_DIR = ROOT / "sample-run/metrics"
CSV_PATH = OUTPUT_DIR / "per-trial-metrics.csv"
JSON_PATH = OUTPUT_DIR / "per-trial-metrics.json"
SUMMARY_PATH = OUTPUT_DIR / "summary.json"

FIELDS = (
    "trial_id",
    "attempt",
    "task",
    "task_label",
    "model",
    "model_label",
    "agent",
    "agent_version",
    "passed",
    "reward",
    "valid",
    "task_digest",
    "result_task_checksum",
    "started_at",
    "finished_at",
    "agent_started_at",
    "agent_finished_at",
    "agent_seconds",
    "full_trial_seconds",
    "setup_seconds",
    "verifier_seconds",
    "model_api_calls",
    "assistant_messages",
    "atif_steps",
    "tool_calls_requested",
    "tool_calls_executed",
    "tool_calls_not_executed",
    "tool_nonzero_exit_count",
    "tool_exception_count",
    "max_tools_in_one_model_call",
    "tool_names",
    "input_tokens",
    "cached_input_tokens",
    "uncached_input_tokens",
    "output_tokens",
    "total_tokens",
    "cost_usd",
    "result_path",
    "trajectory_path",
    "native_trajectory_path",
    "verifier_report_path",
)


def load_json(path: Path):
    return json.loads(path.read_text())


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def seconds(started_at: str, finished_at: str) -> float:
    return round((parse_time(finished_at) - parse_time(started_at)).total_seconds(), 6)


def nearest_rank(values: list[float | int], percentile: float):
    ordered = sorted(values)
    index = max(0, min(math.ceil(percentile * len(ordered)) - 1, len(ordered) - 1))
    return ordered[index]


def distribution(values: list[float | int]) -> dict:
    return {
        "min": min(values),
        "median": statistics.median(values),
        "p90": nearest_rank(values, 0.9),
        "max": max(values),
    }


def tool_metrics(messages: list[dict]) -> dict:
    assistant_messages = [message for message in messages if message.get("role") == "assistant"]
    tool_messages = [message for message in messages if message.get("role") == "tool"]
    requested = sum(len(message.get("tool_calls") or []) for message in assistant_messages)
    if requested != len(tool_messages):
        raise ValueError(
            f"tool request/response mismatch: requested={requested} responses={len(tool_messages)}"
        )

    executed = 0
    not_executed = 0
    nonzero = 0
    exceptions = 0
    for message in tool_messages:
        extra = message.get("extra") or {}
        returncode = extra.get("returncode")
        exception_info = extra.get("exception_info") or ""
        if returncode is None:
            raise ValueError("tool response has no returncode")
        was_not_executed = returncode == -1 or "not executed" in str(exception_info).lower()
        if was_not_executed:
            not_executed += 1
        else:
            executed += 1
        if returncode not in (0, -1):
            nonzero += 1
        if exception_info and not was_not_executed:
            exceptions += 1

    tool_names = sorted(
        {
            call["function"]["name"]
            for message in assistant_messages
            for call in (message.get("tool_calls") or [])
        }
    )
    return {
        "assistant_messages": len(assistant_messages),
        "tool_calls_requested": requested,
        "tool_calls_executed": executed,
        "tool_calls_not_executed": not_executed,
        "tool_nonzero_exit_count": nonzero,
        "tool_exception_count": exceptions,
        "max_tools_in_one_model_call": max(
            (len(message.get("tool_calls") or []) for message in assistant_messages),
            default=0,
        ),
        "tool_names": tool_names,
    }


def ordered_attempts(index: list[dict]) -> list[tuple[dict, int]]:
    """Keep index cell order while numbering attempts by recorded start time."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for item in index:
        groups.setdefault((item["task"], item["model"]), []).append(item)

    ordered: list[tuple[dict, int]] = []
    for key, cell in groups.items():
        if len(cell) != 8:
            raise ValueError(f"expected 8 trials in {key}, found {len(cell)}")
        chronological = sorted(
            cell,
            key=lambda item: (
                parse_time(load_json(ROOT / item["result"])["started_at"]),
                item["trial"],
            ),
        )
        ordered.extend((item, attempt) for attempt, item in enumerate(chronological, 1))
    return ordered


def build_row(index_item: dict, attempt: int, public_task_sha256: dict[str, str]) -> dict:
    result = load_json(ROOT / index_item["result"])
    native = load_json(ROOT / index_item["trajectory"])
    atif = load_json(ROOT / index_item["normalized_trajectory"])
    verifier_reward = load_json(ROOT / index_item["verifier"])["reward"]

    result_reward = result["verifier_result"]["rewards"]["reward"]
    if verifier_reward != result_reward or verifier_reward != index_item["reward"]:
        raise ValueError(f"reward mismatch for {index_item['trial']}")

    agent_result = result["agent_result"]
    input_tokens = agent_result["n_input_tokens"]
    cached_tokens = agent_result["n_cache_tokens"]
    output_tokens = agent_result["n_output_tokens"]
    cost_usd = agent_result["cost_usd"]
    if (
        index_item["input_tokens"] != input_tokens
        or index_item["cache_tokens"] != cached_tokens
        or index_item["output_tokens"] != output_tokens
        or not math.isclose(index_item["reported_cost_usd"], cost_usd)
    ):
        raise ValueError(f"index/result metric mismatch for {index_item['trial']}")
    if cached_tokens > input_tokens:
        raise ValueError(f"cached tokens exceed input tokens for {index_item['trial']}")
    if bool(verifier_reward) != index_item["passed"] or result["exception_info"] is not None:
        raise ValueError(f"index/result validity mismatch for {index_item['trial']}")

    final_metrics = atif["final_metrics"]
    atif_cost = final_metrics.get("total_cost_usd")
    atif_cost_matches = (
        math.isclose(atif_cost, cost_usd)
        if isinstance(atif_cost, (int, float))
        else math.isclose(cost_usd, 0.0)
    )
    if (
        final_metrics["total_prompt_tokens"] != input_tokens
        or final_metrics["total_cached_tokens"] != cached_tokens
        or final_metrics["total_completion_tokens"] != output_tokens
        or not atif_cost_matches
    ):
        raise ValueError(f"ATIF/result metric mismatch for {index_item['trial']}")

    tools = tool_metrics(native["messages"])
    model_api_calls = native["info"]["model_stats"]["api_calls"]
    if model_api_calls < tools["assistant_messages"]:
        raise ValueError(f"fewer API calls than assistant messages for {index_item['trial']}")

    task = index_item["task"]
    if task not in public_task_sha256:
        raise ValueError(f"missing public task digest for {task}")
    agent = atif["agent"]
    row = {
        "trial_id": index_item["trial"],
        "attempt": attempt,
        "task": task,
        "task_label": index_item["task_label"],
        "model": index_item["model"],
        "model_label": index_item["model_label"],
        "agent": agent["name"],
        "agent_version": agent["version"],
        "passed": index_item["passed"],
        "reward": verifier_reward,
        "valid": index_item["valid"],
        "task_digest": f"sha256:{public_task_sha256[task]}",
        "result_task_checksum": result["task_checksum"],
        "started_at": result["started_at"],
        "finished_at": result["finished_at"],
        "agent_started_at": result["agent_execution"]["started_at"],
        "agent_finished_at": result["agent_execution"]["finished_at"],
        "agent_seconds": seconds(
            result["agent_execution"]["started_at"],
            result["agent_execution"]["finished_at"],
        ),
        "full_trial_seconds": seconds(result["started_at"], result["finished_at"]),
        "setup_seconds": seconds(
            result["agent_setup"]["started_at"], result["agent_setup"]["finished_at"]
        ),
        "verifier_seconds": seconds(
            result["verifier"]["started_at"], result["verifier"]["finished_at"]
        ),
        "model_api_calls": model_api_calls,
        "assistant_messages": tools["assistant_messages"],
        "atif_steps": final_metrics["total_steps"],
        "tool_calls_requested": tools["tool_calls_requested"],
        "tool_calls_executed": tools["tool_calls_executed"],
        "tool_calls_not_executed": tools["tool_calls_not_executed"],
        "tool_nonzero_exit_count": tools["tool_nonzero_exit_count"],
        "tool_exception_count": tools["tool_exception_count"],
        "max_tools_in_one_model_call": tools["max_tools_in_one_model_call"],
        "tool_names": tools["tool_names"],
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_tokens,
        "uncached_input_tokens": input_tokens - cached_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost_usd": cost_usd,
        "result_path": index_item["result"],
        "trajectory_path": index_item["normalized_trajectory"],
        "native_trajectory_path": index_item["trajectory"],
        "verifier_report_path": index_item["verifier_report"],
    }
    if set(row) != set(FIELDS):
        raise ValueError(f"metric schema mismatch for {index_item['trial']}")
    return row


def cell_summaries(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        grouped[(row["task"], row["model"])].append(row)

    summaries = []
    for cell in grouped.values():
        first = cell[0]
        summaries.append(
            {
                "task": first["task"],
                "task_label": first["task_label"],
                "model": first["model"],
                "model_label": first["model_label"],
                "attempts": len(cell),
                "solves": sum(row["passed"] for row in cell),
                "observed_pass_rate": sum(row["passed"] for row in cell) / len(cell),
                "median_agent_seconds": statistics.median(
                    row["agent_seconds"] for row in cell
                ),
                "median_model_api_calls": statistics.median(
                    row["model_api_calls"] for row in cell
                ),
                "median_tool_calls_requested": statistics.median(
                    row["tool_calls_requested"] for row in cell
                ),
                "median_total_tokens": statistics.median(row["total_tokens"] for row in cell),
                "median_cost_usd": statistics.median(row["cost_usd"] for row in cell),
            }
        )
    return summaries


def render_outputs(rows: list[dict]) -> dict[Path, str]:
    csv_buffer = io.StringIO(newline="")
    writer = csv.DictWriter(csv_buffer, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        csv_row = dict(row)
        csv_row["tool_names"] = ";".join(row["tool_names"])
        writer.writerow(csv_row)

    summary_metrics = (
        "agent_seconds",
        "full_trial_seconds",
        "setup_seconds",
        "verifier_seconds",
        "model_api_calls",
        "tool_calls_requested",
        "tool_calls_executed",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "total_tokens",
        "cost_usd",
    )
    summary = {
        "source_index": INDEX_PATH.relative_to(ROOT).as_posix(),
        "trials": len(rows),
        "valid_trials": sum(row["valid"] for row in rows),
        "models": sorted({row["model_label"] for row in rows}),
        "tasks": sorted({row["task"] for row in rows}),
        "tool_names": sorted({name for row in rows for name in row["tool_names"]}),
        "metrics": {
            metric: distribution([row[metric] for row in rows]) for metric in summary_metrics
        },
        "cells": cell_summaries(rows),
    }
    return {
        JSON_PATH: json.dumps(rows, indent=2) + "\n",
        CSV_PATH: csv_buffer.getvalue(),
        SUMMARY_PATH: json.dumps(summary, indent=2) + "\n",
    }


def generate() -> dict[Path, str]:
    index = load_json(INDEX_PATH)
    manifest = load_json(MANIFEST_PATH)
    rows = [
        build_row(item, attempt, manifest["public_task_sha256"])
        for item, attempt in ordered_attempts(index)
    ]
    if len(rows) % 16 or not all(row["valid"] for row in rows):
        raise SystemExit(f"expected a whole number of eight-trial cells, found {len(rows)}")
    return render_outputs(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that committed metric exports exactly match their sources",
    )
    args = parser.parse_args()
    outputs = generate()
    exported = len(json.loads(outputs[JSON_PATH]))

    if args.check:
        stale = [path.relative_to(ROOT) for path, text in outputs.items() if not path.is_file() or path.read_text() != text]
        if stale:
            raise SystemExit("stale metric export: " + ", ".join(map(str, stale)))
        print(f"metric export validation passed: trials={exported} files=3")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in outputs.items():
        path.write_text(text)
    print(
        f"exported={exported} csv={CSV_PATH.relative_to(ROOT)} "
        f"json={JSON_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
