#!/usr/bin/env python3
"""Build the two worlds this task runs against.

`sandbox` is what the box serves while someone is working in it. `holdout` is
what the endpoint serves while the work is being judged, and shares no tenant,
no operator, no business and no credential with the sandbox, so nothing learned
by reading the sandbox names can be turned into a hard-coded answer.

Both worlds have the same *shape*: one tenant that keeps two environments side
by side, a second tenant whose credentials must stay out of the first tenant's
view, credentials the identity provider holds that no tenant has ever claimed,
and one credential whose configuration row was retired long ago. That shape is
what the grader distinguishes; the names are what it refuses to depend on.

Never copied into the image. Run it to regenerate:

    python3 gen_scenarios.py --out .
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

CONFIG_BUCKET = "local-config"
API_AUDIENCE = "https://example1234.execute-api.us-east-1.amazonaws.com"

USER_MEASUREMENT = "UserDataEnv"
ACTIVE_ENVIRONMENT_MEASUREMENT = "UserActiveEnvironment"

FULL_KEY_ADMIN = ["keys:read", "keys:update", "keys:delete"]
READ_ONLY = ["keys:read"]

BASE_TIME = "2024-02-05T09:00:00Z"
LATER_TIME = "2024-02-06T09:00:00Z"


def user_row(subject: str, business_id: str, environment: str, at: str, soft_delete: str | None = None) -> dict:
    tags = {"subject": subject, "businessID": business_id, "environment": environment}
    if soft_delete:
        tags["softDelete"] = soft_delete
    return {
        "measurement": USER_MEASUREMENT,
        "tags": tags,
        "fields": {"userStatus": "live"},
        "time": at,
    }


def active_environment_row(subject: str, environment: str, at: str) -> dict:
    return {
        "measurement": ACTIVE_ENVIRONMENT_MEASUREMENT,
        "tags": {"subject": subject},
        "fields": {"environment": environment},
        "time": at,
    }


def build(world: dict[str, Any]) -> dict[str, Any]:
    """Assemble one scenario document from a description of the tenants."""
    clients: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []

    clients.append(
        {
            "client_id": world["management_client_id"],
            "name": "MeteringCo Console Management",
            "client_secret": world["management_client_secret"],
            "management": True,
        }
    )

    for session in world["sessions"]:
        clients.append(
            {
                "client_id": session["client_id"],
                "name": session["name"],
                "client_secret": session["client_secret"],
                "app_type": "spa",
                "subject": session["subject"],
                "permissions": session["permissions"],
            }
        )

    for key in world["keys"]:
        clients.append(
            {
                "client_id": key["client_id"],
                "name": key["name"],
                "client_secret": key["client_secret"],
            }
        )
        if key.get("business_id"):
            rows.append(
                user_row(
                    f"{key['client_id']}@clients",
                    key["business_id"],
                    key["environment"],
                    key.get("at", BASE_TIME),
                    soft_delete=key.get("soft_delete"),
                )
            )
            rows.append(
                active_environment_row(
                    f"{key['client_id']}@clients", key["environment"], key.get("at", BASE_TIME)
                )
            )

    for operator in world["operators"]:
        for environment, business_id in operator["businesses"].items():
            rows.append(user_row(operator["subject"], business_id, environment, BASE_TIME))
        rows.append(active_environment_row(operator["subject"], operator["active_environment"], BASE_TIME))

    permissions = {
        f"{key['client_id']}@clients": list(key.get("permissions", []))
        for key in world["keys"]
        if key.get("permissions")
    }

    return {
        "region": "us-east-1",
        "accounts": [],
        "identity": {
            "api_audience": API_AUDIENCE,
            "clients": clients,
            "permissions": permissions,
        },
        "influx": {"buckets": {CONFIG_BUCKET: rows}},
    }


SANDBOX = {
    "management_client_id": "dashHarbourConsoleMgmt01",
    "management_client_secret": "console-management-secret-sandbox",
    "sessions": [
        {
            "client_id": "sessHarborlineConsole01",
            "name": "Harborline console sign-in",
            "client_secret": "harborline-console-secret",
            "subject": "auth0|opharborline77",
            "permissions": FULL_KEY_ADMIN,
        },
        {
            "client_id": "sessHarborlineViewer01",
            "name": "Harborline console sign-in, view only",
            "client_secret": "harborline-viewer-secret",
            "subject": "auth0|opharborline77",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "sessCrestfallConsole01",
            "name": "Crestfall console sign-in",
            "client_secret": "crestfall-console-secret",
            "subject": "auth0|opcrestfall41",
            "permissions": FULL_KEY_ADMIN,
        },
    ],
    "operators": [
        {
            "subject": "auth0|opharborline77",
            "businesses": {"production": "harborline", "sandbox": "harborline-sandbox"},
            "active_environment": "production",
        },
        {
            "subject": "auth0|opcrestfall41",
            "businesses": {"production": "crestfall", "sandbox": "crestfall-sandbox"},
            "active_environment": "production",
        },
    ],
    "keys": [
        {
            "client_id": "keyHarborlineProdIngest",
            "name": "Harborline production ingest",
            "client_secret": "harborline-prod-ingest-secret",
            "business_id": "harborline",
            "environment": "production",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "keyHarborlineProdReports",
            "name": "Harborline production reporting",
            "client_secret": "harborline-prod-reports-secret",
            "business_id": "harborline",
            "environment": "production",
        },
        {
            "client_id": "keyHarborlineSbxIngest",
            "name": "Harborline sandbox ingest",
            "client_secret": "harborline-sbx-ingest-secret",
            "business_id": "harborline-sandbox",
            "environment": "sandbox",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "keyHarborlineSbxReplay",
            "name": "Harborline sandbox replay",
            "client_secret": "harborline-sbx-replay-secret",
            "business_id": "harborline-sandbox",
            "environment": "sandbox",
        },
        {
            "client_id": "keyHarborlineProdRetired",
            "name": "Harborline production, retired",
            "client_secret": "harborline-prod-retired-secret",
            "business_id": "harborline",
            "environment": "production",
            "soft_delete": "deleted",
            "at": LATER_TIME,
        },
        {
            "client_id": "keyCrestfallProdIngest",
            "name": "Crestfall production ingest",
            "client_secret": "crestfall-prod-ingest-secret",
            "business_id": "crestfall",
            "environment": "production",
        },
        {
            "client_id": "keyCrestfallSbxIngest",
            "name": "Crestfall sandbox ingest",
            "client_secret": "crestfall-sbx-ingest-secret",
            "business_id": "crestfall-sandbox",
            "environment": "sandbox",
        },
        {
            "client_id": "appHarborlineStatusBoard",
            "name": "Harborline public status board",
            "client_secret": "harborline-status-board-secret",
        },
        {
            "client_id": "appMeteringCoMarketingSite",
            "name": "MeteringCo marketing site",
            "client_secret": "meteringco-marketing-site-secret",
        },
    ],
}

HOLDOUT = {
    "management_client_id": "dashWindermereConsoleMgmt02",
    "management_client_secret": "console-management-secret-holdout",
    "sessions": [
        {
            "client_id": "sessWindermereConsole02",
            "name": "Windermere console sign-in",
            "client_secret": "windermere-console-secret",
            "subject": "auth0|opwindermere93",
            "permissions": FULL_KEY_ADMIN,
        },
        {
            "client_id": "sessWindermereViewer02",
            "name": "Windermere console sign-in, view only",
            "client_secret": "windermere-viewer-secret",
            "subject": "auth0|opwindermere93",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "sessAshcombeConsole02",
            "name": "Ashcombe console sign-in",
            "client_secret": "ashcombe-console-secret",
            "subject": "auth0|opashcombe58",
            "permissions": FULL_KEY_ADMIN,
        },
    ],
    "operators": [
        {
            "subject": "auth0|opwindermere93",
            "businesses": {"production": "windermere", "sandbox": "windermere-sandbox"},
            "active_environment": "production",
        },
        {
            "subject": "auth0|opashcombe58",
            "businesses": {"production": "ashcombe", "sandbox": "ashcombe-sandbox"},
            "active_environment": "production",
        },
    ],
    "keys": [
        {
            "client_id": "keyWindermereProdEvents",
            "name": "Windermere production events",
            "client_secret": "windermere-prod-events-secret",
            "business_id": "windermere",
            "environment": "production",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "keyWindermereProdBilling",
            "name": "Windermere production billing",
            "client_secret": "windermere-prod-billing-secret",
            "business_id": "windermere",
            "environment": "production",
        },
        {
            "client_id": "keyWindermereSbxEvents",
            "name": "Windermere sandbox events",
            "client_secret": "windermere-sbx-events-secret",
            "business_id": "windermere-sandbox",
            "environment": "sandbox",
            "permissions": READ_ONLY,
        },
        {
            "client_id": "keyWindermereSbxDrill",
            "name": "Windermere sandbox drill",
            "client_secret": "windermere-sbx-drill-secret",
            "business_id": "windermere-sandbox",
            "environment": "sandbox",
        },
        {
            "client_id": "keyWindermereProdLegacy",
            "name": "Windermere production, retired",
            "client_secret": "windermere-prod-legacy-secret",
            "business_id": "windermere",
            "environment": "production",
            "soft_delete": "deleted",
            "at": LATER_TIME,
        },
        {
            "client_id": "keyAshcombeProdEvents",
            "name": "Ashcombe production events",
            "client_secret": "ashcombe-prod-events-secret",
            "business_id": "ashcombe",
            "environment": "production",
        },
        {
            "client_id": "keyAshcombeSbxEvents",
            "name": "Ashcombe sandbox events",
            "client_secret": "ashcombe-sbx-events-secret",
            "business_id": "ashcombe-sandbox",
            "environment": "sandbox",
        },
        {
            "client_id": "appWindermerePortalSite",
            "name": "Windermere customer portal",
            "client_secret": "windermere-portal-site-secret",
        },
        {
            "client_id": "appMeteringCoDocsSite",
            "name": "MeteringCo documentation site",
            "client_secret": "meteringco-docs-site-secret",
        },
    ],
}


def run_spec(world: dict[str, Any], tenant: dict[str, Any]) -> dict[str, Any]:
    """What the console would send, and nothing more.

    Deliberately free of expectations: it names the two sign-ins and the four
    credential ids somebody clicks on, and the grader works out for itself what
    each request should have done by reading the world.
    """
    admin = next(
        s for s in world["sessions"] if s["subject"] == tenant["operator"] and len(s["permissions"]) == 3
    )
    viewer = next(
        s for s in world["sessions"] if s["subject"] == tenant["operator"] and len(s["permissions"]) == 1
    )
    return {
        "managementClientId": world["management_client_id"],
        "managementClientSecret": world["management_client_secret"],
        "operator": {
            "subject": admin["subject"],
            "clientId": admin["client_id"],
            "clientSecret": admin["client_secret"],
        },
        "viewer": {
            "subject": viewer["subject"],
            "clientId": viewer["client_id"],
            "clientSecret": viewer["client_secret"],
        },
        "targets": {
            "rotate": tenant["rotate_in_sandbox"],
            "revoke": tenant["revoke_in_sandbox"],
            "otherEnvironment": tenant["production_only"],
            "otherTenant": tenant["foreign_key"],
            "unclaimed": tenant["unclaimed"],
            "retired": tenant["retired"],
        },
        "revokedKeyCredentials": tenant["revoked_key_credentials"],
    }


SANDBOX_TENANT = {
    "operator": "auth0|opharborline77",
    "rotate_in_sandbox": "keyHarborlineSbxReplay",
    "revoke_in_sandbox": "keyHarborlineSbxIngest",
    "production_only": "keyHarborlineProdIngest",
    "foreign_key": "keyCrestfallProdIngest",
    "unclaimed": "appMeteringCoMarketingSite",
    "retired": "keyHarborlineProdRetired",
    "revoked_key_credentials": {
        "clientId": "keyHarborlineSbxIngest",
        "clientSecret": "harborline-sbx-ingest-secret",
    },
}

HOLDOUT_TENANT = {
    "operator": "auth0|opwindermere93",
    "rotate_in_sandbox": "keyWindermereSbxDrill",
    "revoke_in_sandbox": "keyWindermereSbxEvents",
    "production_only": "keyWindermereProdEvents",
    "foreign_key": "keyAshcombeProdEvents",
    "unclaimed": "appMeteringCoDocsSite",
    "retired": "keyWindermereProdLegacy",
    "revoked_key_credentials": {
        "clientId": "keyWindermereSbxEvents",
        "clientSecret": "windermere-sbx-events-secret",
    },
}


SANDBOX_README = """This directory is the world the local endpoint serves while you are working.

