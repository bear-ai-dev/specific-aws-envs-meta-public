#!/usr/bin/env python3
"""Binary scorer for the network egress meter.

Runs as root. Imports nothing from the deliverable, executes none of it, and
reads only the held-out estate document plus the rows the driver observed being
published. The correct answer is re-derived here from the estate, so a
submission is scored against the document rather than against itself.

Reward is 1.0 or 0.0 and is written fail-closed: the zero lands first and is
overwritten only when every run matches.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# An observation counts towards a run when it is settled: old enough that the
# metric has certainly landed, recent enough to belong to this run rather than
# to history. Offsets are seconds from the estate's five-minute anchor.
SETTLED_FROM = -3600.0
SETTLED_UNTIL = -300.0
# Nothing in either estate is allowed to sit near those edges, so that the exact
# collection window a submission chooses cannot change the right answer. If a
# regenerated document ever violates that, scoring stops rather than guessing.
GUARD_FROM = -3600.0
GUARD_UNTIL = -360.0

EGRESS_METRIC = "NetworkOut"
NAMESPACE = "AWS/EC2"
DIMENSION_TAG = "meteringcoDimensionId"
CUSTOMER_TAG = "meteringcoCustomerId"

TOLERANCE_ABS = 1e-6
TOLERANCE_REL = 1e-9


class EstateProblem(Exception):
    """The document cannot support an unambiguous answer."""


def metered_account(estate: dict) -> dict:
    """The account whose machines are metered: the one holding a role."""
    for account in estate.get("accounts", []):
        if account.get("roles"):
            return account
    raise EstateProblem("no account in the estate carries an assumable role")


def _settled_total(series: dict) -> float | None:
    """Total of the settled observations, or None when there are none.

    None and 0.0 are different answers and the difference is the point: a series
    with no settled observation says nothing about the machine's traffic, while
    a series whose settled observations are zero says the machine sent nothing.
    """
    points = series.get("points_from_anchor")
    if points is None:
        raise EstateProblem(f"series {series.get('metric_name')} declares no relative observations")
    total = 0.0
    counted = 0
    for offset, value in points:
        offset = float(offset)
        if GUARD_FROM < offset < GUARD_UNTIL or SETTLED_UNTIL <= offset <= 0.0:
            raise EstateProblem(
                f"an observation at offset {offset} sits where the collection window is ambiguous"
            )
        if SETTLED_FROM < offset < SETTLED_UNTIL:
            total += float(value)
            counted += 1
    return total if counted else None


def expected_rows(estate: dict, dimension_id: str) -> list[dict]:
    """The usage rows a correct run publishes, one per billed customer.

    Every machine tagged for this dimension and naming a customer is in scope,
    whatever its power state. Its contribution is the total of its settled
    transmitted-byte observations. A machine with no settled observation
    contributes nothing at all, so a customer with no contributing machine gets
    no row rather than a row of zero.
    """
    account = metered_account(estate)
    series_by_instance: dict[str, dict] = {}
    for series in account.get("metrics", []):
        if series.get("namespace") != NAMESPACE or series.get("metric_name") != EGRESS_METRIC:
            continue
        instance_id = series.get("dimensions", {}).get("InstanceId")
        if instance_id:
            series_by_instance[instance_id] = series

    totals: dict[str, float] = {}
    for instance in account.get("instances", []):
        tags = instance.get("tags", {})
        declared = tags.get(DIMENSION_TAG)
        customer = tags.get(CUSTOMER_TAG)
        if not declared or not customer:
            continue
        if dimension_id not in [piece.strip() for piece in declared.split(",")]:
            continue
        series = series_by_instance.get(instance["instance_id"])
        if series is None:
            continue
        contribution = _settled_total(series)
        if contribution is None:
            continue
        totals[customer] = totals.get(customer, 0.0) + contribution

    return [
        {"customerId": customer, "dimensionId": dimension_id, "recordValue": totals[customer]}
        for customer in sorted(totals)
    ]


def close_enough(observed: float, expected: float) -> bool:
    return abs(observed - expected) <= max(TOLERANCE_ABS, abs(expected) * TOLERANCE_REL)


def score_run(expected: list[dict], observed_run: dict) -> tuple[bool, list[str]]:
    notes: list[str] = []
    if not isinstance(observed_run, dict) or not observed_run.get("ok"):
        reason = (observed_run or {}).get("error") if isinstance(observed_run, dict) else "no observation"
        return False, [f"the run produced nothing: {reason}"]

    rows = observed_run.get("rows")
    if not isinstance(rows, list):
        return False, ["the run reported no rows"]

    seen: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict):
            notes.append(f"a published row is not an object: {row!r}")
            return False, notes
        customer = row.get("customerId")
        if not isinstance(customer, str) or not customer:
            notes.append(f"a published row names no customer: {row!r}")
            return False, notes
        try:
            value = float(row.get("recordValue"))
        except (TypeError, ValueError):
            notes.append(f"row for {customer} carries no usable figure: {row.get('recordValue')!r}")
            return False, notes
        if value != value:  # NaN
            notes.append(f"row for {customer} carries a figure that is not a number")
            return False, notes
        if customer in seen:
            notes.append(f"{customer} was billed twice in one run")
            return False, notes
        seen[customer] = value

    wanted = {row["customerId"]: float(row["recordValue"]) for row in expected}
    dimension = expected[0]["dimensionId"] if expected else None

    extra = sorted(set(seen) - set(wanted))
    missing = sorted(set(wanted) - set(seen))
    if extra:
        notes.append(f"billed customers that owe nothing on this dimension: {extra}")
    if missing:
        notes.append(f"customers that were not billed: {missing}")
    if extra or missing:
        return False, notes

    ok = True
    for customer in sorted(wanted):
        if not close_enough(seen[customer], wanted[customer]):
            notes.append(f"{customer}: expected {wanted[customer]!r}, observed {seen[customer]!r}")
            ok = False

    # The row has to be filed against the dimension the run was for, not against
    # whatever the machine's tag happened to say.
    if dimension is not None:
        for row in rows:
            if row.get("dimensionId") not in (None, dimension):
                notes.append(f"a row was filed against {row.get('dimensionId')!r} rather than {dimension!r}")
                ok = False
                break

    return ok, notes


def write_result(output_dir: Path, reward: float, detail: dict, harness_failure: str | None = None) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    payload: dict = {"reward": reward, "score": reward, "detail": detail}
    # A zero caused by the harness is not a zero earned by the submission, and
    # afterwards the two are indistinguishable unless one of them says so.
    if harness_failure is not None:
        payload["harness_failure"] = harness_failure
    (output_dir / "reward.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    (output_dir / "reward.txt").write_text(f"{reward}\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--scenario")
    parser.add_argument("--spec")
    parser.add_argument("--observed")
    parser.add_argument("--fail", help="record a zero with this explanation and stop")
    parser.add_argument(
        "--harness-failure",
        help="record that this run could not be measured, which is not a verdict on the submission",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)

    if args.harness_failure:
        write_result(output_dir, 0.0, {"harness_failure": args.harness_failure}, args.harness_failure)
        print(f"HARNESS FAILURE (not a score) - {args.harness_failure}")
        return 0

    if args.fail:
        write_result(output_dir, 0.0, {"failed": args.fail})
        print(f"reward 0.0 - {args.fail}")
        return 0

    # Fail closed before anything can go wrong below.
    write_result(output_dir, 0.0, {"failed": "scoring did not complete"})

    for name in ("scenario", "spec", "observed"):
        if not getattr(args, name):
            write_result(output_dir, 0.0, {"failed": f"--{name} is required"})
            print(f"reward 0.0 - --{name} is required")
            return 0

    try:
        estate = json.loads(Path(args.scenario).read_text(encoding="utf-8"))
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - an unreadable input is a zero
        write_result(output_dir, 0.0, {"failed": f"verifier data unreadable: {error}"})
        print(f"reward 0.0 - verifier data unreadable: {error}")
        return 0

    try:
        observed_doc = json.loads(Path(args.observed).read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - no output at all is a zero
        write_result(output_dir, 0.0, {"failed": f"no readable observation: {error}"})
        print(f"reward 0.0 - no readable observation: {error}")
        return 0

    runs = observed_doc.get("runs") if isinstance(observed_doc, dict) else None
    if not isinstance(runs, dict):
        write_result(output_dir, 0.0, {"failed": "the driver recorded no runs"})
        print("reward 0.0 - the driver recorded no runs")
        return 0

    detail: dict = {"runs": {}}
    all_ok = True
    for run in spec.get("runs", []):
        label = run["label"]
        try:
            expected = expected_rows(estate, run["dimensionId"])
        except EstateProblem as problem:
            write_result(output_dir, 0.0, {"failed": f"held-out estate is unusable: {problem}"})
            print(f"reward 0.0 - held-out estate is unusable: {problem}")
            return 0
        ok, notes = score_run(expected, runs.get(label, {}))
        detail["runs"][label] = {
            "ok": ok,
            "expected": expected,
            "observed": runs.get(label, {}).get("rows"),
            "notes": notes,
        }
        all_ok = all_ok and ok
        print(f"[{label}] {'ok' if ok else 'FAILED'}")
        for note in notes:
            print(f"    {note}")

    reward = 1.0 if all_ok else 0.0
    write_result(output_dir, reward, detail)
    print(f"reward {reward}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
