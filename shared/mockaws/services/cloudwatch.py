"""CloudWatch.

Current AWS SDKs speak JSON 1.0 to CloudWatch (`GraniteServiceVersion20100801.*`)
rather than the historical query protocol, so this module parses JSON requests
and emits JSON responses with epoch-second timestamps.
"""

from __future__ import annotations

from typing import Any

from ..state import Session, World, parse_ts
from ..wire import Request, Response, error_json, json_response, json_target


def _aggregate(values: list[float], stat: str) -> float:
    if not values:
        return 0.0
    stat = stat.lower()
    if stat == "sum":
        return sum(values)
    if stat in ("average", "avg"):
        return sum(values) / len(values)
    if stat == "maximum":
        return max(values)
    if stat == "minimum":
        return min(values)
    if stat == "samplecount":
        return float(len(values))
    return sum(values)


def _dimensions(raw: list[dict[str, str]] | None) -> dict[str, str]:
    return {item["Name"]: item["Value"] for item in (raw or []) if "Name" in item}


def _bucket(account, namespace: str, metric_name: str, dimensions: dict[str, str], start, end, period: int):
    buckets: dict[int, list[float]] = {}
    for series in account.metrics:
        if not series.matches(namespace, metric_name, dimensions):
            continue
        for timestamp, value in series.points:
            if not (start <= timestamp < end):
                continue
            slot = int(timestamp.timestamp()) // period * period
            buckets.setdefault(slot, []).append(value)
    return buckets


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_json("AccessDenied", "Unknown account", 403)

    action = json_target(req)
    payload = req.json()

    if action == "GetMetricData":
        start = parse_ts(payload.get("StartTime"))
        end = parse_ts(payload.get("EndTime"))
        queries = payload.get("MetricDataQueries", [])
        results: list[dict[str, Any]] = []
        for query in queries:
            stat_spec = query.get("MetricStat", {})
            metric = stat_spec.get("Metric", {})
            period = int(stat_spec.get("Period", 3600))
            stat = stat_spec.get("Stat", "Sum")
            buckets = _bucket(
                account,
                metric.get("Namespace", ""),
                metric.get("MetricName", ""),
                _dimensions(metric.get("Dimensions")),
                start,
                end,
                period,
            )
            slots = sorted(buckets)
            results.append(
                {
                    "Id": query.get("Id", "q"),
                    "Label": metric.get("MetricName", ""),
                    "Timestamps": [float(slot) for slot in slots],
                    "Values": [_aggregate(buckets[slot], stat) for slot in slots],
                    "StatusCode": "Complete",
                }
            )
        return json_response({"MetricDataResults": results, "Messages": []})

    if action == "GetMetricStatistics":
        start = parse_ts(payload.get("StartTime"))
        end = parse_ts(payload.get("EndTime"))
        period = int(payload.get("Period", 3600))
        stats = payload.get("Statistics", ["Sum"])
        buckets = _bucket(
            account,
            payload.get("Namespace", ""),
            payload.get("MetricName", ""),
            _dimensions(payload.get("Dimensions")),
            start,
            end,
            period,
        )
        datapoints = []
        for slot in sorted(buckets):
            point: dict[str, Any] = {"Timestamp": float(slot), "Unit": "None"}
            for stat in stats:
                point[stat] = _aggregate(buckets[slot], stat)
            datapoints.append(point)
        return json_response({"Label": payload.get("MetricName", ""), "Datapoints": datapoints})

    if action == "ListMetrics":
        metrics = [
            {
                "Namespace": series.namespace,
                "MetricName": series.metric_name,
                "Dimensions": [{"Name": k, "Value": v} for k, v in sorted(series.dimensions.items())],
            }
            for series in account.metrics
        ]
        return json_response({"Metrics": metrics})

    return error_json("InvalidAction", f"Unsupported CloudWatch action: {action}", 400)
