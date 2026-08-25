#!/usr/bin/env python3
"""Trusted scorer. Runs as root, loads no submitted code.

It re-derives, straight from the held-out world document, which of the saved
settings payloads name a role the platform could really put to work -- one it
can assume as itself, under whatever external id the customer supplied, ending
up with credentials that can read the account's instance inventory -- and then
replays the same sequence of saves against that answer. What the submission
answered and what a caller could read back afterwards are compared against it.

The submission never sees this file, the world document, or the derived answers.

Reward is binary: every save lands the same way the reference says it should,
or the run is worth nothing.
"""

# TEST_CASE_COVERAGE_START
# CASE connect-guarded-role: accepts a role assumable with the supplied external ID and EC2 read access.
# CASE wrong-external-id: rejects a usable role when the supplied external ID is wrong.
# CASE external-id-omitted: rejects a guarded role when no external ID is supplied.
# CASE unguarded-role-no-external-id: accepts an assumable inventory role that needs no external ID.
# CASE unguarded-role-with-external-id: accepts the same unguarded role with an irrelevant supplied ID.
# CASE assumable-but-storage-only: rejects an assumable role lacking instance-inventory permission.
# CASE assumable-but-cost-only: rejects an assumable cost role lacking instance-inventory permission.
# CASE assumable-but-no-policies: rejects an assumable role with no effective inventory permission.
# CASE trusts-only-its-own-account: rejects a role that does not trust the platform account.
# CASE trusts-a-service-not-us: rejects a role whose trust principal is a service rather than the platform.
# CASE role-does-not-exist: rejects a well-formed ARN naming no role in the account.
# CASE account-does-not-exist: rejects a well-formed ARN naming an absent account.
# CASE not-an-arn: rejects malformed role input and preserves the previous settings atomically.
# CASE arn-of-a-user: rejects an IAM user ARN where a role ARN is required.
# CASE external-id-but-no-role: rejects a cloud-IAM block that supplies only an external ID.
# CASE inline-policy-role: accepts a role whose instance permission comes from an inline policy.
# CASE guarded-role-in-another-account: accepts a second account's guarded, inventory-capable role.
# CASE blank-role-clears: treats an explicit blank role as disconnect and clears the external ID.
# CASE no-cloud-block-at-all: permits a settings save that does not modify cloud-IAM configuration.
# CASE reconnect-lab-role: reconnects a valid role after the disconnect path.
# CASE blank-role-drops-stale-external-id: disconnects again without retaining the prior external ID.
# TEST_CASE_COVERAGE_END

from __future__ import annotations

import argparse
import fnmatch
import json
import os

# What the instance collector asks the customer's account for. A role that
# cannot answer this cannot be used to bill anyone, however cleanly it assumes.
COLLECTION_CALL = "ec2:DescribeInstances"


# ---------------------------------------------------------------------------
# reference model
# ---------------------------------------------------------------------------


def account_of(scenario: dict, account_id: str) -> dict | None:
    for account in scenario.get("accounts", []):
        if account["account_id"] == account_id:
            return account
    return None


def split_role_arn(arn: str) -> tuple[str, str] | None:
    """`(account, role name)` for a well-formed IAM role arn, else `None`."""
    parts = arn.split(":")
    if len(parts) != 6 or parts[0] != "arn" or parts[2] != "iam":
        return None
    resource = parts[5]
    if not resource.startswith("role/"):
        return None
    return parts[4], resource[len("role/") :]


def as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def trust_allows(statement: dict, platform_account: str) -> bool:
    if statement.get("Effect") != "Allow":
        return False
    if not any(
        fnmatch.fnmatchcase("sts:AssumeRole", pattern) for pattern in as_list(statement.get("Action"))
    ):
        return False
    principals = as_list((statement.get("Principal") or {}).get("AWS"))
    accepted = {
        f"arn:aws:iam::{platform_account}:root",
        platform_account,
        f"arn:aws:iam::{platform_account}:user/bootstrap",
        "*",
    }
    return any(principal in accepted for principal in principals)


def required_external_id(statement: dict) -> str | None:
    condition = statement.get("Condition") or {}
    for operator in ("StringEquals", "StringEqualsIgnoreCase", "StringLike"):
        clause = condition.get(operator) or {}
        for key, value in clause.items():
            if key.lower() == "sts:externalid":
                return value if isinstance(value, str) else (value[0] if value else None)
    return None


def can_be_assumed(role: dict, platform_account: str, external_id: str | None) -> bool:
    for statement in as_list((role.get("trust_policy") or {}).get("Statement")):
        if not trust_allows(statement, platform_account):
            continue
        wanted = required_external_id(statement)
        if wanted is None:
            return True
        if external_id is not None and external_id == wanted:
            return True
    return False


def effective_statements(account: dict, role: dict) -> list[dict]:
    documents = [
        policy["document"]
        for policy in account.get("policies", [])
        if policy["arn"] in role.get("attached_policy_arns", [])
    ]
    documents.extend((role.get("inline_policies") or {}).values())
    statements: list[dict] = []
    for document in documents:
        statements.extend(as_list(document.get("Statement")))
    return statements


