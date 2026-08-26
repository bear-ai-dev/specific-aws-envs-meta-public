#!/usr/bin/env python3
"""Decide the reward from what left the box.

Runs as root, loads no submitted code, and re-derives every expectation from
the world document the endpoint was started with. Two things are read: the
transcript of the console session, which says what each request answered, and
the endpoint's own final state, which says what actually changed at the
identity provider and in the configuration store.

Reward is 1.0 only when every rule holds. It is written last; a zero was
already on disk before this ran.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any, Iterable

CONFIG_BUCKET = "local-config"
USER_MEASUREMENT = "UserDataEnv"


# ---------------------------------------------------------------------------
# reading the world
# ---------------------------------------------------------------------------


def latest_rows_by_subject(rows: Iterable[dict[str, Any]], business_id: str | None) -> dict[str, dict[str, Any]]:
    """The configuration row that is in force for each identity.

    The store is append-only, so the row that counts is the newest one, and a
    row that carries a retirement marker means the identity is no longer
    configured at all. Filtering by business first matters: one person holds a
    separate row per environment.
    """
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("measurement") != USER_MEASUREMENT:
            continue
        tags = row.get("tags") or {}
        if business_id is not None and tags.get("businessID") != business_id:
            continue
        subject = tags.get("subject")
        if not subject:
            continue
        current = latest.get(subject)
        if current is None or str(row.get("time", "")) >= str(current.get("time", "")):
            latest[subject] = row
    return latest


def members(rows: Iterable[dict[str, Any]], business_id: str) -> set[str]:
    out = set()
    for subject, row in latest_rows_by_subject(rows, business_id).items():
        if (row.get("tags") or {}).get("softDelete") == "deleted":
            continue
        out.add(subject)
    return out


def scenario_rows(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    return list(scenario.get("influx", {}).get("buckets", {}).get(CONFIG_BUCKET, []))


def snapshot_rows(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalise the endpoint's final ledger into the scenario's row shape."""
    out = []
    for row in snapshot.get("influx", {}).get("buckets", {}).get(CONFIG_BUCKET, []):
        out.append(
            {
                "measurement": row.get("measurement"),
                "tags": row.get("tags") or {},
                "fields": row.get("fields") or {},
                "time": row.get("time") or row.get("_time") or "",
            }
        )
    return out


def credentials_for(scenario: dict[str, Any], rows: Iterable[dict[str, Any]], business_id: str) -> set[str]:
    """The machine credentials an account holds in one environment."""
    known = {client["client_id"] for client in scenario["identity"]["clients"]}
    out = set()
    for subject in members(rows, business_id):
        if not subject.endswith("@clients"):
            continue
        client_id = subject[: -len("@clients")]
        if client_id in known:
            out.add(client_id)
    return out


def business_for_operator(rows: Iterable[dict[str, Any]], subject: str, environment: str) -> str | None:
    for row in rows:
        tags = row.get("tags") or {}
        if (
            row.get("measurement") == USER_MEASUREMENT
            and tags.get("subject") == subject
            and tags.get("environment") == environment
        ):
            return tags.get("businessID")
    return None


# ---------------------------------------------------------------------------
# reading the transcript
# ---------------------------------------------------------------------------


def strings_in(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, str):
        found.add(value)
    elif isinstance(value, dict):
        for item in value.values():
            found |= strings_in(item)
    elif isinstance(value, list):
        for item in value:
            found |= strings_in(item)
    return found


class Transcript:
    def __init__(self, observed: dict[str, Any]) -> None:
        self.booted = bool(observed.get("booted"))
        self.by_label = {entry["label"]: entry for entry in observed.get("exchanges", [])}

    def status(self, label: str) -> int:
        return int(self.by_label.get(label, {}).get("status") or 0)

    def ok(self, label: str) -> bool:
        return 200 <= self.status(label) < 300

    def refused(self, label: str) -> bool:
        return 400 <= self.status(label) < 500

    def identifiers(self, label: str, universe: set[str]) -> set[str]:
        entry = self.by_label.get(label)
        if entry is None:
            return set()
        return strings_in(entry.get("json")) & universe


# ---------------------------------------------------------------------------
# the rules
# ---------------------------------------------------------------------------


