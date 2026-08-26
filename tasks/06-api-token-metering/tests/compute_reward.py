#!/usr/bin/env python3
"""Work out the reward from the state of the store, and from nothing else.

Runs as root, imports nothing from the deliverable, and never consults an exit
code, a log line or anything the driver reported. Every rule below is decided by
reading the rows the emulator holds after the graded run and comparing them with
what the run spec says the traffic was. The driver's output file is copied next
to the reward as evidence and is not read here.

The reward is binary: 1.0 when every rule passes, 0.0 otherwise. There is no
arithmetic over the rules and they carry no weights, because partial credit would
change what is being measured -- a submission that meters every call but
double-counts a redelivery has got the one thing wrong that this task exists to
ask about, and it should not collect most of the reward for the parts that were
never in question.

The per-rule detail is kept, and is worth keeping: naming which rule a candidate
missed is what makes a run reviewable. It goes to report.txt and report.json
beside the reward, where it informs a reader without contributing to the score.

The zero is written before any check runs, so an unexpected exit anywhere leaves a
zero behind rather than a missing file, and it is overwritten only on complete
success.
"""

from __future__ import annotations

import argparse
import json
import pathlib
from datetime import datetime, timezone

TOKEN_MEASUREMENT = "tokenConsumer"
USAGE_MEASUREMENT = "usageMeasurement"
# The platform meters its own two accounts under a dimension each, and which of
# the pair a call belongs under follows the account of the customer it is billed
# to. Held here as a mapping rather than as one constant, because the held-out
# traffic covers both and a reading that always answers production is wrong on
# the sandbox customer.
DIMENSION_FOR_ACCOUNT = {
    "meteringco-production": "697f07d0-3180-4351-bdff-7ca029e6c18d",
    "meteringco-sandbox": "00abdf4f-f975-41c6-8293-76ba09a5cb23",
}

# One millisecond. The traffic is specified to the millisecond and the store
# keeps nanoseconds, so a placement is correct if it lands within the
# millisecond it was given.
TOLERANCE_NS = 1_000_000

# Roll-up totals are sums of binary floats, and which order a submission happens
# to add them in is not something this task has an opinion about. The smallest
# difference any rule needs to see is one call's worth, a million times this, so
# comparing to a nanounit costs no discrimination and stops a correct total being
# failed for arriving as 0.007999999999999999.
AMOUNT_TOLERANCE = 1e-9

RULES = [
    ("registration_shape", "each API call becomes one registration in the aggregate bucket"),
    ("identity_in_series_key", "calls sharing an instant stay apart by identity"),
    ("call_time_placement", "a registration sits at the time of the call, not the time it was recorded"),
    ("redelivery_idempotent", "a redelivered call leaves one registration, whichever batch it arrives in"),
    ("windowed_rollup", "each window produces one billable roll-up worth the window's traffic"),
    ("platform_account", "the roll-up is billed to the platform's own account for that customer"),
    ("request_path_meters", "serving a measurement meters the call that asked for it"),
]


def to_ns(value: str) -> int:
    text = value.replace("Z", "+00:00")
    return int(datetime.fromisoformat(text).timestamp() * 1_000_000_000)


def untag(value: object) -> str:
    """Metadata tag values are written JSON-encoded, so a string arrives quoted."""
    text = str(value)
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def write_reward(output_dir: pathlib.Path, reward: float, detail: dict) -> None:
    """The reward, and only the reward. Rule detail belongs in the report."""
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {"reward": float(reward), "score": float(reward), **detail}
    (output_dir / "reward.json").write_text(json.dumps(payload, indent=2) + "\n")
    (output_dir / "reward.txt").write_text(f"{float(reward)}\n")


def write_failure_report(output_dir: pathlib.Path, reason: str) -> None:
    """So that report.txt exists whatever happened, and says why if nothing was graded."""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(
        json.dumps({"reward": 0.0, "status": "harness_failure", "reason": reason, "rules": []}, indent=2) + "\n"
    )
    (output_dir / "report.txt").write_text(
        f"reward 0.0\nnothing was graded: {reason}\n\nNo rule was evaluated, so this is not a verdict on the submission.\n"
    )


def write_report(output_dir: pathlib.Path, reward: float, rules: list[dict], reached: dict) -> None:
    """Diagnostics for a reviewer. Nothing here is arithmetic on the score."""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(
        json.dumps({"reward": float(reward), "reached": reached, "rules": rules}, indent=2) + "\n"
    )
    failed = [rule["name"] for rule in rules if not rule["passed"]]
    lines = [
        f"reward {float(reward)}",
        "every rule passed" if not failed else f"failed: {', '.join(failed)}",
        "",
    ]
    for rule in rules:
        lines.append(f"[{'pass' if rule['passed'] else 'FAIL'}] {rule['name']}")
        lines.append(f"        {rule['description']}")
        for problem in rule.get("problems", []):
            lines.append(f"        - {problem}")
    lines += [
        "",
        f"registrations written: {reached['registrations_written']}",
        f"billable roll-up produced: {reached['billable_rollup_produced']}",
        "",
    ]
    (output_dir / "report.txt").write_text("\n".join(lines))


