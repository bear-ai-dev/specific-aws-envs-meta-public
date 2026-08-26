"""CloudWatch (query protocol): metric readings.

The AWS SDK pinned in the serviced project talks to CloudWatch over the
historical query protocol -- form-encoded requests with `member.N` indexing, and
XML replies under the 2010-08-01 namespace -- so that is what this speaks.

The behaviours modelled here are the ones that separate a metering integration
that happens to work from one that is right:

* A series is identified by its *whole* dimension set. `AWS/EC2` publishes
  `NetworkOut` per `InstanceId`, so a query that names no dimension names no
  series and comes back empty rather than aggregated across the fleet.
* `StartTime` is rounded down and `EndTime` rounded up to a multiple of the
  requested period, so a window that does not sit on a period boundary pulls in
  the whole of the buckets it clips.
* A period with no observations produces no datapoint at all. An idle instance
  is therefore absent from the numbers, not zero in them.
* `GetMetricStatistics` returns datapoints in no particular order, which is what
  the real API documents.
* `GetMetricData` orders by timestamp according to `ScanBy`, newest first by
  default, and pages through a token when the response is capped.
* Metrics Insights `SELECT` expressions are accepted as an alternative to
  `MetricStat`, including `GROUP BY`, which is how a caller batches a fleet into
  one query.
* The two request shapes answer differently about a series that reported
  nothing, and both answers are the real API's. A `MetricStat` query names one
  series, so it is always answered, with an empty value list where the window
  held no observation. A `SELECT` is a query over the schema and yields one
  result per series it *found* readings for, so a silent series is simply not in
  the reply. Either way the caller learns that nothing was observed, and neither
  way is it told a zero.
* `Id` on a metric data query is validated the way the real API validates it: it
  must start with a lowercase letter and carry only letters, digits and
  underscores. A resource id containing a hyphen is therefore not usable as one.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any

from ..state import Session, World, iso, parse_ts
from ..wire import XMLNS_CW, Request, Response, error_xml, query_action, tag, xml_response

UTC_TZ = timezone.utc

STATISTICS = ("SampleCount", "Average", "Sum", "Minimum", "Maximum")


# ---------------------------------------------------------------------------
# request shape
# ---------------------------------------------------------------------------


def _unflatten(form: dict[str, str]) -> dict[str, Any]:
    """Turn `A.member.1.B=x` into `{"A": {"1": {"B": "x"}}}`."""
    root: dict[str, Any] = {}
    for key, value in form.items():
        parts = [part for part in key.split(".") if part != "member"]
        node = root
        for part in parts[:-1]:
            child = node.get(part)
            if not isinstance(child, dict):
                child = {}
                node[part] = child
            node = child
        if isinstance(node.get(parts[-1]), dict):
            continue
        node[parts[-1]] = value
    return root


def _members(node: Any) -> list[Any]:
    if not isinstance(node, dict):
        return []
    return [node[key] for key in sorted((k for k in node if k.isdigit()), key=int)]


def _dimensions(node: Any) -> dict[str, str]:
    return {
        entry["Name"]: entry.get("Value", "")
        for entry in _members(node)
        if isinstance(entry, dict) and "Name" in entry
    }


# ---------------------------------------------------------------------------
# aggregation
# ---------------------------------------------------------------------------


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


def _period(raw: Any, default: int = 300) -> int:
    try:
        period = int(raw)
    except (TypeError, ValueError):
        return default
    return period if period > 0 else default


def _align(start: datetime, end: datetime, period: int) -> tuple[datetime, datetime]:
    """Round the window outwards to period boundaries, as CloudWatch does."""
    start_epoch = int(start.timestamp()) // period * period
    end_epoch = -((-int(end.timestamp())) // period) * period
    return (
        datetime.fromtimestamp(start_epoch, tz=start.tzinfo),
        datetime.fromtimestamp(end_epoch, tz=end.tzinfo),
    )


def _series_for(account, namespace: str, metric_name: str, dimensions: dict[str, str]) -> list:
    """Series whose dimension set is exactly the one asked for."""
    return [
        series
        for series in account.metrics
        if series.namespace == namespace
        and series.metric_name == metric_name
        and series.dimensions == dimensions
    ]


def _bucket(world: World, matched: list, start: datetime, end: datetime, period: int) -> dict[int, list[float]]:
    anchor = world.anchor()
    buckets: dict[int, list[float]] = {}
    for series in matched:
        for timestamp, value in series.resolved_points(anchor):
            if not (start <= timestamp < end):
                continue
            slot = int(timestamp.timestamp()) // period * period
            buckets.setdefault(slot, []).append(value)
    return buckets


def _scramble(world: World, label: str, slots: list[int]) -> list[int]:
    """A stable but non-chronological order for GetMetricStatistics datapoints."""
    return sorted(slots, key=lambda slot: hashlib.sha1(f"{world.seed}:{label}:{slot}".encode()).hexdigest())


def _unit_of(matched: list) -> str:
    for series in matched:
        if series.unit and series.unit != "None":
            return series.unit
    return "None"


# ---------------------------------------------------------------------------
# Metrics Insights
# ---------------------------------------------------------------------------

_SELECT = re.compile(
    r"^\s*SELECT\s+(?P<stat>\w+)\s*\(\s*(?P<metric>[\w./-]+)\s*\)\s*"
    r"FROM\s+(?P<from>SCHEMA\s*\(\s*(?P<schema>[^)]*)\)|\"[^\"]+\"|[\w./-]+)"
    r"(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
_WHERE_EQ = re.compile(r"(?P<name>[\w./-]+)\s*=\s*'(?P<value>[^']*)'", re.IGNORECASE)
_WHERE_IN = re.compile(r"(?P<name>[\w./-]+)\s+IN\s*\((?P<values>[^)]*)\)", re.IGNORECASE)
_GROUP_BY = re.compile(r"GROUP\s+BY\s+(?P<dims>[\w.,\s\"'/-]+?)(?:ORDER\s+BY|LIMIT|$)", re.IGNORECASE | re.DOTALL)
_QUERY_ID = re.compile(r"^[a-z][a-zA-Z0-9_]*$")


class RequestRejected(Exception):
    """Something the real API would answer with an error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _parse_insights(expression: str) -> dict[str, Any]:
    match = _SELECT.match(expression)
    if not match:
        raise RequestRejected("InvalidParameterValue", f"Invalid Metrics Insights query: {expression}")
    schema = match.group("schema")
    if schema is not None:
        parts = [piece.strip().strip('"').strip("'") for piece in schema.split(",") if piece.strip()]
        namespace = parts[0] if parts else ""
        schema_dims = parts[1:]
    else:
        namespace = match.group("from").strip().strip('"')
        schema_dims = None

    rest = match.group("rest") or ""
    where_clause = rest
    group_match = _GROUP_BY.search(rest)
    group_by: list[str] = []
    if group_match:
        where_clause = rest[: group_match.start()]
        group_by = [
            piece.strip().strip('"').strip("'")
            for piece in group_match.group("dims").split(",")
            if piece.strip()
        ]

    predicates: dict[str, list[str]] = {}
    for hit in _WHERE_IN.finditer(where_clause):
        values = [piece.strip().strip("'") for piece in hit.group("values").split(",") if piece.strip()]
        predicates[hit.group("name").strip('"')] = values
    for hit in _WHERE_EQ.finditer(where_clause):
        predicates.setdefault(hit.group("name").strip('"'), [hit.group("value")])

    return {
        "stat": match.group("stat"),
        "metric_name": match.group("metric"),
        "namespace": namespace,
        "schema_dims": schema_dims,
        "predicates": predicates,
        "group_by": group_by,
    }