It is one document. Everything the endpoint knows on startup comes from here:
the tenants, the people who sign in to the console, the machine credentials the
identity provider holds and the configuration rows the platform keeps for each
of them. You can read it, and you can watch it change by driving the API.

The world the deliverable is judged against is a different document with
different tenants, different people and different credentials.
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=".", help="task environment/ directory")
    args = parser.parse_args()

    sandbox_dir = os.path.join(args.out, "sandbox")
    verifier_dir = os.path.join(args.out, "verifier-data")
    os.makedirs(sandbox_dir, exist_ok=True)
    os.makedirs(verifier_dir, exist_ok=True)

    sandbox = build(SANDBOX)
    holdout = build(HOLDOUT)

    sandbox_ids = _identifiers(sandbox)
    holdout_ids = _identifiers(holdout)
    shared = sandbox_ids & holdout_ids
    if shared:
        raise SystemExit(f"sandbox and holdout share identifiers: {sorted(shared)}")

    _write(os.path.join(sandbox_dir, "public.json"), sandbox)
    _write(os.path.join(verifier_dir, "holdout.json"), holdout)
    _write(
        os.path.join(verifier_dir, "run-spec.json"),
        run_spec(HOLDOUT, HOLDOUT_TENANT),
    )
    with open(os.path.join(sandbox_dir, "README"), "w", encoding="utf-8") as handle:
        handle.write(SANDBOX_README)

    print(f"sandbox : {len(sandbox['identity']['clients'])} clients, "
          f"{len(sandbox['influx']['buckets'][CONFIG_BUCKET])} configuration rows")
    print(f"holdout : {len(holdout['identity']['clients'])} clients, "
          f"{len(holdout['influx']['buckets'][CONFIG_BUCKET])} configuration rows")


def _identifiers(scenario: dict[str, Any]) -> set[str]:
    found = {client["client_id"] for client in scenario["identity"]["clients"]}
    found |= {client["client_secret"] for client in scenario["identity"]["clients"]}
    for row in scenario["influx"]["buckets"][CONFIG_BUCKET]:
        found.add(row["tags"]["subject"])
        if "businessID" in row["tags"]:
            found.add(row["tags"]["businessID"])
    return found


def _write(path: str, payload: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


if __name__ == "__main__":
    main()