def evaluate(scenario: dict[str, Any], spec: dict[str, Any], observed: dict[str, Any], snapshot: dict[str, Any]):
    rules: list[tuple[str, bool, str]] = []

    def rule(name: str, passed: bool, detail: str = "") -> None:
        rules.append((name, bool(passed), detail))

    start_rows = scenario_rows(scenario)
    final_rows = snapshot_rows(snapshot)
    universe = {client["client_id"] for client in scenario["identity"]["clients"]}
    start_clients = {client["client_id"]: client for client in scenario["identity"]["clients"]}
    final_clients = snapshot.get("identity", {}).get("clients", {})

    operator = spec["operator"]["subject"]
    production = business_for_operator(start_rows, operator, "production")
    sandbox = business_for_operator(start_rows, operator, "sandbox")

    expected_production = credentials_for(scenario, start_rows, production)
    expected_sandbox = credentials_for(scenario, start_rows, sandbox)

    targets = spec["targets"]
    rotate_id = targets["rotate"]
    revoke_id = targets["revoke"]

    transcript = Transcript(observed)

    if not transcript.booted:
        return [("the deliverable answered on its port", False, "no HTTP exchange completed")], 0.0

    # 1. What the account holds, where the operator is standing.
    listed_production = transcript.identifiers("list.production", universe)
    rule(
        "the credential listing is the account's own, in the environment the operator is in",
        transcript.ok("list.production") and listed_production == expected_production,
        f"status={transcript.status('list.production')} saw={sorted(listed_production)} "
        f"expected={sorted(expected_production)}",
    )

    # 2. Moving between environments changes what the same person sees.
    listed_sandbox = transcript.identifiers("list.sandbox", universe)
    rule(
        "changing environment changes the account the request resolves to",
        transcript.ok("switch.sandbox") and transcript.ok("list.sandbox") and listed_sandbox == expected_sandbox,
        f"switch={transcript.status('switch.sandbox')} list={transcript.status('list.sandbox')} "
        f"saw={sorted(listed_sandbox)} expected={sorted(expected_sandbox)}",
    )

    # 3. Rotation replaces the secret in place and touches nothing else.
    rotated = final_clients.get(rotate_id, {})
    started_with = start_clients.get(rotate_id, {}).get("client_secret")
    other_secrets_held = {
        client_id: entry.get("client_secret")
        for client_id, entry in final_clients.items()
        if client_id != rotate_id
    }
    unchanged_elsewhere = all(
        other_secrets_held.get(client_id) == client.get("client_secret")
        for client_id, client in start_clients.items()
        if client_id in other_secrets_held
    )
    rule(
        "rotating a credential replaces its secret and leaves every other credential alone",
        transcript.ok("rotate.sandbox")
        and bool(rotated)
        and rotated.get("client_secret") not in (None, started_with)
        and unchanged_elsewhere,
        f"status={transcript.status('rotate.sandbox')} rotated_present={bool(rotated)} "
        f"secret_changed={bool(rotated) and rotated.get('client_secret') != started_with} "
        f"others_untouched={unchanged_elsewhere}",
    )

    # 4. Revocation removes the credential and retires its configuration row.
    revoked_rows = latest_rows_by_subject(final_rows, None).get(f"{revoke_id}@clients", {})
    revoked_retired = (revoked_rows.get("tags") or {}).get("softDelete") == "deleted"
    rule(
        "revoking a credential removes it and retires the configuration behind it",
        transcript.ok("revoke.sandbox") and revoke_id not in final_clients and revoked_retired,
        f"status={transcript.status('revoke.sandbox')} still_at_provider={revoke_id in final_clients} "
        f"row_retired={revoked_retired}",
    )

    # 5. A bearer token for a revoked credential stops being accepted.
    rule(
        "a revoked credential stops being able to reach the API at once",
        transcript.ok("key.beforeRevocation") and not transcript.ok("key.afterRevocation"),
        f"before={transcript.status('key.beforeRevocation')} after={transcript.status('key.afterRevocation')}",
    )

    # 6. Nothing outside the caller's current account can be reached, and no
    #    attempt to reach it leaves a mark.
    out_of_reach = {
        "rotate.otherTenant": targets["otherTenant"],
        "revoke.unclaimed": targets["unclaimed"],
        "rotate.retired": targets["retired"],
        "rotate.otherEnvironment": targets["otherEnvironment"],
        "revoke.otherEnvironment": targets["otherEnvironment"],
    }
    refused = {label: transcript.status(label) for label in out_of_reach}
    survived = {
        client_id: (
            client_id in final_clients
            and final_clients[client_id].get("client_secret") == start_clients[client_id]["client_secret"]
        )
        for client_id in set(out_of_reach.values())
    }
    rule(
        "a credential outside the caller's current account can be neither read nor changed",
        all(400 <= status < 500 for status in refused.values()) and all(survived.values()),
        f"statuses={refused} untouched={survived}",
    )

    # 7. Looking is not changing.
    rule(
        "a sign-in that may only read cannot rotate or revoke",
        transcript.ok("viewer.list")
        and transcript.refused("viewer.rotate")
        and transcript.refused("viewer.revoke"),
        f"list={transcript.status('viewer.list')} rotate={transcript.status('viewer.rotate')} "
        f"revoke={transcript.status('viewer.revoke')}",
    )

    # 8. Work done in one environment is invisible in the other.
    listed_again = transcript.identifiers("list.productionAgain", universe)
    rule(
        "work done in one environment leaves the other environment's credentials as they were",
        transcript.ok("switch.production")
        and transcript.ok("list.productionAgain")
        and listed_again == expected_production,
        f"switch={transcript.status('switch.production')} saw={sorted(listed_again)} "
        f"expected={sorted(expected_production)}",
    )

    reward = 1.0 if all(passed for _, passed, _ in rules) else 0.0
    return rules, reward