def can_collect(account: dict, role: dict) -> bool:
    statements = effective_statements(account, role)
    if any(
        statement.get("Effect") == "Deny"
        and any(fnmatch.fnmatchcase(COLLECTION_CALL, p) for p in as_list(statement.get("Action")))
        for statement in statements
    ):
        return False
    return any(
        statement.get("Effect") == "Allow"
        and any(fnmatch.fnmatchcase(COLLECTION_CALL, p) for p in as_list(statement.get("Action")))
        for statement in statements
    )


def role_is_usable(scenario: dict, role_arn: str, external_id: str | None) -> bool:
    """Combine ARN, trust, external-ID, and permission checks for one role.

    A usable role must name a real role in a held-out account, trust the
    platform account for `sts:AssumeRole` under the supplied external ID, and
    grant the resulting session `ec2:DescribeInstances`. Passing only the trust
    half or only the permission half is deliberately insufficient.
    """
    platform_account = scenario["bootstrap_identity"]["account_id"]
    split = split_role_arn(role_arn)
    if split is None:
        return False
    account_id, role_name = split
    account = account_of(scenario, account_id)
    if account is None:
        return False
    role = next((r for r in account.get("roles", []) if r["name"] == role_name), None)
    if role is None:
        return False
    if not can_be_assumed(role, platform_account, external_id):
        return False
    return can_collect(account, role)


def expected_outcome(scenario: dict, body: dict) -> bool:
    """Return whether this individual settings payload should be saved.

    A payload with no cloud-IAM block is an ordinary settings update and needs
    no role validation. An explicit blank role is the disconnect operation and
    is also accepted. Any non-blank role must pass the complete usability check
    above; malformed, absent, unassumable, or under-permissioned roles are
    rejected atomically.
    """
    if "cloudIAM" not in body:
        return True
    cloud = body.get("cloudIAM") or {}
    role_arn = cloud.get("iamRoleArn")
    if role_arn == "":
        # Sending a blank role is how a customer disconnects; there is nothing
        # to prove, so it is always allowed.
        return True
    if not isinstance(role_arn, str):
        return False
    return role_is_usable(scenario, role_arn, cloud.get("externalId"))


def expected_state(scenario: dict, runs: list[dict]) -> list[tuple[bool, dict]]:
    """Replay the ordered saves into the exact expected settings timeline.

    For each run, `expected_outcome` first decides whether the payload is
    accepted. An accepted save replaces the readable settings fields with the
    normalized values from that payload. A blank role is normalized to a clean
    disconnect, so its external ID is cleared as well. A rejected save leaves
    the complete prior record untouched, which is how the verifier checks that
    validation happens before persistence rather than after a partial write.

    The output contains one `(accepted, state_snapshot)` pair per input run.
    `grade` uses the boolean to require HTTP 200 or 400, then compares the
    snapshot with the settings read back after that same save.
    """
    state = {"iamRoleArn": "", "externalId": "", "city": "", "vatId": ""}
    timeline: list[tuple[bool, dict]] = []
    for run in runs:
        body = run["body"]
        accepted = expected_outcome(scenario, body)
        if accepted:
            # Only accepted saves advance state. Rejections intentionally fall
            # through with the previous snapshot still intact.
            cloud = body.get("cloudIAM") or {}
            role_arn = cloud.get("iamRoleArn") or ""
            state = {
                "iamRoleArn": role_arn,
                # A disconnect leaves no external id behind either.
                "externalId": (cloud.get("externalId") or "") if role_arn else "",
                "city": body.get("city") or "",
                "vatId": body.get("vatId") or "",
            }
        # Copy the state so later accepted saves cannot mutate earlier expected
        # snapshots in the timeline.
        timeline.append((accepted, dict(state)))
    return timeline


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------


def grade(scenario: dict, spec: dict, observed: dict) -> tuple[bool, list[str]]:
    failures: list[str] = []
    if observed.get("fatal"):
        failures.append(f"the settings API never came up: {observed['fatal'][:400]}")
        return False, failures

    seen = observed.get("observations") or {}
    timeline = expected_state(scenario, spec["runs"])

    for run, (accepted, wanted) in zip(spec["runs"], timeline):
        label = run["label"]
        actual = seen.get(label)
        if actual is None:
            failures.append(f"{label}: no answer recorded")
            continue
        if actual.get("error"):
            failures.append(f"{label}: the save could not be sent ({actual['error']})")
            continue

        status = actual.get("status")
        if accepted and status != 200:
            failures.append(f"{label}: should have been saved, answered {status}")
        if not accepted and status != 400:
            failures.append(
                f"{label}: should have been turned away as a bad request, answered {status}"
            )

        if actual.get("readError"):
            failures.append(f"{label}: the settings could not be read back ({actual['readError']})")
            continue
        settings = actual.get("settings") or {}
        for field in ("iamRoleArn", "externalId", "city", "vatId"):
            got = settings.get(field, "")
            if got != wanted[field]:
                failures.append(
                    f"{label}: {field} reads back as {got!r}, the record should hold {wanted[field]!r}"
                )

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
