#!/usr/bin/env python3
"""Trusted scorer. Runs as root, loads no submitted code.

It decides for itself which of the intake calls the driver made could have been
turned into a usage record -- parsing the message and applying the measurement
constraints the project's own DTO declares -- and therefore which of them had to
leave a record behind in the dead-letter store. It then compares that against
the objects root read off the emulator after the submission had finished with
it, and against what the caller of each endpoint was told.

The submission never sees this file, the held-out world, or the derived answers.

Reward is binary: every check passes, or the run is worth nothing.
"""

# TEST_CASE_COVERAGE_START
# CASE loads-arclight: accepts a valid datastore message and writes no dead-letter object.
# CASE loads-westmoor: accepts a second valid message including metadata and writes no dead letter.
# CASE truncated-payload: rejects malformed JSON and preserves the original bytes and failure reason.
# CASE truncated-payload-redelivered: records a second failure for the same source without overwriting.
# CASE timestamp-not-rfc3339: rejects a parsed record whose timestamp violates the visible DTO.
# CASE customer-absent: rejects a parsed record missing its customer identifier.
# CASE value-not-a-number-string: rejects a parsed record whose measurement value is invalid.
# CASE no-source-file: preserves a rejected message in the orphan namespace when no key was supplied.
# CASE blank-source-file: treats a blank source as absent and preserves the rejected message.
# CASE kafka-intake-failure: keeps the separate Kafka intake rejection path out of the new DB DLQ.
# CASE dead-letter-store-refuses: still returns the original bad request when the DLQ write fails.
# TEST_CASE_COVERAGE_END

from __future__ import annotations

import argparse
import json
import os
import re

# Mirrors `CreateStandardMeasurementDto`: `@IsRFC3339()` on the timestamp,
# `@IsNotEmpty() @IsString()` on the customer and dimension, `@IsNumberString()`
# on the value, and an optional object of metadata.
RFC3339 = re.compile(
    r"^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$"
)
NUMBER_STRING = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
ORPHAN_PREFIX = "meteringco-unknown/"


# ---------------------------------------------------------------------------
# reference model
# ---------------------------------------------------------------------------