def _insights_groups(account, parsed: dict[str, Any]) -> list[tuple[str, list]]:
    """Resolve a parsed expression into (label, series list) groups."""
    candidates = []
    for series in account.metrics:
        if series.namespace != parsed["namespace"] or series.metric_name != parsed["metric_name"]:
            continue
        if parsed["schema_dims"] is not None and sorted(series.dimensions) != sorted(parsed["schema_dims"]):
            continue
        if any(series.dimensions.get(name) not in values for name, values in parsed["predicates"].items()):
            continue
        candidates.append(series)

    if not parsed["group_by"]:
        return [(parsed["metric_name"], candidates)] if candidates else []

    grouped: dict[str, list] = {}
    for series in candidates:
        key = " ".join(series.dimensions.get(name, "") for name in parsed["group_by"])
        grouped.setdefault(key, []).append(series)
    return sorted(grouped.items())


# ---------------------------------------------------------------------------
# paging
# ---------------------------------------------------------------------------


def _page_cap(injector, action: str) -> int:
    # `page_size` hands back the caller's own ask when no rule caps it, so a
    # sentinel that nothing would ever request means "uncapped".
    cap = injector.page_size("cloudwatch", action, 1_000_000)
    return 0 if cap >= 1_000_000 else cap


def _decode_token(token: str) -> int:
    try:
        return max(0, int(json.loads(bytes.fromhex(token).decode())["offset"]))
    except Exception:  # noqa: BLE001 - an unreadable token is an invalid token
        raise RequestRejected("InvalidNextToken", "The next token supplied is invalid") from None


