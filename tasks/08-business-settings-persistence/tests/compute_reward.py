#!/usr/bin/env python3
"""Trusted scorer. Runs as root, loads no submitted code.

For every save the driver replayed it re-derives, from the recorded document
plus the save itself, what that business's configuration should look like
afterwards -- which fields the save was entitled to touch, which it had to
leave exactly as it found them, and which of the platform's own starting values
it must not have written over the business's chosen ones. It then holds that
against two things it can see for itself: the row the save left in the
configuration ledger, read over the emulator's admin channel, and what the
service handed back when the same business was read afterwards.

It also re-derives whether the hourly cluster-cost job should have been started
or stopped, since that turns on the cost source crossing a boundary rather than
on the save mentioning it at all.

The submission never sees this file, the held-out ledger, or the derived
answers. Reward is binary: every check passes, or the run is worth nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# the shape of a configuration document
# ---------------------------------------------------------------------------

# Every field graded here belongs to the document's own lifecycle. The tax
# terms, the cloud credentials, the brand image and the payment linkage are
# owned elsewhere and are deliberately left out of every comparison.
GRADED_FIELDS = [
    "businessName",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "country",
    "postalCode",
    "vatId",
    "customFields",
    "supportEmail",
    "invoicePaymentTerm",
    "invoiceApproval",
    "freeDimensionOnInvoice",
    "invoiceGeneration",
    "sendInvoiceEmail",
    "computeCostSource",
    "storageCostSource",
    "archiveCostSource",
]

# What a reader sees for a field the ledger never carried. These are the
# platform's starting values, and several of them are not blank, which is why a
# save that rebuilds a document from scratch does not merely empty a business's
# choices -- it replaces them with someone else's.
STARTING_VALUES = {
    "businessName": "",
    "addressLine1": "",
    "addressLine2": "",
    "city": "",
    "state": "",
    "country": "",
    "postalCode": "",
    "vatId": "",
    "customFields": "",
    "supportEmail": "",
    "invoicePaymentTerm": "",
    "invoiceApproval": "manual",
    "freeDimensionOnInvoice": "show",
    "invoiceGeneration": "perTransaction",
    "sendInvoiceEmail": "true",
    "computeCostSource": "none",
    "storageCostSource": "none",
    "archiveCostSource": "none",
}

CLUSTER_SOURCE = "eks"
CLUSTER_JOB_SUFFIX = "getAndCommitPODCost"

# The fields the profile save is entitled to carry. Anything else offered to it
# is not part of a business profile and must not reach the document.
PROFILE_FIELDS = {
    "businessName",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "country",
    "postalCode",
    "supportEmail",
    "sendInvoiceEmail",
    "vatId",
    "customFields",
}


# ---------------------------------------------------------------------------
# the portal block, as every reader of a stored document normalises it
# ---------------------------------------------------------------------------


def normalise_pages(raw) -> dict:
    """The portal block a reader sees for a stored document.

    A page that was never recorded reads back as that page's own starting
    state, and a page recorded without a caption reads back with the standard
    one, so a save is compared against a normalised block rather than against
    whatever happened to be in the ledger.
    """
    stored = {}
    if isinstance(raw, str) and raw:
        try:
            stored = json.loads(raw)
        except json.JSONDecodeError:
            stored = {}
    elif isinstance(raw, dict):
        stored = raw

    pages: dict = {}
    for name, enabled_default, caption in (
        ("invoice", True, "Invoice"),
        ("payment", False, "Payment"),
        ("offering", False, "Plan"),
    ):
        page = stored.get(name)
        if isinstance(page, dict) and page:
            resolved = {
                "enabled": enabled_default if page.get("enabled") is None else page["enabled"],
                "text": page["text"] if page.get("text") else caption,
            }
            if name == "offering":
                if page.get("appearance") is not None:
                    resolved["appearance"] = page["appearance"]
                if page.get("offerings") is not None:
                    resolved["offerings"] = page["offerings"]
        else:
            resolved = {"enabled": enabled_default, "text": caption}
        pages[name] = resolved
    return pages


def deep_merge(target, source):
    """Folds a submitted block into a stored one, key by key.

    A nested block recurses. A plain value replaces what was there, except that
    an explicit null takes the entry out of the block altogether.
    """
    merged = json.loads(json.dumps(target)) if isinstance(target, dict) else {}
    if not isinstance(source, dict):
        return merged
    for key, value in source.items():
        if isinstance(value, dict):
            merged[key] = deep_merge(merged.get(key, {}), value)
        elif value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def merge_pages(stored: dict, submitted) -> dict:
    """The portal block after a save that mentions some part of it."""
    pages = json.loads(json.dumps(stored))
    if not isinstance(submitted, dict):
        return pages

    for name in ("invoice", "payment", "offering"):
        page = submitted.get(name)
        if not isinstance(page, dict) or not page:
            continue
        if page.get("text"):
            pages[name]["text"] = page["text"]
        if page.get("enabled") is not None:
            pages[name]["enabled"] = page["enabled"]

    offering = submitted.get("offering")
    if isinstance(offering, dict) and offering.get("appearance") is not None:
        pages["offering"]["appearance"] = deep_merge(
            pages["offering"].get("appearance", {}), offering["appearance"]
        )
    return pages


# ---------------------------------------------------------------------------
# reading the recorded ledger
# ---------------------------------------------------------------------------


def recorded_documents(scenario: dict) -> dict[str, dict]:
    """`{businessID: document}` as a reader of the ledger sees each business."""
    documents: dict[str, dict] = {}
    for rows in (scenario.get("influx") or {}).get("buckets", {}).values():
        for row in rows:
            tags = row.get("tags") or {}
            business_id = tags.get("businessID")
            if not business_id:
                continue
            document = dict(STARTING_VALUES)
            for field in GRADED_FIELDS:
                if tags.get(field) is not None:
                    document[field] = tags[field]
            document["businessName"] = (row.get("fields") or {}).get("businessName", "")
            document["pages"] = normalise_pages(tags.get("pages"))
            documents[business_id] = document
    return documents


def written_documents(ledger: dict, scenario: dict) -> dict[str, list[dict]]:
    """`{businessID: [document, ...]}` for the rows a run added, in order.

    A business's ledger opens with however many rows it was recorded with, so
    those are dropped from the front and what is left is exactly what the run
    put there.
    """
    already_there: dict[str, int] = {}
    for rows in (scenario.get("influx") or {}).get("buckets", {}).values():
        for row in rows:
            business_id = (row.get("tags") or {}).get("businessID")
            if business_id:
                already_there[business_id] = already_there.get(business_id, 0) + 1

    by_business: dict[str, list[dict]] = {}
    for rows in (ledger.get("buckets") or {}).values():
        for row in sorted(rows, key=lambda item: (item.get("time_ns", 0), item.get("seq", 0))):
            business_id = (row.get("tags") or {}).get("businessID")
            if business_id:
                by_business.setdefault(business_id, []).append(row)

    written: dict[str, list[dict]] = {}
    for business_id, rows in by_business.items():
        for row in rows[already_there.get(business_id, 0) :]:
            tags = row.get("tags") or {}
            document = dict(STARTING_VALUES)
            for field in GRADED_FIELDS:
                if tags.get(field) is not None:
                    document[field] = tags[field]
            document["businessName"] = (row.get("fields") or {}).get("businessName", "")
            document["pages"] = normalise_pages(tags.get("pages"))
            written.setdefault(business_id, []).append(document)
    return written


# ---------------------------------------------------------------------------
# the reference model
# ---------------------------------------------------------------------------


def apply_save(document: dict, step: dict) -> dict:
    """The document a business should carry once this save has been applied."""
    payload = step["payload"]
    if step["surface"] == "profile":
        payload = {key: value for key, value in payload.items() if key in PROFILE_FIELDS}

    expected = json.loads(json.dumps(document))
    for field in GRADED_FIELDS:
        if field in payload:
            expected[field] = payload[field]
    if step["surface"] != "profile" and isinstance(payload.get("pages"), dict):
        expected["pages"] = merge_pages(expected["pages"], payload["pages"])
    return expected


def expected_schedule(before: dict, after: dict, business_id: str) -> str:
    """Whether this save should start the hourly cluster-cost job, stop it, or
    leave it alone -- which turns on the cost source crossing the boundary."""
    was = before.get("computeCostSource") == CLUSTER_SOURCE
    now = after.get("computeCostSource") == CLUSTER_SOURCE
    if now and not was:
        return "start"
    if was and not now:
        return "stop"
    return "none"


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------


def as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def compare_document(label: str, source: str, expected: dict, actual: dict) -> list[str]:
    failures: list[str] = []
    for field in GRADED_FIELDS:
        want = as_text(expected.get(field))
        got = as_text(actual.get(field))
        if want != got:
            failures.append(f"{label}: {source} carries {field}={got!r}, expected {want!r}")

    want_pages = expected.get("pages") or {}
    got_pages = normalise_pages(actual.get("pages"))
    for name in ("invoice", "payment", "offering"):
        wanted = want_pages.get(name) or {}
        gotten = got_pages.get(name) or {}
        for key in sorted(set(wanted) | set(gotten)):
            if wanted.get(key) != gotten.get(key):
                failures.append(
                    f"{label}: {source} portal page {name}.{key} is "
                    f"{json.dumps(gotten.get(key))}, expected {json.dumps(wanted.get(key))}"
                )
    return failures


STOP_BOUND = re.compile(r"stop:\s*([0-9T:.\-]+Z)")

# How far a row's timestamp may sit ahead of the read-back that was meant to see
# it before the cause stops being the harness's own timing. The Influx client
# derives nanoseconds from a monotonic clock against a millisecond-granular
# origin sampled once per process, so it can lead the wall clock by around a
# millisecond. Anything further ahead than this is a submission stamping rows
# into the future, which is a wrong answer and is graded as one.
CLOCK_BIAS_CEILING_NS = 100_000_000


def _stop_ns(query: str) -> int | None:
    found = STOP_BOUND.search(query)
    if not found:
        return None
    try:
        stamp = datetime.strptime(found.group(1), "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        return None
    return int(stamp.replace(tzinfo=timezone.utc).timestamp() * 1e9)


def unobservable_read_backs(ledger: dict) -> list[str]:
    """Businesses whose read-back could not have seen the save it followed.

    The reader bounds its query at `stop: <now>` truncated to milliseconds, and a
    Flux range excludes its stop, so a row is only visible to a read-back whose
    stop is strictly past that row's timestamp. When it is not, the reader falls
    through to the business's previous row and serves a document the save did not
    produce -- which is the harness observing too early, not the submission
    answering wrongly. The driver leaves real time for this, so reaching here
    means that margin was lost anyway and the run cannot judge the submission.
    """
    newest: dict[str, int] = {}
    for rows in (ledger.get("buckets") or {}).values():
        for row in rows:
            business = (row.get("tags") or {}).get("businessID")
            if business:
                newest[business] = max(newest.get(business, 0), row.get("time_ns") or 0)

    # Each business is saved once, so the last query naming it is the read-back:
    # anything the save itself asked for happened before the save answered.
    last_read: dict[str, str] = {}
    for query in ledger.get("queries") or []:
        if "stop:" not in query:
            continue
        for business in newest:
            if business in query:
                last_read[business] = query

    stale: list[str] = []
    for business, written_at in newest.items():
        query = last_read.get(business)
        if not query:
            continue
        stop = _stop_ns(query)
        if stop is None:
            continue
        shortfall = written_at - stop
        if 0 <= shortfall <= CLOCK_BIAS_CEILING_NS:
            stale.append(f"{business} (row {shortfall / 1e6:.3f} ms past the read-back's bound)")
    return sorted(stale)


def read_body_document(body) -> dict | None:
    """The document out of whatever shape a read-back came back in."""
    candidate = body
    if isinstance(candidate, dict) and isinstance(candidate.get("data"), list):
        candidate = candidate["data"]
    if isinstance(candidate, list):
        candidate = candidate[0] if candidate else None
    if not isinstance(candidate, dict):
        return None
    return candidate


def compare_schedule(label: str, business_id: str, wanted: str, record: dict) -> list[str]:
    started = record.get("scheduled") or []
    stopped = record.get("unscheduled") or []
    job_id = f"{business_id}-{CLUSTER_JOB_SUFFIX}"

    def matching(calls) -> list:
        return [call for call in calls if isinstance(call, dict) and call.get("schedulerID") == job_id]

    if wanted == "start":
        if not matching(started):
            return [f"{label}: the hourly cluster-cost job was not started for {business_id}"]
        if matching(stopped):
            return [f"{label}: the hourly cluster-cost job was stopped as well as started"]
        return []
    if wanted == "stop":
        if not matching(stopped):
            return [f"{label}: the hourly cluster-cost job was not stopped for {business_id}"]
        if matching(started):
            return [f"{label}: the hourly cluster-cost job was started as well as stopped"]
        return []
    failures = []
    if matching(started):
        failures.append(f"{label}: the hourly cluster-cost job was started although nothing changed")
    if matching(stopped):
        failures.append(f"{label}: the hourly cluster-cost job was stopped although nothing changed")
    return failures


def grade(scenario: dict, spec: dict, observed: dict, ledger: dict) -> tuple[bool, list[str]]:
    if observed.get("fatal"):
        return False, [f"the run aborted before any save was made: {str(observed['fatal'])[:400]}"]

    records = observed.get("observed") or {}
    documents = recorded_documents(scenario)
    written = written_documents(ledger, scenario)
    seen_writes: dict[str, int] = {}
    failures: list[str] = []

    for step in spec["steps"]:
        label = step["label"]
        business_id = step["businessID"]
        record = records.get(label)
        if not isinstance(record, dict):
            failures.append(f"{label}: the save was never made")
            continue
        if record.get("saveStatus") not in (200, 201, 204):
            failures.append(
                f"{label}: the save answered {record.get('saveStatus')} "
                f"({json.dumps(record.get('saveBody'))[:200]})"
            )
            continue

        before = documents[business_id]
        after = apply_save(before, step)
        documents[business_id] = after

        index = seen_writes.get(business_id, 0)
        seen_writes[business_id] = index + 1
        rows = written.get(business_id) or []
        if index >= len(rows):
            failures.append(f"{label}: nothing was recorded in the configuration ledger for {business_id}")
        else:
            failures.extend(compare_document(label, "the recorded document", after, rows[index]))

        if record.get("readStatus") not in (200, 201):
            failures.append(f"{label}: reading the business back answered {record.get('readStatus')}")
        else:
            served = read_body_document(record.get("readBody"))
            if served is None:
                failures.append(f"{label}: reading the business back produced no document")
            else:
                failures.extend(compare_document(label, "the served document", after, served))

        failures.extend(compare_schedule(label, business_id, expected_schedule(before, after, business_id), record))

    return not failures, failures


# ---------------------------------------------------------------------------


HARNESS_NOTE = "HARNESS FAILURE: this run produced no verdict about the submission"


def emit(output_dir: str, reward: float, failures: list[str], note: str = "") -> None:
    os.makedirs(output_dir, exist_ok=True)
    # A run that produced no verdict has to be legible as one to whatever reads
    # the run later, not only in the report prose. The reward still fails closed.
    if note == HARNESS_NOTE:
        with open(os.path.join(output_dir, "harness-failure"), "w", encoding="utf-8") as handle:
            handle.write("\n".join(failures) + "\n")
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
    parser.add_argument("--harness")
    parser.add_argument("--scenario")
    parser.add_argument("--spec")
    parser.add_argument("--observed")
    parser.add_argument("--ledger")
    args = parser.parse_args()

    if args.fail:
        emit(args.output_dir, 0.0, [args.fail], note="harness precondition not met")
        return

    # A run that never got a working ledger says nothing about the submission.
    # The reward still fails closed, but it is labelled so that nobody later
    # reads it as evidence that a candidate answered wrongly.
    if args.harness:
        emit(
            args.output_dir,
            0.0,
            [args.harness],
            note=HARNESS_NOTE,
        )
        return

    for label, path in (
        ("scenario", args.scenario),
        ("spec", args.spec),
        ("observed", args.observed),
        ("ledger", args.ledger),
    ):
        if not path or not os.path.exists(path):
            emit(args.output_dir, 0.0, [f"the {label} file is missing"], note="nothing to score")
            return

    with open(args.scenario, encoding="utf-8") as handle:
        scenario = json.load(handle)
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)
    try:
        with open(args.observed, encoding="utf-8") as handle:
            observed = json.load(handle)
        with open(args.ledger, encoding="utf-8") as handle:
            ledger = json.load(handle)
    except json.JSONDecodeError:
        emit(args.output_dir, 0.0, ["the run produced no readable record"], note="nothing to score")
        return

    stale = unobservable_read_backs(ledger)
    if stale:
        emit(
            args.output_dir,
            0.0,
            [
                "the read-back was issued too early to see the save it followed, for: "
                + ", ".join(stale)
            ],
            note=HARNESS_NOTE,
        )
        return

    passed, failures = grade(scenario, spec, observed, ledger)
    emit(args.output_dir, 1.0 if passed else 0.0, failures)


if __name__ == "__main__":
    main()