def non_empty_string(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ""


def measurement_is_valid(parsed: object) -> bool:
    if not isinstance(parsed, dict):
        return False
    timestamp = parsed.get("timestamp")
    if not non_empty_string(timestamp) or not RFC3339.match(timestamp):
        return False
    if not non_empty_string(parsed.get("customerId")):
        return False
    if not non_empty_string(parsed.get("dimensionId")):
        return False
    value = parsed.get("recordValue")
    if not isinstance(value, str) or not NUMBER_STRING.match(value.strip()) or value.strip() == "":
        return False
    metadata = parsed.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        return False
    return True


def intake_loads(body: dict) -> bool:
    """True when the datastore intake can turn this request into a usage record."""
    source_key = body.get("s3Key")
    if not isinstance(source_key, str) or source_key == "":
        return False
    message = body.get("message")
    if not isinstance(message, str):
        return False
    try:
        parsed = json.loads(message)
    except (ValueError, TypeError):
        return False
    return measurement_is_valid(parsed)


def source_key_of(body: dict) -> str | None:
    """The source object this request names, or None when it names none."""
    source_key = body.get("s3Key")
    if isinstance(source_key, str) and source_key != "":
        return source_key
    return None


# ---------------------------------------------------------------------------
# record inspection
# ---------------------------------------------------------------------------


def carries_a_stack(node: object) -> bool:
    if isinstance(node, dict):
        for name, value in node.items():
            if name == "stack" and isinstance(value, str) and value.strip():
                return True
            if carries_a_stack(value):
                return True
        return False
    if isinstance(node, list):
        return any(carries_a_stack(item) for item in node)
    return False


def looks_like_a_timestamp(value: object) -> bool:
    return isinstance(value, str) and bool(RFC3339.match(value))


def check_record(label: str, key: str, raw_body: str, case_body: dict, failures: list[str]) -> None:
    """Every requirement a single dead-letter object has to meet."""
    try:
        document = json.loads(raw_body)
    except (ValueError, TypeError):
        failures.append(f"{label}: the record at {key} is not readable as JSON")
        return
    if not isinstance(document, dict):
        failures.append(f"{label}: the record at {key} is not an object")
        return

    failed_document = document.get("failedDocument")
    metadata = document.get("metadata")
    if not isinstance(failed_document, dict):
        failures.append(f"{label}: the record at {key} carries no failed document")
        return
    if not isinstance(metadata, dict):
        failures.append(f"{label}: the record at {key} carries no metadata")
        return

    expected_message = case_body.get("message")
    stored = failed_document.get("originalFileContent")
    if stored != expected_message:
        failures.append(
            f"{label}: the record at {key} does not hold the message as it arrived "
            f"(stored {stored!r})"
        )

    source_key = source_key_of(case_body)
    stored_key = failed_document.get("s3Key")
    if source_key is not None:
        if stored_key != source_key:
            failures.append(
                f"{label}: the record at {key} names source {stored_key!r}, expected {source_key!r}"
            )
    elif stored_key not in (None, ""):
        failures.append(f"{label}: the record at {key} invents a source file {stored_key!r}")

    name = metadata.get("orginalProcessedName")
    if not non_empty_string(name):
        failures.append(f"{label}: the record at {key} does not say what it was filed under")
    else:
        if not key.startswith(name) or key == name:
            failures.append(
                f"{label}: the record at {key} is filed away from the name it declares ({name!r})"
            )
        if source_key is not None and name != source_key:
            failures.append(
                f"{label}: the record at {key} was filed as {name!r}, expected {source_key!r}"
            )
        if source_key is None and not name.startswith(ORPHAN_PREFIX):
            failures.append(
                f"{label}: a message with no source file was filed as {name!r}, "
                f"which is not where unattributable failures go"
            )

    if not non_empty_string(metadata.get("results")):
        failures.append(f"{label}: the record at {key} does not say what happened to the message")
    if not looks_like_a_timestamp(metadata.get("timestamp")):
        failures.append(f"{label}: the record at {key} carries no usable timestamp")
    error_info = metadata.get("errorInfo")
    if error_info in (None, "", {}, []):
        failures.append(f"{label}: the record at {key} does not say why the message failed")
    if carries_a_stack(document):
        failures.append(f"{label}: the record at {key} keeps a stack trace")


def rejected(observed: dict, label: str, failures: list[str]) -> None:
    entry = observed.get(label)
    if not isinstance(entry, dict):
        failures.append(f"{label}: the intake was never exercised")
        return
    if not entry.get("threw"):
        failures.append(f"{label}: the intake accepted a message it cannot load")
        return
    error = entry.get("error") or {}
    status = error.get("status")
    name = f"{error.get('name') or ''} {error.get('className') or ''}"
    if status != 400 and "BadRequest" not in name:
        failures.append(
            f"{label}: the caller was told {name.strip() or 'nothing recognisable'}"
            f" (status {status}) instead of that the message was rejected"
        )


# ---------------------------------------------------------------------------
# grading
# ---------------------------------------------------------------------------


def grade_main(phase: dict, result: dict, failures: list[str]) -> None:
    observed = result.get("observed") or {}
    if observed.get("fatal"):
        failures.append(f"main: the driver aborted: {str(observed['fatal'])[:400]}")
        return
    cases = observed.get("cases") or {}
    store = result.get("dlq") or {}
    if store.get("missing"):
        failures.append("main: the dead-letter store was not reachable when the run finished")
        return
    objects: dict[str, str] = store.get("objects") or {}

    keyed: dict[str, list[dict]] = {}
    orphans: list[dict] = []

    for entry in phase["cases"]:
        label = entry["label"]
        body = entry["body"]
        if entry["endpoint"] == "datastore":
            # A different intake with a dead-letter arrangement of its own.
            rejected(cases, label, failures)
            continue
        if intake_loads(body):
            record = cases.get(label)
            if not isinstance(record, dict):
                failures.append(f"{label}: the intake was never exercised")
            elif record.get("threw"):
                error = record.get("error") or {}
                failures.append(
                    f"{label}: a message that loads was rejected ({error.get('message')!r})"
                )
            continue
        rejected(cases, label, failures)
        source_key = source_key_of(body)
        if source_key is None:
            orphans.append(entry)
        else:
            keyed.setdefault(source_key, []).append(entry)

    unclaimed = dict(objects)

    for source_key, entries in sorted(keyed.items()):
        matched = sorted(
            key for key in unclaimed if key.startswith(source_key) and key != source_key
        )
        label = "/".join(entry["label"] for entry in entries)
        if len(matched) != len(entries):
            failures.append(
                f"{label}: {len(entries)} failure(s) of {source_key} left {len(matched)} record(s) "
                f"behind ({matched})"
            )
        for key in matched:
            if not key.endswith(".json"):
                failures.append(f"{label}: the record at {key} is not filed as a json document")
            check_record(label, key, unclaimed.pop(key), entries[0]["body"], failures)

    orphan_keys = sorted(key for key in unclaimed if key.startswith(ORPHAN_PREFIX))
    if len(orphan_keys) != len(orphans):
        failures.append(
            f"messages with no source file left {len(orphan_keys)} record(s) behind, "
            f"expected {len(orphans)} ({orphan_keys})"
        )
    unmatched_orphans = list(orphans)
    for key in orphan_keys:
        raw = unclaimed.pop(key)
        try:
            content = (json.loads(raw).get("failedDocument") or {}).get("originalFileContent")
        except (ValueError, TypeError, AttributeError):
            content = None
        entry = next(
            (item for item in unmatched_orphans if item["body"].get("message") == content),
            None,
        )
        if entry is None:
            failures.append(f"the record at {key} holds a message no failing call sent")
            continue
        unmatched_orphans.remove(entry)
        if not key.endswith(".json"):
            failures.append(f"{entry['label']}: the record at {key} is not filed as a json document")
        check_record(entry["label"], key, raw, entry["body"], failures)
    for entry in unmatched_orphans:
        failures.append(f"{entry['label']}: no record of this failure reached the dead-letter store")

    for key in sorted(unclaimed):
        failures.append(f"the dead-letter store holds {key}, which no failing call accounts for")


def grade_degraded(phase: dict, result: dict, failures: list[str]) -> None:
    observed = result.get("observed") or {}
    if observed.get("fatal"):
        failures.append(f"degraded: the driver aborted: {str(observed['fatal'])[:400]}")
        return
    cases = observed.get("cases") or {}
    for entry in phase["cases"]:
        rejected(cases, entry["label"], failures)


def grade(spec: dict, results: dict) -> tuple[bool, list[str]]:
    failures: list[str] = []
    for phase in spec["phases"]:
        result = results.get(phase["label"])
        if not isinstance(result, dict):
            failures.append(f"{phase['label']}: nothing was recorded for this phase")
            continue
        if phase["label"] == "degraded":
            grade_degraded(phase, result, failures)
        else:
            grade_main(phase, result, failures)
    return not failures, failures


# ---------------------------------------------------------------------------


def emit(output_dir: str, reward: float, failures: list[str], note: str = "") -> None:
    os.makedirs(output_dir, exist_ok=True)
    payload = {"reward": reward, "score": reward}
    with open(os.path.join(output_dir, "reward.json"), "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
        handle.write("\n")
    with open(os.path.join(output_dir, "reward.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"{reward}\n")
    with open(os.path.join(output_dir, "report.txt"), "w", encoding="utf-8") as handle:
        if note:
            handle.write(f"{note}\n")
        for line in failures:
            handle.write(f"{line}\n")
        handle.write(f"reward={reward}\n")
    print(f"reward={reward}")
    for line in failures[:40]:
        print(f"  - {line}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--fail")
    parser.add_argument("--spec")
    parser.add_argument("--results")
    args = parser.parse_args()

    if args.fail:
        emit(args.output_dir, 0.0, [args.fail], note="harness precondition not met")
        return

    for label, path in (("spec", args.spec), ("results", args.results)):
        if not path or not os.path.exists(path):
            emit(args.output_dir, 0.0, [f"{label} file is missing"], note="nothing to score")
            return

    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)
    try:
        with open(args.results, encoding="utf-8") as handle:
            results = json.load(handle)
    except json.JSONDecodeError:
        emit(args.output_dir, 0.0, ["the run produced no readable output"], note="nothing to score")
        return

    try:
        passed, failures = grade(spec, results)
    except Exception as error:  # a wrong answer must score zero, never crash the run
        emit(args.output_dir, 0.0, [f"the submission could not be scored: {error!r}"])
        return
    emit(args.output_dir, 1.0 if passed else 0.0, failures)


if __name__ == "__main__":
    main()