# ---------------------------------------------------------------------------


def write_reward(output_dir: str, reward: float, rules, note: str = "", harness_failure: bool = False) -> None:
    os.makedirs(output_dir, exist_ok=True)
    payload = {
        "reward": reward,
        "score": reward,
        "note": note,
        # A run whose infrastructure never came up is not a submission that got
        # the behaviour wrong. Both score zero, and only this flag tells them
        # apart afterwards.
        "harness_failure": harness_failure,
        "rules": [{"rule": name, "passed": passed, "detail": detail} for name, passed, detail in rules],
    }
    with open(os.path.join(output_dir, "reward.json"), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    with open(os.path.join(output_dir, "reward.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"{reward}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--scenario")
    parser.add_argument("--spec")
    parser.add_argument("--observed")
    parser.add_argument("--snapshot")
    parser.add_argument("--fail", help="record a zero with this explanation and stop")
    parser.add_argument(
        "--harness-failure",
        help="record a zero that is explicitly the infrastructure's fault rather than the submission's",
    )
    args = parser.parse_args()

    if args.harness_failure:
        write_reward(args.output_dir, 0.0, [], f"harness: {args.harness_failure}", harness_failure=True)
        return

    if args.fail:
        write_reward(args.output_dir, 0.0, [], args.fail)
        return

    missing = [
        name
        for name, path in (
            ("scenario", args.scenario),
            ("spec", args.spec),
            ("observed", args.observed),
            ("snapshot", args.snapshot),
        )
        if not path or not os.path.exists(path)
    ]
    if missing:
        # Nothing to read is nothing to judge. A submission that gets the
        # behaviour wrong still produces a transcript and a final state; when
        # those are absent it is this harness that failed, and recording it as a
        # wrong answer would make the two indistinguishable.
        write_reward(
            args.output_dir,
            0.0,
            [],
            f"harness: nothing to grade, {', '.join(missing)} absent",
            harness_failure=True,
        )
        print(f"HARNESS FAILURE: {', '.join(missing)} absent")
        return

    scenario = json.load(open(args.scenario, encoding="utf-8"))
    spec = json.load(open(args.spec, encoding="utf-8"))
    observed = json.load(open(args.observed, encoding="utf-8"))
    snapshot = json.load(open(args.snapshot, encoding="utf-8"))

    # A submission that starts and then refuses the graded routes is a wrong
    # answer. A run where the application answered nothing at all, including a
    # route this task never touches, is the infrastructure's failure and is
    # recorded as one: the two are otherwise indistinguishable in the numbers.
    started = observed.get("booted")
    answered = observed.get("reachable", True)
    every_call_failed = bool(observed.get("exchanges")) and all(
        not exchange.get("status") for exchange in observed["exchanges"]
    )
    if started and not answered and every_call_failed:
        write_reward(
            args.output_dir,
            0.0,
            [],
            "harness: the application answered nothing at all, not even the untouched health route",
            harness_failure=True,
        )
        print("HARNESS FAILURE: the application answered nothing at all")
        return

    rules, reward = evaluate(scenario, spec, observed, snapshot)
    for name, passed, detail in rules:
        print(f"[{'PASS' if passed else 'FAIL'}] {name}")
        if not passed and detail:
            print(f"         {detail}")
    write_reward(args.output_dir, reward, rules)
    print(f"reward: {reward}")


if __name__ == "__main__":
    main()
