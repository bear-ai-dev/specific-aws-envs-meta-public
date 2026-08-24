#!/usr/bin/env python3
"""Trusted scorer. Runs as root, loads no submitted code.

It reads the outbox the emulated endpoint wrote while the submission was being
driven -- the record of what actually left the process -- and compares it, as a
multiset, against what it derives itself from the held-out communications and
the account's suppression list. The submission never sees this file, the
held-out events, or the derived answer.

Nothing here consults an exit code, stdout, or anything the driver reported.
The driver's diagnostics exist so a run can be read afterwards; they are not an
input to the verdict.

Reward is binary: the wire matches exactly, or the run is worth nothing.
"""

# TEST_CASE_COVERAGE_START
# CASE event-01: sends a standard HTML invoice notice with the captured provider framing.
# CASE event-02: preserves Unicode subject and display-name content in an HTML message.
# CASE event-03: preserves a Unicode reply-to name and localized HTML body.
# CASE event-04: routes a plain-text payment receipt into the text part rather than HTML.
# CASE event-05: preserves a nondefault sender address and explicit plain-text selection.
# CASE event-06: sends only the first named customer and does not treat later data rows as fallbacks.
# CASE event-07: emits no provider message for a communication carrying no customer data.
# CASE event-08: emits no fallback delivery for a hard-bounced first recipient.
# CASE event-09: emits no fallback delivery when the first recipient is quarantined.
# CASE event-10: preserves Japanese display-name, subject, and HTML content on the wire.
# CASE event-11: preserves the captured convention when the sender display name is empty.
# CASE event-12: proves an accepted event after refusals is still delivered.
# TEST_CASE_COVERAGE_END

from __future__ import annotations

import argparse
import base64
import json
import os

FIELDS = ("source", "to", "cc", "bcc", "subject", "text", "html", "replyTo", "configurationSet")


# ---------------------------------------------------------------------------
# reference model
# ---------------------------------------------------------------------------


def encoded_word(text: str) -> str:
    """RFC 2047 base64 encoded-word, applied whatever the name contains."""
    return "=?UTF-8?B?" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "?="


def framing(email: dict) -> dict:
    """The wire form of one customer communication."""
    entry: dict = {
        "source": f"{encoded_word(email['fromName'])} <{email['fromEmail']}>",
        "to": [email["toEmail"]],
        "cc": [],
        "bcc": [],
        "subject": {"data": email["subject"], "charset": "UTF-8"},
        "text": None,
        "html": None,
        "replyTo": [f"{email['replyToName']} <{email['replyToEmail']}>"],
        "configurationSet": "defaultConfigurationSet",
    }
    part = {"data": email["content"], "charset": "UTF-8"}
    if email.get("html"):
        entry["html"] = part
    else:
        entry["text"] = part
    return entry


def expected(events: list[dict], suppressed: set[str]) -> list[dict]:
    """Every message that should reach the outbox, for a run over `events`."""
    out: list[dict] = []
    for event in events:
        data = event.get("data") or []
        if not data:
            # Nothing to draft from: no message, and the run carries on.
            continue
        email = data[0]
        if str(email.get("toEmail", "")).lower() in suppressed:
            # The endpoint refuses it, so it never reaches the outbox. The
            # rest of the event is not a fallback destination.
            continue
        out.append(framing(email))
    return out


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------


def part_of(value) -> dict | None:
    """Normalise one body or subject part, tolerating either absent shape."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return {"data": None, "charset": None}
    data = value.get("data")
    if data is None:
        return None
    return {"data": data, "charset": value.get("charset")}


def normalise(entry: dict) -> dict:
    """Reduce a wire record to what is being graded, with no guessing.

    An empty recipient list and an absent one are the same thing on this
    protocol, so both arrive here as an empty list. Nothing else is smoothed
    over: the display-name framing, the charsets, and which body part carries
    the content are all compared exactly as recorded.
    """
    return {
        "source": entry.get("source"),
        "to": list(entry.get("to") or []),
        "cc": list(entry.get("cc") or []),
        "bcc": list(entry.get("bcc") or []),
        "subject": part_of(entry.get("subject")),
        "text": part_of(entry.get("text")),
        "html": part_of(entry.get("html")),
        "replyTo": list(entry.get("replyTo") or []),
        "configurationSet": entry.get("configurationSet") or "",
    }


def key(entry: dict) -> str:
    return json.dumps(normalise(entry), sort_keys=True, ensure_ascii=False)


def describe(entry: dict) -> str:
    shape = normalise(entry)
    recipients = ",".join(shape["to"]) or "(nobody)"
    subject = (shape["subject"] or {}).get("data") or "(no subject)"
    body = "html" if shape["html"] else ("text" if shape["text"] else "no body")
    return (
        f"to={recipients} subject={subject!r} source={shape['source']!r} "
        f"replyTo={shape['replyTo']} body={body} configurationSet={shape['configurationSet']!r}"
    )


def counted(entries: list[dict]) -> dict[str, tuple[int, dict]]:
    out: dict[str, tuple[int, dict]] = {}
    for entry in entries:
        identity = key(entry)
        count, sample = out.get(identity, (0, entry))
        out[identity] = (count + 1, sample)
    return out


def grade(events: list[dict], suppressed: set[str], outbox: list[dict]) -> tuple[bool, list[str]]:
    failures: list[str] = []
    want = counted(expected(events, suppressed))
    got = counted(outbox)

    for identity, (count, sample) in sorted(want.items()):
        seen = got.get(identity, (0, None))[0]
        if seen == count:
            continue
        if seen == 0:
            failures.append(f"never sent: {describe(sample)}")
        else:
            failures.append(f"sent {seen} times, expected {count}: {describe(sample)}")
    for identity, (count, sample) in sorted(got.items()):
        if identity not in want:
            failures.append(f"should not have been sent: {describe(sample)}")

    total_want = sum(count for count, _ in want.values())
    total_got = sum(count for count, _ in got.values())
    if total_want != total_got and not failures:
        failures.append(f"the endpoint took {total_got} messages, expected {total_want}")
    return not failures, failures


# ---------------------------------------------------------------------------


def read_outbox(path: str) -> tuple[list[dict], str | None]:
    entries: list[dict] = []
    try:
        with open(path, encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    return entries, f"outbox line {number} is not readable"
                if not isinstance(parsed, dict):
                    return entries, f"outbox line {number} is not a message"
                entries.append(parsed)
    except FileNotFoundError:
        return [], "the endpoint recorded no outbox at all"
    return entries, None


def emit(output_dir: str, reward: float, failures: list[str], note: str = "") -> None:
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "reward.json"), "w", encoding="utf-8") as handle:
        json.dump({"reward": reward, "score": reward}, handle)
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
    parser.add_argument("--outbox")
    args = parser.parse_args()

    if args.fail:
        emit(args.output_dir, 0.0, [args.fail], note="harness precondition not met")
        return

    for label, path in (("scenario", args.scenario), ("spec", args.spec)):
        if not path or not os.path.exists(path):
            emit(args.output_dir, 0.0, [f"{label} file is missing"], note="nothing to score")
            return

    with open(args.scenario, encoding="utf-8") as handle:
        scenario = json.load(handle)
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)

    suppressed = {str(value).lower() for value in scenario.get("ses", {}).get("suppressed", [])}
    outbox, problem = read_outbox(args.outbox or "")

    passed, failures = grade(spec["events"], suppressed, outbox)
    if problem:
        failures.insert(0, problem)
        passed = False
    emit(args.output_dir, 1.0 if passed else 0.0, failures)


if __name__ == "__main__":
    main()
