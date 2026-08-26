#!/usr/bin/env python3
"""Validate the complete eight-task public evaluation sample."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

sys.dont_write_bytecode = True


ROOT = Path(__file__).resolve().parent.parent
TASKS = (
    "01-entitlement-overage-lines",
    "02-measurement-failure-dlq",
    "03-customer-communication-dispatch",
    "04-iam-role-validation",
    "05-network-egress-metering",
    "06-api-token-metering",
    "07-api-keys-and-environments",
    "08-business-settings-persistence",
)
# Tasks whose published packages have been re-run with oracle and no-op control
# agents. Tasks 5-8 are published without control records; recording them is the
# outstanding publication step and is stated in the manifests and the README.
CONTROLLED_TASKS = TASKS[:4]
EXPECTED_HEADINGS = {
    TASKS[0]: "# Task 1 — entitlement overage lines",
    TASKS[1]: "# Task 2 — measurement failure DLQ",
    TASKS[2]: "# Task 3 — customer communication dispatch",
    TASKS[3]: "# Task 4 — IAM role validation",
    TASKS[4]: "# Task 5 — network egress metering",
    TASKS[5]: "# Task 6 — API token metering",
    TASKS[6]: "# Task 7 — API keys and environments",
    TASKS[7]: "# Task 8 — business settings persistence",
}
MUSE = "openrouter/meta/muse-spark-1.2"
MUSE_DIRECT = "meta/responses/muse-spark-1.2"
MUSE_OPENAI = "openai/muse-spark-1.2"
OPUS = "bedrock/us.anthropic.claude-opus-5"
EXPECTED_SOLVES = {
    (TASKS[0], MUSE): 0,
    (TASKS[0], OPUS): 8,
    (TASKS[1], MUSE): 2,
    (TASKS[1], OPUS): 8,
    (TASKS[2], MUSE): 5,
    (TASKS[2], OPUS): 8,
    (TASKS[3], MUSE_DIRECT): 4,
    (TASKS[3], OPUS): 8,
    (TASKS[4], MUSE_OPENAI): 6,
    (TASKS[4], OPUS): 8,
    (TASKS[5], MUSE_OPENAI): 1,
    (TASKS[5], OPUS): 7,
    (TASKS[6], MUSE_OPENAI): 2,
    (TASKS[6], OPUS): 8,
    (TASKS[7], MUSE_OPENAI): 4,
    (TASKS[7], OPUS): 8,
}
MODEL_SLUGS = {
    MUSE: "muse-spark-1.2",
    MUSE_DIRECT: "muse-spark-1.2",
    MUSE_OPENAI: "muse-spark-1.2",
    OPUS: "opus-5",
}
# Tasks 1-4 record one checksum shared by both cohorts. Tasks 5-8 record a
# different checksum per cohort because the packages were repackaged between the
# two rollouts; see task_checksum_note in public-transformation.json for the
# equivalence check that accompanies them.
RECORDED_TASK_CHECKSUMS = {
    TASKS[0]: {"*": ["34de6aa9cbef7bfa1c919c70303e304395147d45f83b511b910e3e73e9478332"]},
    TASKS[1]: {"*": ["19361ed95829b44118d905302f14abe8c8194bb17238b22c55ee524ef97a4dd5"]},
    TASKS[2]: {"*": ["ced28d55fa0d97f12302b61cb5a9106a1c304372b78cc594fcfc43d3b47a92ae"]},
    TASKS[3]: {"*": ["a74ca5430103a3a75e8c297f4629c77b51b8a3efcca108136df46566e1cc4a95"]},
    TASKS[4]: {
        MUSE_OPENAI: ["4374f9e85f50908804e00c228d4ee94d4c22ba896df0b844883b86e3c36497d8"],
        OPUS: ["6427d0d789ad611f6ebe201045f26ed7c62da6e71722d8792558a0fdf37c2b56",
               "3f7e8cc2f7d5910314cab6ee5598e5333a6599880f896994887590c69373231a"],
    },
    TASKS[5]: {
        MUSE_OPENAI: ["85c81815bb8bc1055dab72fb7c3f6ac5b50eff5c09f20f42df1308c98a6ef977"],
        OPUS: ["28a06245e0c745b4801d176437331dafcfbe631d51473b67d1050e58b355d134"],
    },
    TASKS[6]: {
        MUSE_OPENAI: ["383909d5ae907286dd206c3dcd0dcab80b2b2ca6d42b84bb1f48a609dfbc4af2"],
        OPUS: ["3f38fb2bc343a749016fa1425494c139f4baa0c44e84bb84c618d32ec94bb78e"],
    },
    TASKS[7]: {
        MUSE_OPENAI: ["280ebb9dd9a4cfd0e2ac90e2d8f7e3ee62de245aa9771991fdf873e1fbccba39"],
        OPUS: ["88ce741d2f494741a7134c98d75497b812295523d65605ba8a99abab0522e0d7"],
    },
}
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
REAL_AWS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
TOKEN_PREFIX = re.compile(
    r"(?:sk-or-v1-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|"
    r"github_pat_[A-Za-z0-9_]{20,}|dtn_[A-Za-z0-9_-]{20,}|"
    r"LLM_[A-Za-z0-9_-]{20,})"
)
LOCAL_HOME = re.compile(
    r"/(?:Users|home)/[^/\s]+/(?:Desktop|Documents|Projects|maintained)/[^\s\"']+"
)
PRIVATE_KEY = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
SOURCE_TERMS = (
    "Paigo",
    "paigo",
    "specific-aws-envs-xai",
    "dalton.dandrea",
    "matt.sun",
    "Daniel Wasserlauf",
)
SOURCE_PATTERNS = (
    re.compile(r"bear-ai-dev/specific-aws-envs-meta(?!-public)", re.IGNORECASE),
)
PATTERN_DEFINITIONS = {
    ROOT / "harness" / "redact_artifacts.py",
    ROOT / "harness" / "validate_publication.py",
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


def load_json(path: Path) -> dict | list:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"invalid JSON {path.relative_to(ROOT)}: {error}") from error


def validate_links() -> int:
    checked = 0
    for markdown in sorted(ROOT.rglob("*.md")):
        if ".git" in markdown.parts:
            continue
        for target in LINK.findall(markdown.read_text()):
            target = target.strip().split(" ", 1)[0]
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            path_part = unquote(target.split("#", 1)[0])
            if not path_part:
                continue
            resolved = (markdown.parent / path_part).resolve()
            if not resolved.exists():
                raise SystemExit(
                    f"broken link in {markdown.relative_to(ROOT)}: {target}"
                )
            checked += 1
    return checked


def validate_trials() -> list[dict]:
    trials = load_json(ROOT / "sample-run" / "indexes" / "trials.json")
    if not isinstance(trials, list) or len(trials) != 8 * len(EXPECTED_SOLVES):
        raise SystemExit(f"expected exactly {8 * len(EXPECTED_SOLVES)} indexed trials")
    if not all(trial.get("valid") for trial in trials):
        raise SystemExit("every indexed trial must be valid")

    for key, expected in EXPECTED_SOLVES.items():
        cell = [
            trial
            for trial in trials
            if (trial.get("task"), trial.get("model")) == key
        ]
        if len(cell) != 8 or sum(bool(trial.get("passed")) for trial in cell) != expected:
            raise SystemExit(f"unexpected trial cell {key}")

    for trial in trials:
        required_paths = (
            "trial_dir",
            "result",
            "trajectory",
            "normalized_trajectory",
            "text_trajectory",
            "verifier",
            "verifier_report",
        )
        for field in required_paths:
            path = ROOT / str(trial.get(field) or "")
            present = path.is_file() if field != "trial_dir" else path.is_dir()
            if not present:
                raise SystemExit(f"missing trial artifact {field}: {trial.get(field)}")

        deliverable = trial.get("deliverable")
        if deliverable and not (ROOT / deliverable).is_dir():
            raise SystemExit(f"missing submitted deliverable: {deliverable}")

        result = load_json(ROOT / trial["result"])
        reward_doc = load_json(ROOT / trial["verifier"])
        result_reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get(
            "reward"
        )
        reward_value = reward_doc.get("reward")
        if result_reward != reward_value or float(result_reward) != float(trial["reward"]):
            raise SystemExit(f"reward mismatch: {trial['trial']}")
        if result.get("exception_info") is not None:
            raise SystemExit(f"admitted trial has exception: {trial['trial']}")
        allowed_by_route = RECORDED_TASK_CHECKSUMS[trial["task"]]
        allowed = allowed_by_route.get("*") or allowed_by_route[trial["model"]]
        if result.get("task_checksum") not in allowed:
            raise SystemExit(f"recorded task checksum mismatch: {trial['trial']}")
    return trials


def validate_rendered_text_trajectories() -> None:
    from render_text_trajectories import generate_outputs

    outputs = generate_outputs()
    if len(outputs) != 16:
        raise SystemExit("expected 16 deterministic Task 4 text trajectories")
    for path, expected in outputs.items():
        if not path.is_file() or path.read_text() != expected:
            raise SystemExit(
                f"stale Task 4 text trajectory: {path.relative_to(ROOT)}"
            )


def validate_controls() -> None:
    path = ROOT / "sample-run" / "manifests" / "public-controls-validation.json"
    manifest = load_json(path)
    if manifest.get("summary") != {
        "trials": 8,
        "exceptions": 0,
        "oracle_all_reward_one": True,
        "nop_all_reward_zero": True,
    }:
        raise SystemExit("unexpected post-normalization control summary")
    for task in CONTROLLED_TASKS:
        record = (manifest.get("tasks") or {}).get(task)
        if not record:
            raise SystemExit(f"missing post-normalization controls: {task}")
        if record.get("public_task_sha256") != directory_sha256(ROOT / "tasks" / task):
            raise SystemExit(f"post-normalization task hash mismatch: {task}")
        if record.get("oracle", {}).get("reward") != 1.0:
            raise SystemExit(f"invalid oracle control: {task}")
        if record.get("nop", {}).get("reward") != 0.0:
            raise SystemExit(f"invalid no-op control: {task}")
        if record["oracle"].get("exception") is not None or record["nop"].get("exception") is not None:
            raise SystemExit(f"control exception: {task}")


def validate_metrics(trials: list[dict]) -> None:
    from export_trial_metrics import generate as generate_metric_outputs

    try:
        expected_outputs = generate_metric_outputs()
    except (KeyError, OSError, TypeError, ValueError) as error:
        raise SystemExit(f"metric source validation failed: {error}") from error
    for path, expected in expected_outputs.items():
        if not path.is_file():
            raise SystemExit(f"missing metric export: {path.relative_to(ROOT)}")
        if path.read_text() != expected:
            raise SystemExit(f"stale metric export: {path.relative_to(ROOT)}")

    rows = load_json(ROOT / "sample-run" / "metrics" / "per-trial-metrics.json")
    summary = load_json(ROOT / "sample-run" / "metrics" / "summary.json")
    if not isinstance(rows, list) or len(rows) != 8 * len(EXPECTED_SOLVES):
        raise SystemExit(f"expected exactly {8 * len(EXPECTED_SOLVES)} metric rows")
    if {row.get("trial_id") for row in rows} != {trial["trial"] for trial in trials}:
        raise SystemExit("metric rows do not match indexed trial membership")
    for key in EXPECTED_SOLVES:
        cell = [row for row in rows if (row.get("task"), row.get("model")) == key]
        if sorted(row.get("attempt") for row in cell) != list(range(1, 9)):
            raise SystemExit(f"unexpected metric attempts for {key}")
        if sum(bool(row.get("passed")) for row in cell) != EXPECTED_SOLVES[key]:
            raise SystemExit(f"unexpected metric solves for {key}")
        for row in cell:
            expected_trial_dir = (
                ROOT
                / "sample-run"
                / "trajectories"
                / row["task"]
                / MODEL_SLUGS[row["model"]]
                / f"trial-{row['attempt']:02d}"
            )
            if (ROOT / row["result_path"]).parent != expected_trial_dir:
                raise SystemExit(f"noncanonical trial path: {row['trial_id']}")
            if row["tool_calls_requested"] != (
                row["tool_calls_executed"] + row["tool_calls_not_executed"]
            ):
                raise SystemExit(f"tool-call accounting mismatch: {row['trial_id']}")
            if row["total_tokens"] != row["input_tokens"] + row["output_tokens"]:
                raise SystemExit(f"token accounting mismatch: {row['trial_id']}")
            if row["uncached_input_tokens"] != (
                row["input_tokens"] - row["cached_input_tokens"]
            ):
                raise SystemExit(f"cached-token accounting mismatch: {row['trial_id']}")
    if summary.get("source_index") != "sample-run/indexes/trials.json":
        raise SystemExit("metric summary source mismatch")
    expected_trials = 8 * len(EXPECTED_SOLVES)
    if summary.get("trials") != expected_trials or summary.get("valid_trials") != expected_trials:
        raise SystemExit("metric summary trial count mismatch")
    if len(summary.get("cells") or []) != len(EXPECTED_SOLVES):
        raise SystemExit("metric summary cell count mismatch")


def validate_manifests() -> None:
    transformation_path = ROOT / "sample-run" / "manifests" / "public-transformation.json"
    transformation = load_json(transformation_path)
    for task in TASKS:
        expected = directory_sha256(ROOT / "tasks" / task)
        if transformation["public_task_sha256"].get(task) != expected:
            raise SystemExit(f"transformation task hash mismatch: {task}")
        recorded = transformation["recorded_harbor_task_checksum"].get(task)
        allowed_by_route = RECORDED_TASK_CHECKSUMS[task]
        if "*" in allowed_by_route:
            if recorded != allowed_by_route["*"][0]:
                raise SystemExit(f"transformation recorded checksum mismatch: {task}")
        else:
            by_cohort = transformation["recorded_harbor_task_checksum_by_cohort"][task]
            for slug, values in by_cohort.items():
                route = MUSE_OPENAI if slug == "muse-spark-1.2" else OPUS
                if values != allowed_by_route[route]:
                    raise SystemExit(f"transformation cohort checksum mismatch: {task}/{slug}")

    frozen_path = ROOT / "sample-run" / "manifests" / "frozen-cohort.json"
    frozen = load_json(frozen_path)
    if frozen.get("schema_version") != 2 or len(frozen.get("cohorts") or []) != 3:
        raise SystemExit("frozen cohort registry mismatch")
    if frozen.get("attempts_per_task_model") != 8:
        raise SystemExit("frozen cohort attempt count mismatch")
    if frozen.get("cohort_config_sha256") != sha256(ROOT / "harness" / "cohort.json"):
        raise SystemExit("frozen cohort config hash mismatch")
    if frozen.get("task4_cohort_config_sha256") != sha256(
        ROOT / "harness" / "task4-cohort.json"
    ):
        raise SystemExit("frozen Task 4 cohort config hash mismatch")
    if frozen.get("controls_config_sha256") != sha256(ROOT / "harness" / "controls.json"):
        raise SystemExit("frozen controls config hash mismatch")
    for task in TASKS:
        if frozen["public_task_sha256"].get(task) != directory_sha256(ROOT / "tasks" / task):
            raise SystemExit(f"frozen task hash mismatch: {task}")


def validate_json_documents(trials: list[dict]) -> int:
    paths = {
        ROOT / "harness" / "cohort.json",
        ROOT / "harness" / "task4-cohort.json",
        ROOT / "harness" / "controls.json",
        ROOT / "sample-run" / "indexes" / "trials.json",
        ROOT / "sample-run" / "indexes" / "execution-summary.json",
        ROOT / "sample-run" / "indexes" / "redaction-manifest.json",
        ROOT / "sample-run" / "metrics" / "per-trial-metrics.json",
        ROOT / "sample-run" / "metrics" / "summary.json",
    }
    paths.update((ROOT / "sample-run" / "manifests").glob("*.json"))
    for trial in trials:
        trial_dir = ROOT / trial["trial_dir"]
        candidates = {
            trial_dir / "result.json",
            trial_dir / "config.json",
            trial_dir / "lock.json",
            trial_dir / "agent" / "mini-swe-agent.trajectory.json",
            trial_dir / "agent" / "trajectory.json",
            ROOT / trial["verifier"],
        }
        paths.update(path for path in candidates if path.is_file())
    for path in sorted(paths):
        load_json(path)
    return len(paths)


def validate_privacy() -> int:
    checked = 0
    forbidden_files = (
        ROOT / ".env",
        ROOT / "DOCTRINE.md",
        ROOT / "harness" / "normalize_publication.py",
        ROOT / "sample-run" / "raw",
        ROOT / "sample-run" / "manifests" / "normalization-report.json",
    )
    for path in forbidden_files:
        if path.exists():
            raise SystemExit(f"internal-only file is present: {path.relative_to(ROOT)}")
    if any(ROOT.rglob("__pycache__")):
        raise SystemExit("Python cache directory is present")

    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or ".git" in path.parts:
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        if REAL_AWS_KEY.search(text):
            raise SystemExit(f"AWS-key-shaped value in {path.relative_to(ROOT)}")
        if TOKEN_PREFIX.search(text):
            raise SystemExit(f"provider-token-shaped value in {path.relative_to(ROOT)}")
        if PRIVATE_KEY.search(text):
            raise SystemExit(f"private key in {path.relative_to(ROOT)}")
        if path not in PATTERN_DEFINITIONS:
            if LOCAL_HOME.search(text):
                raise SystemExit(f"local home path in {path.relative_to(ROOT)}")
            lowered = text.lower()
            for term in SOURCE_TERMS:
                if term.lower() in lowered:
                    raise SystemExit(
                        f"source-only identifier in {path.relative_to(ROOT)}"
                    )
            for pattern in SOURCE_PATTERNS:
                if pattern.search(text):
                    raise SystemExit(
                        f"source-only identifier in {path.relative_to(ROOT)}"
                    )
        checked += 1
    return checked


def main() -> None:
    for task in TASKS:
        first_line = (ROOT / "tasks" / task / "README.md").read_text().splitlines()[0]
        if first_line != EXPECTED_HEADINGS[task]:
            raise SystemExit(f"task heading mismatch: {task}")
    trials = validate_trials()
    validate_rendered_text_trajectories()
    validate_metrics(trials)
    validate_controls()
    validate_manifests()
    json_docs = validate_json_documents(trials)
    links = validate_links()
    text_files = validate_privacy()
    summary = load_json(ROOT / "sample-run" / "indexes" / "execution-summary.json")
    if summary.get("scored_valid_trials") != 8 * len(EXPECTED_SOLVES):
        raise SystemExit("execution summary trial count mismatch")
    pending = sorted(set(TASKS) - set(CONTROLLED_TASKS))
    print(
        "publication validation passed: "
        f"tasks={len(TASKS)} trials={8 * len(EXPECTED_SOLVES)} "
        f"controls=8 (tasks {', '.join(t[:2] for t in CONTROLLED_TASKS)}; "
        f"pending {', '.join(t[:2] for t in pending)}) "
        f"json={json_docs} links={links} text_files={text_files}"
    )


if __name__ == "__main__":
    main()
