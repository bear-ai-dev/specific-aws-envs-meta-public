#!/usr/bin/env python3
"""Trusted scorer. Runs as root, loads no submitted code.

It re-derives, for every customer in the held-out businesses, the lines their
invoice should carry and the quantity on each -- straight from the billing
catalogue sitting in the business' bucket and the readings the metric store
published over the invoiced period -- then compares that against what the
submission assembled when the driver asked it for a run. The submission never
sees this file, the account document, or the derived answers.

Reward is binary: every check passes, or the run is worth nothing.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

UTC = timezone.utc


# ---------------------------------------------------------------------------
# the account document
# ---------------------------------------------------------------------------


def parse_moment(raw: str) -> datetime:
    text = str(raw).replace("Z", "+00:00")
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def catalogue_of(scenario: dict, bucket_name: str, key: str) -> dict:
    for account in scenario.get("accounts", []):
        for bucket in account.get("buckets", []):
            if bucket["name"] != bucket_name:
                continue
            for obj in bucket.get("objects", []):
                if obj["key"] == key:
                    return obj["body_json"]
    raise KeyError(f"{bucket_name}/{key} is not in the account document")


def published_totals(scenario: dict, namespace: str, metric_name: str, start: datetime, end: datetime) -> dict:
    """`{(businessId, customerId, dimensionId): total}` over the invoiced period.

    A reading counts when it falls inside the window, which is the same rule the
    metric store applies when it buckets a series.
    """
    totals: dict[tuple[str, str, str], float] = {}
    for account in scenario.get("accounts", []):
        for series in account.get("metrics", []):
            if series.get("namespace") != namespace or series.get("metric_name") != metric_name:
                continue
            dimensions = series.get("dimensions", {})
            key = (
                dimensions.get("BusinessId", ""),
                dimensions.get("CustomerId", ""),
                dimensions.get("DimensionId", ""),
            )
            for stamp, value in series.get("points", []):
                moment = parse_moment(stamp)
                if not (start <= moment < end):
                    continue
                totals[key] = totals.get(key, 0.0) + float(value)
    return totals


# ---------------------------------------------------------------------------
# reference model
# ---------------------------------------------------------------------------


def fixed2(value: float) -> str:
    return f"{value:.2f}"


def entitlement_of(dimension: dict):
    return dimension.get("usageEntitlement")


def has_entitlement(dimension: dict) -> bool:
    return "usageEntitlement" in dimension


def billable_total(total_usage: float, dimension: dict) -> str:
    """What the customer owes for on a dimension, in invoice units.

    Nothing is owed on an allowance that has not been used up, on an unlimited
    allowance, or on an overrun the plan does not permit; otherwise it is the
    overrun, and with no allowance at all it is the whole of the usage.
    """
    entitlement = entitlement_of(dimension)
    if entitlement is None or entitlement == 0 or entitlement == "":
        return fixed2(total_usage)
    if entitlement == "inf":
        return "0.00"
    overage = dimension.get("overageAllowed")
    overrun = total_usage - float(entitlement)
    if overrun <= 0:
        return "0.00"
    # A plan permits an overrun only by saying so. Anything else - "false", or no
    # term at all - leaves the overrun uncharged, which is also the only reading
    # under which a dimension is never charged for money it is denied a line for.
    if overage != "true":
        return "0.00"
    return fixed2(overrun)


def line_is_shown(billable: str, unit_cost: float, free_dimension_on_invoice: str) -> bool:
    """Whether the dimension earns a line on the invoice at all.

    A dimension the customer owes money on earns its line. A dimension priced at
    nothing can never owe money, so whether it is shown at all is the one thing
    the business's invoice settings decide.
    """
    if unit_cost == 0:
        return free_dimension_on_invoice != "hide"
    return float(billable) > 0


def unit_cost_of(dimension: dict) -> float:
    raw = dimension.get("consumptionPrice")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return float("nan")


def expected_run(scenario: dict, run: dict) -> dict[str, dict[str, float]]:
    """`{customerId: {dimensionId: quantity}}` for every line that belongs on an
    invoice."""
    catalogue = catalogue_of(scenario, run["catalogueBucket"], run["catalogueKey"])
    start = parse_moment(catalogue["periodStart"])
    end = parse_moment(catalogue["periodEnd"])
    totals = published_totals(scenario, catalogue["usageNamespace"], catalogue["usageMetricName"], start, end)
    free_setting = (catalogue.get("settings") or {}).get("freeDimensionOnInvoice")
    business_id = catalogue["businessID"]
    offerings = {offering["offeringId"]: offering for offering in catalogue.get("offerings", [])}

    expected: dict[str, dict[str, float]] = {}
    for enrolment in catalogue.get("enrolments", []):
        customer_id = enrolment["customerId"]
        offering = offerings.get(enrolment["offeringId"])
        if offering is None:
            continue
        lines: dict[str, float] = {}
        for dimension in offering.get("dimensions", []):
            dimension_id = dimension["dimensionId"]
            total_usage = totals.get((business_id, customer_id, dimension_id), 0.0)
            billable = billable_total(total_usage, dimension)
            if not line_is_shown(billable, unit_cost_of(dimension), free_setting):
                continue
            increment = float(dimension.get("usageIncrement", "1") or "1")
            lines[dimension_id] = float(billable) / increment
        expected[customer_id] = lines
    return expected


def dimension_names(scenario: dict, run: dict) -> dict[str, dict[str, str]]:
    """`{customerId: {dimensionId: dimensionName}}`, for matching lines back."""
    catalogue = catalogue_of(scenario, run["catalogueBucket"], run["catalogueKey"])
    offerings = {offering["offeringId"]: offering for offering in catalogue.get("offerings", [])}
    named: dict[str, dict[str, str]] = {}
    for enrolment in catalogue.get("enrolments", []):
        offering = offerings.get(enrolment["offeringId"])
        if offering is None:
            continue
        named[enrolment["customerId"]] = {
            dimension["dimensionId"]: dimension["dimensionName"]
            for dimension in offering.get("dimensions", [])
        }
    return named


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------


def close(left: float, right: float) -> bool:
    return abs(left - right) <= max(1e-6, abs(right) * 1e-6)


def match_dimension(name: str, names: dict[str, str]) -> str | None:
    """A line belongs to the dimension whose name it is built from."""
    text = str(name or "").strip()
    hits = [
        dimension_id
        for dimension_id, dimension_name in names.items()
        if text == dimension_name or text.startswith(f"{dimension_name} ")
    ]
    if len(hits) == 1:
        return hits[0]
    return None


def grade_run(scenario: dict, run: dict, actual: dict) -> list[str]:
    label = run["label"]
    failures: list[str] = []
    if actual is None:
        return [f"{label}: no result recorded"]
    if not actual.get("ok"):
        return [f"{label}: the run failed ({actual.get('error')})"]

    results = actual.get("results")
    if not isinstance(results, list):
        return [f"{label}: the collector produced no list of customers"]

    expected = expected_run(scenario, run)
    names = dimension_names(scenario, run)

    observed: dict[str, dict[str, float]] = {}
    for result in results:
        if not isinstance(result, dict):
            failures.append(f"{label}: malformed customer entry in the result")
            continue
        customer_id = result.get("customerId")
        if not isinstance(customer_id, str) or not customer_id:
            failures.append(f"{label}: a customer entry carries no customer")
            continue
        if customer_id not in names:
            failures.append(f"{label}: {customer_id} is not enrolled in this business")
            continue
        bucket = observed.setdefault(customer_id, {})
        for line in result.get("lineItems") or []:
            if not isinstance(line, dict):
                failures.append(f"{label}: {customer_id} carries a malformed line")
                continue
            dimension_id = match_dimension(line.get("name"), names[customer_id])
            if dimension_id is None:
                failures.append(f"{label}: {customer_id} carries a line for nothing: {line.get('name')!r}")
                continue
            try:
                quantity = float(line.get("quantity"))
            except (TypeError, ValueError):
                failures.append(f"{label}: {customer_id} line {dimension_id} has no usable quantity")
                continue
            if dimension_id in bucket:
                failures.append(f"{label}: {customer_id} carries {dimension_id} twice")
                continue
            bucket[dimension_id] = quantity

    # A customer whose plan earns them no lines at all may reasonably be left out
    # of the result or carried with an empty invoice; both say the same thing.
    missing_customers = sorted(customer for customer in set(expected) - set(observed) if expected[customer])
    if missing_customers:
        failures.append(f"{label}: no invoice lines produced for {missing_customers}")

    for customer_id in sorted(set(expected) & set(observed)):
        want = expected[customer_id]
        got = observed[customer_id]
        absent = sorted(set(want) - set(got))
        surplus = sorted(set(got) - set(want))
        if absent:
            failures.append(f"{label}: {customer_id} is missing lines for {absent}")
        if surplus:
            failures.append(f"{label}: {customer_id} should carry no line for {surplus}")
        for dimension_id in sorted(set(want) & set(got)):
            if not close(got[dimension_id], want[dimension_id]):
                failures.append(
                    f"{label}: {customer_id} {dimension_id} billed {got[dimension_id]}, "
                    f"expected {want[dimension_id]}"
                )
    return failures


def grade(scenario: dict, spec: dict, observed: dict) -> tuple[bool, list[str]]:
    if observed.get("fatal"):
        return False, [f"driver aborted before producing any run: {observed['fatal'][:400]}"]
    runs = observed.get("runs") or {}
    failures: list[str] = []
    for run in spec["runs"]:
        failures.extend(grade_run(scenario, run, runs.get(run["label"])))
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
    parser.add_argument("--scenario")
    parser.add_argument("--spec")
    parser.add_argument("--observed")
    args = parser.parse_args()

    if args.fail:
        emit(args.output_dir, 0.0, [args.fail], note="harness precondition not met")
        return

    for label, path in (("scenario", args.scenario), ("spec", args.spec), ("observed", args.observed)):
        if not path or not os.path.exists(path):
            emit(args.output_dir, 0.0, [f"{label} file is missing"], note="nothing to score")
            return

    with open(args.scenario, encoding="utf-8") as handle:
        scenario = json.load(handle)
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)
    try:
        with open(args.observed, encoding="utf-8") as handle:
            observed = json.load(handle)
    except json.JSONDecodeError:
        emit(args.output_dir, 0.0, ["the driver produced no readable output"], note="nothing to score")
        return

    passed, failures = grade(scenario, spec, observed)
    emit(args.output_dir, 1.0 if passed else 0.0, failures)


if __name__ == "__main__":
    main()