def _encode_token(offset: int) -> str:
    return json.dumps({"offset": offset}, separators=(",", ":")).encode().hex()


# ---------------------------------------------------------------------------
# wire
# ---------------------------------------------------------------------------


def _envelope(action: str, inner: str) -> Response:
    body = (
        f'<{action}Response xmlns="{XMLNS_CW}">'
        f"<{action}Result>{inner}</{action}Result>"
        "<ResponseMetadata><RequestId>mockaws-cloudwatch</RequestId></ResponseMetadata>"
        f"</{action}Response>"
    )
    return xml_response(body)


def _list(name: str, entries: list[str]) -> str:
    return f"<{name}>" + "".join(f"<member>{entry}</member>" for entry in entries) + f"</{name}>"


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_xml("AccessDenied", "Unknown account", 403)

    action = query_action(req)
    payload = _unflatten(req.form())

    try:
        if action == "GetMetricData":
            return _get_metric_data(world, account, injector, payload)
        if action == "GetMetricStatistics":
            return _get_metric_statistics(world, account, payload)
        if action == "ListMetrics":
            return _list_metrics(account, injector, payload)
    except RequestRejected as rejected:
        return error_xml(rejected.code, rejected.message, 400)

    return error_xml("InvalidAction", f"Unsupported CloudWatch action: {action}", 400)


def _get_metric_data(world: World, account, injector, payload: dict[str, Any]) -> Response:
    start_raw = parse_ts(payload.get("StartTime"))
    end_raw = parse_ts(payload.get("EndTime"))
    descending = str(payload.get("ScanBy", "TimestampDescending")) != "TimestampAscending"

    results: list[dict[str, Any]] = []
    for query in _members(payload.get("MetricDataQueries")):
        if not isinstance(query, dict):
            continue
        query_id = str(query.get("Id", "q"))
        if not _QUERY_ID.match(query_id):
            raise RequestRejected(
                "ValidationError",
                f"The value {query_id} for parameter id is not a valid identifier: it must start with "
                "a lowercase letter and contain only letters, numbers and underscores",
            )
        if query.get("Expression"):
            parsed = _parse_insights(str(query["Expression"]))
            period = _period(query.get("Period"))
            start, end = _align(start_raw, end_raw, period)
            # A SELECT is answered per series that had readings in the window.
            # A series that published nothing is absent from the reply rather
            # than present and empty; see the module docstring.
            for label, matched in _insights_groups(account, parsed):
                buckets = _bucket(world, matched, start, end, period)
                if not buckets:
                    continue
                results.append(_data_result(query_id, label, buckets, parsed["stat"], descending))
            continue

        stat_spec = query.get("MetricStat")
        if not isinstance(stat_spec, dict):
            raise RequestRejected(
                "InvalidParameterCombination", f"The query {query_id} needs either MetricStat or Expression"
            )
        metric = stat_spec.get("Metric") if isinstance(stat_spec.get("Metric"), dict) else {}
        period = _period(stat_spec.get("Period"))
        stat = stat_spec.get("Stat", "Sum")
        start, end = _align(start_raw, end_raw, period)
        matched = _series_for(
            account,
            metric.get("Namespace", ""),
            metric.get("MetricName", ""),
            _dimensions(metric.get("Dimensions")),
        )
        buckets = _bucket(world, matched, start, end, period)
        results.append(
            _data_result(query_id, query.get("Label") or metric.get("MetricName", ""), buckets, stat, descending)
        )

    cap = _page_cap(injector, "GetMetricData")
    offset = _decode_token(str(payload["NextToken"])) if payload.get("NextToken") else 0

    if not cap:
        page = results if offset == 0 else []
        return _envelope("GetMetricData", _data_results_xml(page) + "<Messages/>")

    # Datapoints are handed back a page at a time, in the order the results were
    # produced. A result whose window held nothing still travels on the first
    # page: the caller asked for it and CloudWatch always answers.
    page = []
    budget = cap
    cursor = 0
    remaining = False
    for result in results:
        count = len(result["Values"])
        if count == 0:
            if offset == 0:
                page.append(dict(result, StatusCode="Complete"))
            continue
        if cursor + count <= offset:
            cursor += count
            continue
        skip = max(0, offset - cursor)
        available = count - skip
        take = min(budget, available)
        if take <= 0:
            remaining = True
            break
        sliced = dict(result)
        sliced["Timestamps"] = result["Timestamps"][skip : skip + take]
        sliced["Values"] = result["Values"][skip : skip + take]
        sliced["StatusCode"] = "Complete" if take == available else "PartialData"
        page.append(sliced)
        budget -= take
        cursor += count
        if take < available:
            remaining = True
            break

    consumed = offset + (cap - budget)
    total = sum(len(result["Values"]) for result in results)
    inner = _data_results_xml(page) + "<Messages/>"
    if remaining or consumed < total:
        inner += tag("NextToken", _encode_token(consumed))
    return _envelope("GetMetricData", inner)