def grade() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--fail")
    parser.add_argument("--spec")
    parser.add_argument("--snapshot")
    parser.add_argument("--base")
    parser.add_argument("--require-marker")
    args = parser.parse_args()

    output_dir = pathlib.Path(args.output_dir)
    # Fail closed, and fail closed as something that is not a verdict. If this
    # process is killed before it decides a single rule, what it leaves behind
    # must not read like the genuine zero handed to a pipeline that metered
    # nothing. It is overwritten by a real status either way.
    write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": "the scorer did not run to completion"})

    if args.fail:
        write_failure_report(output_dir, args.fail)
        write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": args.fail})
        print(f"reward 0.0 ({args.fail})")
        return

    for name in ("spec", "snapshot", "base"):
        if not getattr(args, name):
            write_failure_report(output_dir, f"missing --{name}")
            write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": f"missing --{name}"})
            return

    try:
        spec = json.loads(pathlib.Path(args.spec).read_text())
    except Exception as exc:  # noqa: BLE001
        write_failure_report(output_dir, f"unreadable run spec: {exc}")
        write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": f"unreadable run spec: {exc}"})
        return

    try:
        snapshot = json.loads(pathlib.Path(args.snapshot).read_text())
        buckets = snapshot["influx"]["buckets"]
    except Exception as exc:  # noqa: BLE001
        write_failure_report(output_dir, f"the store held no readable state: {exc}")
        write_reward(
            output_dir,
            0.0,
            {"status": "harness_failure", "reason": f"the store held no readable state: {exc}"},
        )
        print("reward 0.0 (harness failure: no readable store state)")
        return

    # Refuse to grade a store that cannot be shown to be the one this run seeded.
    # A snapshot missing the run's marker means the endpoint was replaced or
    # restarted underneath the run, and a snapshot missing the held-out account's
    # own customer records means it is somebody else's world. Either way the row
    # counts below would be meaningless, and a meaningless row count here looks
    # exactly like the double-counting the rules are built to catch. This is a
    # harness failure, never a score.
    def refuse(reason: str) -> None:
        write_failure_report(output_dir, reason)
        write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": reason})
        print(f"reward 0.0 (harness failure: {reason})")

    if args.require_marker:
        markers = [
            row
            for row in buckets.get("verifier-marker", [])
            if row.get("measurement") == "runMarker" and row["tags"].get("run") == args.require_marker
        ]
        if not markers:
            refuse("the store read back does not carry this run's marker")
            return

    spec_customers = {spec["platformCustomer"], spec["otherPlatformCustomer"]}
    seeded_customers = {row["tags"].get("customerId") for row in buckets.get("prod-config", [])}
    if not spec_customers.issubset(seeded_customers):
        refuse("the store read back does not hold the held-out account's own customer records")
        return

    base_ns = to_ns(args.base)
    amount = float(spec["amount"])
    pc = spec["platformCustomer"]
    oc = spec["otherPlatformCustomer"]
    pb = spec["platformBusiness"]
    ob = spec["otherPlatformBusiness"]
    account_of = {pc: pb, oc: ob}
    calls = spec["calls"]

    aggregate_rows = [r for r in buckets.get(spec["aggregateBucket"], []) if r["measurement"] == TOKEN_MEASUREMENT]
    usage_rows = [r for r in buckets.get(spec["usageBucket"], []) if r["measurement"] == USAGE_MEASUREMENT]

    def offset_of(label: str) -> float:
        for step in spec["steps"]:
            if step["label"] == label:
                return float(step["atOffset"])
        raise KeyError(label)

    # What the traffic was, taken from the spec rather than from the run: which
    # identity belongs to which platform customer, and when its call happened.
    expected: dict[str, dict] = {}
    for step in spec["steps"]:
        if step["op"] != "register":
            continue
        key = step["call"]
        customer = oc if step.get("customer") == "other" else pc
        want_ns = base_ns + int(float(step["atOffset"]) * 1_000_000_000)
        if key in expected:
            # A redelivery. Same identity, same call time: the same row.
            continue
        expected[key] = {
            "uuid": calls[key],
            "customer": customer,
            "account": account_of[customer],
            "dimension": DIMENSION_FOR_ACCOUNT[account_of[customer]],
            "time_ns": want_ns,
        }

    by_uuid: dict[str, list[dict]] = {}
    for row in aggregate_rows:
        uuid = untag(row["tags"].get("metadata_uuid", ""))
        if uuid:
            by_uuid.setdefault(uuid, []).append(row)

    results: dict[str, dict] = {}

    # --- registration shape -------------------------------------------------
    shape_problems: list[str] = []
    for key, want in expected.items():
        rows = by_uuid.get(want["uuid"], [])
        if not rows:
            shape_problems.append(f"{key}: no registration carries its identity")
            continue
        row = rows[0]
        tags = row["tags"]
        if tags.get("customerId") != want["customer"]:
            shape_problems.append(f"{key}: billed to {tags.get('customerId')!r}, not {want['customer']!r}")
        if tags.get("businessID") != want["account"]:
            shape_problems.append(f"{key}: account {tags.get('businessID')!r}, not {want['account']!r}")
        if tags.get("dimensionId") != want["dimension"]:
            shape_problems.append(
                f"{key}: dimension {tags.get('dimensionId')!r} is not the one for {want['account']!r}"
            )
        if abs(float(row["fields"].get("recordValue", -1)) - amount) > 1e-9:
            shape_problems.append(f"{key}: recorded {row['fields'].get('recordValue')!r}, not {amount}")
    results["registration_shape"] = {"passed": not shape_problems, "problems": shape_problems[:12]}

    # --- identity keeps same-instant calls apart ----------------------------
    # Two calls were handed over inside the same millisecond, so nothing but the
    # identity each carries can hold them apart. Where they ended up on the
    # clock is a separate question, graded below, so it is not asked here.
    twin_uuids = [calls["T1"], calls["T2"]]
    twin_counts = [len(by_uuid.get(u, [])) for u in twin_uuids]
    identity_ok = twin_counts == [1, 1]
    results["identity_in_series_key"] = {
        "passed": identity_ok,
        "problems": []
        if identity_ok
        else [
            "two calls handed over inside one millisecond did not survive as two registrations; "
            f"found {twin_counts[0]} and {twin_counts[1]} carrying their identities"
        ],
    }

    # --- call time, not recording time -------------------------------------
    placement_problems: list[str] = []
    for key, want in expected.items():
        rows = by_uuid.get(want["uuid"], [])
        if not rows:
            placement_problems.append(f"{key}: nothing to place")
            continue
        drift_ns = min(abs(int(r["time_ns"]) - want["time_ns"]) for r in rows)
        if drift_ns > TOLERANCE_NS:
            placement_problems.append(f"{key}: sits {drift_ns / 1e9:.1f}s from when the call happened")
    results["call_time_placement"] = {"passed": not placement_problems, "problems": placement_problems[:12]}

    # --- a redelivery is one registration ----------------------------------
    # Count only. Where the surviving registration sits on the clock is asked by
    # call_time_placement above, and asking it twice would mean a candidate that
    # is wrong about one thing is reported as wrong about two.
    redelivered = [step["call"] for step in spec["steps"] if step["label"].startswith("p2.redeliver-")]
    dup_problems: list[str] = []
    for key in redelivered:
        rows = by_uuid.get(calls[key], [])
        if len(rows) != 1:
            dup_problems.append(f"{key}: redelivery left {len(rows)} registrations, not 1")
    results["redelivery_idempotent"] = {"passed": not dup_problems, "problems": dup_problems[:12]}

    # --- one roll-up per window, worth the window's traffic -----------------
    # The correct total for each window is worked out here from the traffic and
    # the window bounds in the spec, not read from anything the run produced.
    # A window is closed for one of the platform's customers at a time, so what
    # each is worth is worked out per customer.
    windows = [s for s in spec["steps"] if s["op"] == "aggregate"]
    expected_totals: dict[str, list[float]] = {pc: [], oc: []}
    for window in windows:
        who = oc if window.get("tenant") == "other" else pc
        start_ns = base_ns + int(float(window["startOffset"]) * 1_000_000_000)
        stop_ns = base_ns + int(float(window["endOffset"]) * 1_000_000_000)
        # Only traffic already delivered by the time this window closed counts.
        delivered: set[str] = set()
        for step in spec["steps"]:
            if step["label"] == window["label"]:
                break
            if step["op"] == "register":
                delivered.add(step["call"])
        total = sum(
            amount
            for key in delivered
            if expected[key]["customer"] == who and start_ns <= expected[key]["time_ns"] < stop_ns
        )
        expected_totals[who].append(round(total, 9))

    platform_rollups = [r for r in usage_rows if r["tags"].get("customerId") in account_of]
    observed_totals: dict[str, list[float]] = {pc: [], oc: []}
    for row in platform_rollups:
        observed_totals[row["tags"]["customerId"]].append(round(float(row["fields"].get("recordValue", 0)), 9))

    rollup_problems: list[str] = []
    for who in (pc, oc):
        want = sorted(expected_totals[who])
        got = sorted(observed_totals[who])
        matches = len(got) == len(want) and all(
            abs(g - w) <= AMOUNT_TOLERANCE for g, w in zip(got, want)
        )
        if not matches:
            rollup_problems.append(f"billed {got} for {who}, the windows are worth {want}")
    results["windowed_rollup"] = {
        "passed": not rollup_problems,
        "expected_window_totals": {k: sorted(v) for k, v in expected_totals.items()},
        "observed_rollups": {k: sorted(v) for k, v in observed_totals.items()},
        "problems": rollup_problems,
    }

    # --- the roll-up is the platform's own usage, on the right account -------
    # Which of the platform's accounts depends on the customer being rolled up:
    # one of the two held-out customers belongs to the sandbox account and the
    # other to production, so a pipeline that answers with a constant is wrong
    # about one of them whichever constant it picks.
    account_problems: list[str] = []
    for who in (pc, oc):
        rows = [r for r in platform_rollups if r["tags"].get("customerId") == who]
        if not rows:
            account_problems.append(f"no billable row is attributed to {who}")
            continue
        want_account = account_of[who]
        want_dimension = DIMENSION_FOR_ACCOUNT[want_account]
        for row in rows:
            if row["tags"].get("businessID") != want_account:
                account_problems.append(
                    f"{who}: roll-up account {row['tags'].get('businessID')!r}, not {want_account!r}"
                )
            if row["tags"].get("dimensionId") != want_dimension:
                account_problems.append(
                    f"{who}: roll-up dimension {row['tags'].get('dimensionId')!r} is not {want_account}'s"
                )
    results["platform_account"] = {"passed": not account_problems, "problems": account_problems[:6]}

    # --- serving a measurement meters the call ------------------------------
    graded_uuids = {want["uuid"] for want in expected.values()}
    incidental = [
        r
        for r in aggregate_rows
        if r["tags"].get("customerId") == pc
        and untag(r["tags"].get("metadata_uuid", "")) not in graded_uuids
        and int(r["time_ns"]) > base_ns - 24 * 3600 * 1_000_000_000
    ]
    results["request_path_meters"] = {
        "passed": bool(incidental),
        "problems": [] if incidental else ["serving a measurement registered no API call of its own"],
    }

    rules = [
        {
            "name": name,
            "description": description,
            "passed": bool(results[name]["passed"]),
            **{k: v for k, v in results[name].items() if k != "passed"},
        }
        for name, description in RULES
    ]
    wrote_registrations = any(int(r["time_ns"]) > base_ns - 24 * 3600 * 1_000_000_000 for r in aggregate_rows)
    reached = {
        "registrations_written": wrote_registrations,
        "billable_rollup_produced": bool(platform_rollups),
    }

    # Binary. Every rule is a condition on the same capability, so missing any one
    # of them means the capability is not delivered.
    failed = [rule["name"] for rule in rules if not rule["passed"]]
    reward = 0.0 if failed else 1.0

    # The report is written first so that the reward file, once it says 1.0, is
    # never the only thing a reviewer has to go on.
    write_report(output_dir, reward, rules, reached)
    write_reward(output_dir, reward, {"status": "scored"})

    print(f"reward {reward}")
    for rule in rules:
        mark = "pass" if rule["passed"] else "FAIL"
        print(f"  [{mark}] {rule['name']} - {rule['description']}")
        for problem in rule.get("problems", [])[:4]:
            print(f"          {problem}")


def main() -> None:
    """Grade, and never let an unexpected exception read as a verdict.

    Every rule below decides its answer by comparing values, so a submission that
    is merely wrong cannot get here. What can is a store row the rules cannot be
    applied to at all -- a recordValue written as a quoted string, say. That is a
    submission this harness could not judge rather than one it judged and failed,
    and the two must not look the same: a bare zero here is indistinguishable from
    the genuine zero handed to a submission that metered nothing.
    """
    try:
        grade()
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001
        known = argparse.ArgumentParser()
        known.add_argument("--output-dir")
        args, _ = known.parse_known_args()
        if not args.output_dir:
            raise
        reason = f"the rules could not be applied to the store that was read back: {exc!r}"
        output_dir = pathlib.Path(args.output_dir)
        write_failure_report(output_dir, reason)
        write_reward(output_dir, 0.0, {"status": "harness_failure", "reason": reason})
        print(f"reward 0.0 (harness failure: {reason})")


if __name__ == "__main__":
    main()
