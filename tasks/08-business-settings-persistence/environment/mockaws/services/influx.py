"""InfluxDB 2.x emulation: line-protocol writes, Flux reads, predicate deletes.

The billing platform keeps its configuration documents in an append-only Influx
bucket rather than a relational store, so nothing about a document's lifecycle
is observable through AWS. This module gives the emulator the same three
endpoints the `@influxdata/influxdb-client` package talks to -- `/api/v2/write`,
`/api/v2/query` and `/api/v2/delete` -- so the service under test can be driven
through its real data access layer and the resulting ledger read back whole.

The Flux support is a subset, not an implementation of the language: it covers
the pipeline shapes this repository actually issues (`from |> range |> filter |>
group |> sort |> unique` and the aggregate tails), because those are the shapes
any query written against the surviving code will take. Unsupported operators
are reported as a query error rather than silently returning nothing, so a
harness failure never masquerades as a wrong answer.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from ..wire import Request, Response

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

PRECISION_TO_NS = {"ns": 1, "us": 1_000, "ms": 1_000_000, "s": 1_000_000_000}

DURATION_UNITS_NS = {
    "ns": 1,
    "us": 1_000,
    "ms": 1_000_000,
    "s": 1_000_000_000,
    "m": 60 * 1_000_000_000,
    "h": 3600 * 1_000_000_000,
    "d": 86400 * 1_000_000_000,
    "w": 7 * 86400 * 1_000_000_000,
    "mo": 30 * 86400 * 1_000_000_000,
    "y": 365 * 86400 * 1_000_000_000,
}


class QueryError(Exception):
    """A Flux pipeline this subset cannot evaluate."""


def to_ns(value: str | int | float | None) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return 0
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    # RFC3339 carries at most nanosecond precision but `datetime` stops at
    # microseconds, so any trailing digits are read separately rather than
    # thrown away, and the arithmetic stays in integers throughout.
    nano_match = re.match(r"(.*\.\d{6})(\d{1,3})(Z|[+-]\d{2}:?\d{2})$", text)
    extra_nanos = 0
    if nano_match:
        extra_nanos = int(nano_match.group(2).ljust(3, "0"))
        text = nano_match.group(1) + nano_match.group(3)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta = parsed - EPOCH
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + delta.microseconds * 1_000 + extra_nanos


def ns_to_rfc3339(nanos: int) -> str:
    seconds, remainder = divmod(int(nanos), 1_000_000_000)
    stamp = EPOCH + timedelta(seconds=seconds)
    return f"{stamp.strftime('%Y-%m-%dT%H:%M:%S')}.{remainder:09d}Z"


def parse_duration_ns(text: str) -> int:
    total = 0
    for amount, unit in re.findall(r"(\d+)(ns|us|ms|mo|[smhdwy])", text):
        total += int(amount) * DURATION_UNITS_NS[unit]
    if not total:
        raise QueryError(f"unsupported duration: {text!r}")
    return total


# ---------------------------------------------------------------------------
# storage
# ---------------------------------------------------------------------------


@dataclass
class Point:
    measurement: str
    tags: dict[str, str]
    fields: dict[str, Any]
    time_ns: int
    seq: int

    def as_json(self) -> dict[str, Any]:
        return {
            "measurement": self.measurement,
            "tags": dict(self.tags),
            "fields": dict(self.fields),
            "time": ns_to_rfc3339(self.time_ns),
            "time_ns": self.time_ns,
            "seq": self.seq,
        }

    def series_key(self) -> tuple:
        return (self.measurement, tuple(sorted(self.tags.items())), self.time_ns)


@dataclass
class Ledger:
    """Every bucket the emulated Influx instance holds."""

    buckets: dict[str, list[Point]] = field(default_factory=dict)
    _seq: int = 0
    writes: int = 0
    deletes: list[dict[str, Any]] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)

    @classmethod
    def from_scenario(cls, raw: dict[str, Any] | None) -> "Ledger":
        ledger = cls()
        for name, rows in (raw or {}).get("buckets", {}).items():
            for row in rows:
                ledger.append(
                    name,
                    Point(
                        measurement=row["measurement"],
                        tags={k: str(v) for k, v in (row.get("tags") or {}).items()},
                        fields=dict(row.get("fields") or {}),
                        time_ns=to_ns(row.get("time")),
                        seq=0,
                    ),
                    count_write=False,
                )
        return ledger

    def append(self, bucket: str, point: Point, count_write: bool = True) -> None:
        self._seq += 1
        point.seq = self._seq
        rows = self.buckets.setdefault(bucket, [])
        # Influx overwrites a point that repeats an existing (measurement,
        # tagset, timestamp); it does not keep two of them.
        key = point.series_key()
        for index, existing in enumerate(rows):
            if existing.series_key() == key:
                merged = dict(existing.fields)
                merged.update(point.fields)
                point.fields = merged
                rows[index] = point
                break
        else:
            rows.append(point)
        if count_write:
            self.writes += 1

    def snapshot(self) -> dict[str, Any]:
        return {
            "buckets": {
                name: [p.as_json() for p in sorted(rows, key=lambda p: (p.time_ns, p.seq))]
                for name, rows in sorted(self.buckets.items())
            },
            "writes": self.writes,
            "deletes": self.deletes,
            "queries": self.queries,
        }


# ---------------------------------------------------------------------------
# line protocol
# ---------------------------------------------------------------------------


def _split_unescaped(text: str, separator: str, limit: int = -1) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    escaped = False
    for char in text:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == separator and (limit < 0 or len(parts) < limit):
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts


def _split_fields(text: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            current.append(char)
            continue
        if char == "," and not in_string:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts


def _split_top_level_spaces(line: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    in_string = False
    escaped = False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            current.append(char)
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            current.append(char)
            continue
        if char == " " and not in_string:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return [p for p in parts if p != ""]


def _parse_field_value(raw: str) -> Any:
    text = raw.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if text in ("t", "T", "true", "True", "TRUE"):
        return True
    if text in ("f", "F", "false", "False", "FALSE"):
        return False
    if re.fullmatch(r"-?\d+[iu]", text):
        return int(text[:-1])
    try:
        return float(text)
    except ValueError:
        return text


def parse_line_protocol(payload: str, precision_ns: int, now_ns: int) -> list[Point]:
    points: list[Point] = []
    for raw_line in payload.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        sections = _split_top_level_spaces(line)
        if len(sections) < 2:
            raise QueryError(f"malformed line protocol: {raw_line!r}")
        head, field_section = sections[0], sections[1]
        time_ns = int(sections[2]) * precision_ns if len(sections) > 2 else now_ns

        head_parts = _split_unescaped(head, ",")
        measurement = head_parts[0]
        tags: dict[str, str] = {}
        for item in head_parts[1:]:
            if not item:
                continue
            key, _, value = item.partition("=")
            tags[key] = value

        fields: dict[str, Any] = {}
        for item in _split_fields(field_section):
            if not item:
                continue
            key, _, value = item.partition("=")
            fields[key.replace("\\ ", " ")] = _parse_field_value(value)

        points.append(Point(measurement, tags, fields, time_ns, 0))
    return points


# ---------------------------------------------------------------------------
# flux: a filter-expression evaluator
# ---------------------------------------------------------------------------

MISSING = object()

_TOKEN = re.compile(
    r"""\s*(?:
        (?P<col_bracket>r\s*\[\s*"(?P<bracket_name>(?:[^"\\]|\\.)*)"\s*\])
      | (?P<col_dot>r\s*\.\s*(?P<dot_name>[A-Za-z_][A-Za-z0-9_]*))
      | (?P<string>"(?:[^"\\]|\\.)*")
      | (?P<op>==|!=|>=|<=|=~|!~|>|<)
      | (?P<word>[A-Za-z_][A-Za-z0-9_]*)
      | (?P<number>-?\d+(?:\.\d+)?)
      | (?P<punct>[()])
    )""",
    re.VERBOSE,
)


def _tokenize(expr: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    position = 0
    while position < len(expr):
        match = _TOKEN.match(expr, position)
        if not match:
            if expr[position].isspace():
                position += 1
                continue
            raise QueryError(f"cannot tokenize filter at {expr[position:position + 24]!r}")
        position = match.end()
        if match.group("col_bracket"):
            tokens.append(("col", match.group("bracket_name")))
        elif match.group("col_dot"):
            tokens.append(("col", match.group("dot_name")))
        elif match.group("string"):
            tokens.append(("str", match.group("string")[1:-1].replace('\\"', '"')))
        elif match.group("op"):
            tokens.append(("op", match.group("op")))
        elif match.group("word"):
            word = match.group("word")
            kind = "kw" if word in ("and", "or", "not", "exists", "true", "false") else "word"
            tokens.append((kind, word))
        elif match.group("number"):
            tokens.append(("num", match.group("number")))
        else:
            tokens.append(("punct", match.group("punct")))
    return tokens


class _FilterParser:
    """Recursive-descent parser producing a row -> bool closure."""

    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.index = 0

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def take(self) -> tuple[str, str]:
        token = self.peek()
        if token is None:
            raise QueryError("unexpected end of filter expression")
        self.index += 1
        return token

    def parse(self) -> Callable[[dict[str, Any]], bool]:
        node = self.parse_or()
        if self.peek() is not None:
            raise QueryError(f"trailing tokens in filter: {self.tokens[self.index:]!r}")
        return node

    def parse_or(self) -> Callable[[dict[str, Any]], bool]:
        left = self.parse_and()
        while self.peek() == ("kw", "or"):
            self.take()
            right = self.parse_and()
            left = (lambda a, b: lambda row: a(row) or b(row))(left, right)
        return left

    def parse_and(self) -> Callable[[dict[str, Any]], bool]:
        left = self.parse_unary()
        while self.peek() == ("kw", "and"):
            self.take()
            right = self.parse_unary()
            left = (lambda a, b: lambda row: a(row) and b(row))(left, right)
        return left

    def parse_unary(self) -> Callable[[dict[str, Any]], bool]:
        token = self.peek()
        if token == ("kw", "not"):
            self.take()
            inner = self.parse_unary()
            return lambda row: not inner(row)
        if token == ("kw", "exists"):
            self.take()
            operand = self.parse_operand()
            return lambda row: operand(row) is not MISSING and operand(row) is not None
        if token == ("punct", "("):
            self.take()
            inner = self.parse_or()
            if self.take() != ("punct", ")"):
                raise QueryError("unbalanced parentheses in filter")
            return inner
        return self.parse_comparison()

    def parse_comparison(self) -> Callable[[dict[str, Any]], bool]:
        left = self.parse_operand()
        token = self.peek()
        if token is None or token[0] != "op":
            # A bare truthy operand, as in `filter(fn: (r) => r.flag)`.
            return lambda row: bool(_defined(left(row)))
        _, operator = self.take()
        right = self.parse_operand()
        return _comparator(operator, left, right)

    def parse_operand(self) -> Callable[[dict[str, Any]], Any]:
        kind, value = self.take()
        if kind == "col":
            return lambda row, name=value: row.get(name, MISSING)
        if kind == "str":
            return lambda row, literal=value: literal
        if kind == "num":
            number = float(value) if "." in value else int(value)
            return lambda row, literal=number: literal
        if kind == "kw" and value in ("true", "false"):
            return lambda row, literal=(value == "true"): literal
        raise QueryError(f"unsupported operand in filter: {value!r}")


def _defined(value: Any) -> Any:
    return None if value is MISSING else value


def _comparator(
    operator: str,
    left: Callable[[dict[str, Any]], Any],
    right: Callable[[dict[str, Any]], Any],
) -> Callable[[dict[str, Any]], bool]:
    def compare(row: dict[str, Any]) -> bool:
        a, b = left(row), right(row)
        if operator == "==":
            return a is not MISSING and b is not MISSING and _coerce_equal(a, b)
        if operator == "!=":
            # Flux propagates null through a comparison, so a row whose column
            # is absent does not pass `!=`. Queries in this repository always
            # guard that case with an explicit `not exists` beforehand.
            if a is MISSING or b is MISSING:
                return False
            return not _coerce_equal(a, b)
        if a is MISSING or b is MISSING:
            return False
        try:
            a_num, b_num = float(a), float(b)
        except (TypeError, ValueError):
            a_num, b_num = None, None
        if a_num is not None and b_num is not None:
            a, b = a_num, b_num
        if operator == ">":
            return a > b
        if operator == "<":
            return a < b
        if operator == ">=":
            return a >= b
        if operator == "<=":
            return a <= b
        if operator in ("=~", "!~"):
            hit = re.search(str(b).strip("/"), str(a)) is not None
            return hit if operator == "=~" else not hit
        raise QueryError(f"unsupported operator {operator}")

    return compare


def _coerce_equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(float(a), float(b), rel_tol=1e-12, abs_tol=1e-12)
    return str(a) == str(b)


def compile_filter(expr: str) -> Callable[[dict[str, Any]], bool]:
    return _FilterParser(_tokenize(expr)).parse()


# ---------------------------------------------------------------------------
# flux: pipeline
# ---------------------------------------------------------------------------


def _split_pipeline(query: str) -> list[str]:
    stages: list[str] = []
    current: list[str] = []
    depth = 0
    in_string = False
    index = 0
    while index < len(query):
        char = query[index]
        if in_string:
            current.append(char)
            if char == "\\":
                if index + 1 < len(query):
                    current.append(query[index + 1])
                    index += 2
                    continue
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            current.append(char)
            index += 1
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if depth == 0 and query.startswith("|>", index):
            stages.append("".join(current))
            current = []
            index += 2
            continue
        current.append(char)
        index += 1
    stages.append("".join(current))
    return [stage.strip() for stage in stages if stage.strip()]


def _split_args(text: str) -> list[str]:
    args: list[str] = []
    current: list[str] = []
    depth = 0
    in_string = False
    for char in text:
        if in_string:
            current.append(char)
            if char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            current.append(char)
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if char == "," and depth == 0:
            args.append("".join(current))
            current = []
            continue
        current.append(char)
    args.append("".join(current))
    return [a.strip() for a in args if a.strip()]


def _parse_stage(stage: str) -> tuple[str, dict[str, str]]:
    match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$", stage, re.DOTALL)
    if not match:
        raise QueryError(f"cannot parse pipeline stage: {stage[:60]!r}")
    name = match.group(1)
    args: dict[str, str] = {}
    for position, argument in enumerate(_split_args(match.group(2))):
        key, separator, value = argument.partition(":")
        if separator and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            args[key.strip()] = value.strip()
        else:
            args[f"_{position}"] = argument.strip()
    return name, args


def _string_arg(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def _list_arg(value: str) -> list[str]:
    text = value.strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return [_string_arg(item) for item in _split_args(text)]


def _bool_arg(value: str, default: bool = False) -> bool:
    text = value.strip().lower()
    if text in ("true", "false"):
        return text == "true"
    return default


@dataclass
class Table:
    rows: list[dict[str, Any]]
    group_key: tuple[str, ...] = ()


def _rows_for(points: Iterable[Point], start_ns: int, stop_ns: int) -> list[dict[str, Any]]:
    """Project points into Flux rows: one row per field, tags as columns."""
    rows: list[dict[str, Any]] = []
    for point in points:
        for name, value in point.fields.items():
            row: dict[str, Any] = {
                "result": "_result",
                "_start": start_ns,
                "_stop": stop_ns,
                "_time": point.time_ns,
                "_measurement": point.measurement,
                "_field": name,
                "_value": value,
                "__seq": point.seq,
            }
            row.update(point.tags)
            rows.append(row)
    return rows


class FluxEngine:
    def __init__(self, ledger: Ledger) -> None:
        self.ledger = ledger

    def run(self, query: str) -> list[Table]:
        stages = _split_pipeline(query)
        if not stages:
            raise QueryError("empty query")

        name, args = _parse_stage(stages[0])
        if name != "from":
            raise QueryError(f"query must begin with from(), saw {name}()")
        bucket = _string_arg(args.get("bucket", args.get("_0", "")))
        points = list(self.ledger.buckets.get(bucket, []))

        # `range` is mandatory in Flux and always the second stage here, but the
        # bounds are only needed to stamp _start/_stop when it is absent.
        start_ns, stop_ns = 0, to_ns("2999-01-01T00:00:00Z")
        tables = [Table(rows=[])]
        pipeline_start = 1
        if len(stages) > 1 and _parse_stage(stages[1])[0] == "range":
            _, range_args = _parse_stage(stages[1])
            start_ns = self._boundary(range_args.get("start", "0"))
            stop_ns = self._boundary(range_args.get("stop", ""), default_now=True)
            pipeline_start = 2
        points = [p for p in points if start_ns <= p.time_ns < stop_ns]
        tables = [Table(rows=_rows_for(points, start_ns, stop_ns))]

        for stage in stages[pipeline_start:]:
            tables = self._apply(stage, tables)
        return [table for table in tables if table.rows]

    @staticmethod
    def _boundary(raw: str, default_now: bool = False) -> int:
        text = _string_arg(raw).strip()
        if not text:
            return to_ns(datetime.now(timezone.utc).isoformat()) if default_now else 0
        if text.startswith("-"):
            now = to_ns(datetime.now(timezone.utc).isoformat())
            return now - parse_duration_ns(text[1:])
        return to_ns(text)

    def _apply(self, stage: str, tables: list[Table]) -> list[Table]:
        name, args = _parse_stage(stage)
        handler = getattr(self, f"_op_{name}", None)
        if handler is None:
            raise QueryError(f"unsupported flux operator: {name}()")
        return handler(tables, args)

    # -- shaping ---------------------------------------------------------

    def _op_filter(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        raw = args.get("fn", "")
        match = re.search(r"\(\s*r\s*\)\s*=>\s*(.+)$", raw, re.DOTALL)
        if not match:
            raise QueryError(f"unsupported filter function: {raw[:60]!r}")
        predicate = compile_filter(match.group(1).strip())
        return [Table([row for row in t.rows if predicate(row)], t.group_key) for t in tables]

    def _op_group(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        mode = _string_arg(args.get("mode", '"by"'))
        columns = tuple(_list_arg(args["columns"])) if "columns" in args else ()
        rows = [row for table in tables for row in table.rows]
        if mode == "except":
            everything = {key for row in rows for key in row if not key.startswith("__")}
            columns = tuple(sorted(everything - set(columns)))
        if not columns:
            return [Table(rows, ())]
        grouped: dict[tuple, list[dict[str, Any]]] = {}
        for row in rows:
            key = tuple(str(row.get(column, "")) for column in columns)
            grouped.setdefault(key, []).append(row)
        return [Table(members, columns) for members in grouped.values()]

    def _op_sort(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        columns = _list_arg(args.get("columns", '["_value"]'))
        descending = _bool_arg(args.get("desc", "false"))

        def key(row: dict[str, Any]) -> tuple:
            # __seq breaks ties between points sharing a timestamp so that the
            # later write is the later row, which real Influx leaves undefined.
            return tuple(_sort_key(row.get(column)) for column in columns) + (row.get("__seq", 0),)

        return [Table(sorted(t.rows, key=key, reverse=descending), t.group_key) for t in tables]

    def _op_unique(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        column = _string_arg(args.get("column", '"_value"'))
        out: list[Table] = []
        for table in tables:
            seen: set[Any] = set()
            kept: list[dict[str, Any]] = []
            for row in table.rows:
                value = row.get(column, MISSING)
                if value is MISSING:
                    continue
                marker = str(value)
                if marker in seen:
                    continue
                seen.add(marker)
                kept.append(row)
            out.append(Table(kept, table.group_key))
        return out

    def _op_limit(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        count = int(_string_arg(args.get("n", args.get("_0", "0"))))
        offset = int(_string_arg(args.get("offset", "0")))
        return [Table(t.rows[offset : offset + count], t.group_key) for t in tables]

    def _op_top(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        count = int(_string_arg(args.get("n", args.get("_0", "0"))))
        columns = _list_arg(args.get("columns", '["_value"]'))
        out: list[Table] = []
        for table in tables:
            ordered = sorted(
                table.rows,
                key=lambda row: tuple(_sort_key(row.get(column)) for column in columns),
                reverse=True,
            )
            out.append(Table(ordered[:count], table.group_key))
        return out

    def _op_keep(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        columns = set(_list_arg(args.get("columns", "[]")))
        return [
            Table([{k: v for k, v in row.items() if k in columns or k.startswith("__")} for row in t.rows], t.group_key)
            for t in tables
        ]

    def _op_drop(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        columns = set(_list_arg(args.get("columns", "[]")))
        return [
            Table([{k: v for k, v in row.items() if k not in columns} for row in t.rows], t.group_key)
            for t in tables
        ]

    def _op_yield(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        name = _string_arg(args.get("name", '"_result"'))
        return [Table([dict(row, result=name) for row in t.rows], t.group_key) for t in tables]

    def _op_fill(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        if "value" not in args:
            return tables
        column = _string_arg(args.get("column", '"_value"'))
        filler = _parse_field_value(args["value"])
        return [
            Table(
                [row if row.get(column) is not None else dict(row, **{column: filler}) for row in t.rows],
                t.group_key,
            )
            for t in tables
        ]

    def _op_pivot(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        row_key = _list_arg(args.get("rowKey", '["_time"]'))
        column_key = _list_arg(args.get("columnKey", '["_field"]'))
        value_column = _string_arg(args.get("valueColumn", '"_value"'))
        out: list[Table] = []
        for table in tables:
            merged: dict[tuple, dict[str, Any]] = {}
            for row in table.rows:
                key = tuple(str(row.get(column, "")) for column in row_key)
                target = merged.setdefault(
                    key,
                    {k: v for k, v in row.items() if k not in column_key and k != value_column},
                )
                name = "_".join(str(row.get(column, "")) for column in column_key)
                target[name] = row.get(value_column)
            out.append(Table(list(merged.values()), table.group_key))
        return out

    # -- aggregates ------------------------------------------------------

    def _reduce(self, tables: list[Table], args: dict[str, str], reducer: str) -> list[Table]:
        column = _string_arg(args.get("column", '"_value"'))
        out: list[Table] = []
        for table in tables:
            if not table.rows:
                out.append(table)
                continue
            out.append(Table([_reduce_rows(table.rows, column, reducer)], table.group_key))
        return out

    def _op_sum(self, tables, args):
        return self._reduce(tables, args, "sum")

    def _op_count(self, tables, args):
        return self._reduce(tables, args, "count")

    def _op_mean(self, tables, args):
        return self._reduce(tables, args, "mean")

    def _op_min(self, tables, args):
        return self._reduce(tables, args, "min")

    def _op_max(self, tables, args):
        return self._reduce(tables, args, "max")

    def _op_last(self, tables, args):
        return self._reduce(tables, args, "last")

    def _op_first(self, tables, args):
        return self._reduce(tables, args, "first")

    def _op_aggregateWindow(self, tables: list[Table], args: dict[str, str]) -> list[Table]:
        every = parse_duration_ns(_string_arg(args.get("every", "1h")))
        reducer = _string_arg(args.get("fn", "sum"))
        column = _string_arg(args.get("column", '"_value"'))
        out: list[Table] = []
        for table in tables:
            windows: dict[int, list[dict[str, Any]]] = {}
            for row in table.rows:
                bucket = (int(row.get("_time", 0)) // every + 1) * every
                windows.setdefault(bucket, []).append(row)
            rows = []
            for boundary in sorted(windows):
                reduced = _reduce_rows(windows[boundary], column, reducer)
                reduced["_time"] = boundary
                rows.append(reduced)
            out.append(Table(rows, table.group_key))
        return out


def _reduce_rows(rows: list[dict[str, Any]], column: str, reducer: str) -> dict[str, Any]:
    ordered = sorted(rows, key=lambda row: (row.get("_time", 0), row.get("__seq", 0)))
    base = dict(ordered[-1] if reducer in ("last", "count", "sum", "mean", "max", "min") else ordered[0])
    if reducer in ("last", "first"):
        return base
    values = []
    for row in rows:
        value = row.get(column)
        if isinstance(value, bool) or value is None:
            continue
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            continue
    if reducer == "count":
        base[column] = len(rows)
    elif reducer == "sum":
        base[column] = sum(values)
    elif reducer == "mean":
        base[column] = (sum(values) / len(values)) if values else None
    elif reducer == "max":
        base[column] = max(values) if values else None
    elif reducer == "min":
        base[column] = min(values) if values else None
    base.pop("_time", None)
    base["_time"] = ordered[-1].get("_time")
    return base


def _sort_key(value: Any) -> tuple:
    if value is None or value is MISSING:
        return (0, 0.0, "")
    if isinstance(value, bool):
        return (1, float(value), "")
    if isinstance(value, (int, float)):
        return (1, float(value), "")
    return (2, 0.0, str(value))


# ---------------------------------------------------------------------------
# annotated CSV rendering
# ---------------------------------------------------------------------------

LEADING_COLUMNS = ["result", "table", "_start", "_stop", "_time", "_value", "_field", "_measurement"]
TIME_COLUMNS = {"_start", "_stop", "_time"}
GROUP_KEY_COLUMNS = {"_start", "_stop", "_measurement", "_field"}


def _column_order(rows: list[dict[str, Any]]) -> list[str]:
    present = {key for row in rows for key in row if not key.startswith("__")}
    ordered = [column for column in LEADING_COLUMNS if column in present or column == "table"]
    ordered += sorted(present - set(ordered))
    return ordered


def _datatype(column: str, rows: list[dict[str, Any]]) -> str:
    if column == "table":
        return "long"
    if column in TIME_COLUMNS:
        return "dateTime:RFC3339"
    values = [row.get(column) for row in rows if row.get(column) is not None]
    if values and all(isinstance(v, bool) for v in values):
        return "boolean"
    if values and all(not isinstance(v, bool) and isinstance(v, (int, float)) for v in values):
        return "double"
    return "string"


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    if any(char in text for char in (",", '"', "\n", "\r")):
        return '"' + text.replace('"', '""') + '"'
    return text


def render_csv(tables: list[Table]) -> str:
    if not tables:
        return ""
    lines: list[str] = []
    previous: list[str] | None = None
    table_index = 0
    for table in tables:
        columns = _column_order(table.rows)
        if columns != previous:
            if previous is not None:
                lines.append("")
            datatypes = [_datatype(column, table.rows) for column in columns]
            groups = [
                "true" if column in GROUP_KEY_COLUMNS or column in table.group_key else "false"
                for column in columns
            ]
            defaults = ["_result" if column == "result" else "" for column in columns]
            lines.append("#datatype," + ",".join(datatypes))
            lines.append("#group," + ",".join(groups))
            lines.append("#default," + ",".join(defaults))
            lines.append("," + ",".join(columns))
            previous = columns
        for row in table.rows:
            cells = []
            for column in columns:
                if column == "table":
                    cells.append(str(table_index))
                elif column in TIME_COLUMNS:
                    raw = row.get(column)
                    cells.append(ns_to_rfc3339(raw) if raw is not None else "")
                else:
                    cells.append(_csv_cell(row.get(column)))
            lines.append("," + ",".join(cells))
        table_index += 1
    return "\r\n".join(lines) + "\r\n"


# ---------------------------------------------------------------------------
# delete predicates
# ---------------------------------------------------------------------------

_PREDICATE_TERM = re.compile(r'\s*(?:"?(?P<key>[A-Za-z_][A-Za-z0-9_.\-]*)"?)\s*(?P<op>!=|=)\s*"(?P<value>[^"]*)"')


def compile_predicate(predicate: str) -> Callable[[Point], bool]:
    terms: list[tuple[str, str, str]] = []
    position = 0
    text = predicate.strip()
    while position < len(text):
        match = _PREDICATE_TERM.match(text, position)
        if not match:
            raise QueryError(f"unsupported delete predicate at {text[position:position + 32]!r}")
        terms.append((match.group("key"), match.group("op"), match.group("value")))
        position = match.end()
        conjunction = re.match(r"\s*(AND|and)\s*", text[position:])
        if not conjunction:
            break
        position += conjunction.end()
    if position < len(text) and text[position:].strip():
        raise QueryError(f"unsupported delete predicate tail {text[position:]!r}")

    def matches(point: Point) -> bool:
        for key, operator, expected in terms:
            actual = point.measurement if key == "_measurement" else point.tags.get(key)
            if operator == "=":
                if actual != expected:
                    return False
            elif actual == expected:
                return False
        return True

    return matches


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------


def _error(status: int, message: str) -> Response:
    return Response(
        status=status,
        body=json.dumps({"code": "invalid", "message": message}).encode(),
        headers={"Content-Type": "application/json"},
    )


def handle(world: Any, req: Request) -> Response:
    ledger: Ledger = world.influx
    path = req.path.rstrip("/") or "/"

    if path in ("/ping", "/health", "/api/v2/ping"):
        return Response(status=204, headers={"X-Influxdb-Version": "2.7.0-mockaws"})

    if path == "/api/v2/write" and req.method == "POST":
        bucket = req.query.get("bucket", "")
        if not bucket:
            return _error(400, "bucket is required")
        precision = PRECISION_TO_NS.get(req.query.get("precision", "ns"))
        if precision is None:
            return _error(400, f"unsupported precision {req.query.get('precision')!r}")
        now_ns = to_ns(datetime.now(timezone.utc).isoformat())
        try:
            points = parse_line_protocol(req.text, precision, now_ns)
        except QueryError as exc:
            return _error(400, str(exc))
        for point in points:
            ledger.append(bucket, point)
        return Response(status=204)

    if path == "/api/v2/query" and req.method == "POST":
        try:
            payload = req.json()
        except json.JSONDecodeError:
            payload = {"query": req.text}
        query = payload.get("query") or req.text
        ledger.queries.append(query)
        try:
            tables = FluxEngine(ledger).run(query)
        except QueryError as exc:
            return _error(400, f"flux not supported by the emulator: {exc}")
        return Response(
            status=200,
            body=render_csv(tables).encode(),
            headers={"Content-Type": "text/csv; charset=utf-8"},
        )

    if path == "/api/v2/delete" and req.method == "POST":
        bucket = req.query.get("bucket", "")
        try:
            payload = req.json()
        except json.JSONDecodeError:
            return _error(400, "delete body must be JSON")
        start_ns = to_ns(payload.get("start"))
        stop_ns = to_ns(payload.get("stop"))
        try:
            matches = compile_predicate(payload.get("predicate", ""))
        except QueryError as exc:
            return _error(400, str(exc))
        rows = ledger.buckets.get(bucket, [])
        removed = [p for p in rows if start_ns <= p.time_ns < stop_ns and matches(p)]
        ledger.buckets[bucket] = [p for p in rows if p not in removed]
        ledger.deletes.append(
            {
                "bucket": bucket,
                "predicate": payload.get("predicate", ""),
                "start": payload.get("start"),
                "stop": payload.get("stop"),
                "removed": [p.as_json() for p in removed],
            }
        )
        return Response(status=204)

    if path == "/api/v2/buckets" and req.method == "GET":
        return Response(
            status=200,
            body=json.dumps(
                {"buckets": [{"id": name, "name": name, "type": "user"} for name in sorted(ledger.buckets)]}
            ).encode(),
            headers={"Content-Type": "application/json"},
        )

    return _error(404, f"no influx route for {req.method} {req.path}")