def _data_result(
    query_id: str, label: str, buckets: dict[int, list[float]], stat: str, descending: bool
) -> dict[str, Any]:
    slots = sorted(buckets, reverse=descending)
    return {
        "Id": query_id,
        "Label": label,
        "Timestamps": [float(slot) for slot in slots],
        "Values": [_aggregate(buckets[slot], stat) for slot in slots],
        "StatusCode": "Complete",
    }


def _data_results_xml(results: list[dict[str, Any]]) -> str:
    members = []
    for result in results:
        members.append(
            tag("Id", result["Id"])
            + tag("Label", result["Label"])
            + _list("Timestamps", [iso(datetime.fromtimestamp(slot, tz=UTC_TZ)) for slot in result["Timestamps"]])
            + _list("Values", [repr(float(value)) for value in result["Values"]])
            + tag("StatusCode", result["StatusCode"])
        )
    return _list("MetricDataResults", members)


def _get_metric_statistics(world: World, account, payload: dict[str, Any]) -> Response:
    period = _period(payload.get("Period"))
    start, end = _align(parse_ts(payload.get("StartTime")), parse_ts(payload.get("EndTime")), period)
    metric_name = payload.get("MetricName", "")
    stats = [value for value in _members(payload.get("Statistics")) if isinstance(value, str)]
    extended = [value for value in _members(payload.get("ExtendedStatistics")) if isinstance(value, str)]
    if not stats and not extended:
        raise RequestRejected(
            "MissingParameter", "The parameter Statistics or ExtendedStatistics must be specified."
        )
    matched = _series_for(account, payload.get("Namespace", ""), metric_name, _dimensions(payload.get("Dimensions")))
    buckets = _bucket(world, matched, start, end, period)
    unit = payload.get("Unit") or _unit_of(matched)

    members = []
    for slot in _scramble(world, metric_name, list(buckets)):
        entry = tag("Timestamp", iso(datetime.fromtimestamp(slot, tz=UTC_TZ)))
        for stat in stats:
            name = stat if stat in STATISTICS else "Sum"
            entry += tag(name, repr(_aggregate(buckets[slot], stat)))
        entry += tag("Unit", unit)
        members.append(entry)
    return _envelope("GetMetricStatistics", tag("Label", metric_name) + _list("Datapoints", members))


def _list_metrics(account, injector, payload: dict[str, Any]) -> Response:
    namespace = payload.get("Namespace")
    metric_name = payload.get("MetricName")
    wanted = [
        (entry.get("Name"), entry.get("Value"))
        for entry in _members(payload.get("Dimensions"))
        if isinstance(entry, dict) and entry.get("Name")
    ]

    seen: set[tuple] = set()
    entries: list[tuple] = []
    for series in account.metrics:
        if namespace and series.namespace != namespace:
            continue
        if metric_name and series.metric_name != metric_name:
            continue
        if any(
            (name not in series.dimensions) or (value is not None and series.dimensions[name] != value)
            for name, value in wanted
        ):
            continue
        # One logical series can be described by several scenario entries; the
        # catalogue lists it once.
        key = (series.namespace, series.metric_name, tuple(sorted(series.dimensions.items())))
        if key in seen:
            continue
        seen.add(key)
        entries.append(key)
    entries.sort()

    cap = _page_cap(injector, "ListMetrics")
    offset = _decode_token(str(payload["NextToken"])) if payload.get("NextToken") else 0
    page = entries[offset : offset + cap] if cap else entries[offset:]

    members = []
    for series_namespace, series_metric, dimensions in page:
        dimension_members = _list(
            "Dimensions",
            [tag("Name", name) + tag("Value", value) for name, value in dimensions],
        )
        members.append(
            tag("Namespace", series_namespace) + tag("MetricName", series_metric) + dimension_members
        )
    inner = _list("Metrics", members)
    if cap and offset + cap < len(entries):
        inner += tag("NextToken", _encode_token(offset + cap))
    return _envelope("ListMetrics", inner)
