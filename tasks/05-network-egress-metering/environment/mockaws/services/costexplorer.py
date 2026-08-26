"""Cost Explorer (json-1.1): GetCostAndUsage with grouping, filtering, paging."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..state import CostRecord, Session, World, parse_ts
from ..wire import Request, Response, error_json, json_response, json_target

UTC = timezone.utc


def _day(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d")


def _matches_filter(record: CostRecord, expression: dict[str, Any] | None) -> bool:
    if not expression:
        return True
    if "And" in expression:
        return all(_matches_filter(record, child) for child in expression["And"])
    if "Or" in expression:
        return any(_matches_filter(record, child) for child in expression["Or"])
    if "Not" in expression:
        return not _matches_filter(record, expression["Not"])
    if "Dimensions" in expression:
        spec = expression["Dimensions"]
        key = spec.get("Key", "")
        values = spec.get("Values", [])
        actual = record.keys.get(key)
        match_options = spec.get("MatchOptions", ["EQUALS"])
        if "EQUALS" in match_options or not match_options:
            return actual in values
        if "CONTAINS" in match_options:
            return any(actual and value in actual for value in values)
        return actual in values
    if "Tags" in expression:
        spec = expression["Tags"]
        key = f"TAG:{spec.get('Key', '')}"
        return record.keys.get(key) in spec.get("Values", [])
    return True


def _bucket_start(record_start: datetime, granularity: str) -> datetime:
    if granularity == "MONTHLY":
        return record_start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if granularity == "HOURLY":
        return record_start.replace(minute=0, second=0, microsecond=0)
    return record_start.replace(hour=0, minute=0, second=0, microsecond=0)


def _bucket_end(start: datetime, granularity: str) -> datetime:
    if granularity == "MONTHLY":
        return (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    if granularity == "HOURLY":
        return start + timedelta(hours=1)
    return start + timedelta(days=1)


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("UnrecognizedClientException", "The security token is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_json("AccessDeniedException", "Unknown account", 403)

    target = json_target(req)
    if target != "GetCostAndUsage":
        return error_json("InvalidParameterValueException", f"Unsupported Cost Explorer action: {target}", 400)

    payload = req.json()
    period = payload.get("TimePeriod", {})
    try:
        start = parse_ts(period["Start"])
        end = parse_ts(period["End"])
    except KeyError:
        return error_json("ValidationException", "TimePeriod with Start and End is required", 400)

    granularity = payload.get("Granularity", "MONTHLY").upper()
    metrics = payload.get("Metrics", ["UnblendedCost"])
    group_by = payload.get("GroupBy", [])
    expression = payload.get("Filter")

    selected = [
        record
        for record in account.costs
        if record.start >= start and record.start < end and _matches_filter(record, expression)
    ]

    buckets: dict[tuple[datetime, tuple[str, ...]], dict[str, float]] = {}
    for record in selected:
        bucket_start = _bucket_start(record.start, granularity)
        group_key = tuple(record.keys.get(spec.get("Key", ""), "NoGroupKey") for spec in group_by)
        entry = buckets.setdefault((bucket_start, group_key), {"AmortizedCost": 0.0, "UnblendedCost": 0.0, "UsageQuantity": 0.0})
        entry["AmortizedCost"] += record.amortized_cost
        entry["UnblendedCost"] += record.unblended_cost
        entry["UsageQuantity"] += record.usage_quantity

    by_period: dict[datetime, list[tuple[tuple[str, ...], dict[str, float]]]] = {}
    for (bucket_start, group_key), totals in sorted(buckets.items(), key=lambda item: (item[0][0], item[0][1])):
        by_period.setdefault(bucket_start, []).append((group_key, totals))

    results = []
    for bucket_start in sorted(by_period):
        groups = []
        period_totals = {"AmortizedCost": 0.0, "UnblendedCost": 0.0, "UsageQuantity": 0.0}
        for group_key, totals in by_period[bucket_start]:
            for name, value in totals.items():
                period_totals[name] += value
            if group_by:
                groups.append(
                    {
                        "Keys": list(group_key),
                        "Metrics": {
                            metric: {
                                "Amount": f"{totals.get(metric, 0.0):.10f}",
                                "Unit": "N/A" if metric == "UsageQuantity" else "USD",
                            }
                            for metric in metrics
                        },
                    }
                )
        results.append(
            {
                "TimePeriod": {
                    "Start": _day(bucket_start),
                    "End": _day(_bucket_end(bucket_start, granularity)),
                },
                "Total": {}
                if group_by
                else {
                    metric: {
                        "Amount": f"{period_totals.get(metric, 0.0):.10f}",
                        "Unit": "N/A" if metric == "UsageQuantity" else "USD",
                    }
                    for metric in metrics
                },
                "Groups": groups,
                "Estimated": False,
            }
        )

    page_size = injector.page_size("ce", "GetCostAndUsage", len(results) or 1)
    token = payload.get("NextPageToken")
    offset = int(token) if token else 0
    page = results[offset : offset + page_size]
    response: dict[str, Any] = {
        "ResultsByTime": page,
        "GroupDefinitions": group_by,
        "DimensionValueAttributes": [],
    }
    if offset + page_size < len(results):
        response["NextPageToken"] = str(offset + page_size)
    return json_response(response)
