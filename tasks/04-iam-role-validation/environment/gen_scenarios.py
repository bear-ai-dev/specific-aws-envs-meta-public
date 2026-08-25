#!/usr/bin/env python3
"""Build the two emulator worlds and the run spec that drives the graded save.

Both worlds are described by the same vocabulary -- a platform account that
holds the collector's own identity, and customer accounts that hold the roles a
customer might paste into the settings screen -- but they share no identifier
and are not the same size. The sandbox world is world-readable inside the box.
The held-out world and the run spec are readable only by root.

    python3 gen_scenarios.py --out-dir /tmp/scenarios
"""

from __future__ import annotations

import argparse
import json
import os

REGION = "us-east-1"

EC2_READ = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["ec2:Describe*", "cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics"],
            "Resource": ["*"],
        }
    ],
}

STORAGE_ONLY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["s3:GetObject", "s3:ListBucket", "sts:GetCallerIdentity"],
            "Resource": ["*"],
        }
    ],
}

BILLING_ONLY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["ce:GetCostAndUsage", "ce:GetDimensionValues", "sts:GetCallerIdentity"],
            "Resource": ["*"],
        }
    ],
}


def trust_platform(platform_account: str, external_id: str | None = None) -> dict:
    statement = {
        "Effect": "Allow",
        "Principal": {"AWS": f"arn:aws:iam::{platform_account}:root"},
        "Action": "sts:AssumeRole",
    }
    if external_id is not None:
        statement["Condition"] = {"StringEquals": {"sts:ExternalId": external_id}}
    return {"Version": "2012-10-17", "Statement": [statement]}


def trust_self(account_id: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"AWS": f"arn:aws:iam::{account_id}:root"},
                "Action": "sts:AssumeRole",
            }
        ],
    }


def trust_service(service: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": service},
                "Action": "sts:AssumeRole",
            }
        ],
    }


def instance(instance_id: str, instance_type: str, zone: str, tags: dict) -> dict:
    return {
        "instance_id": instance_id,
        "instance_type": instance_type,
        "availability_zone": zone,
        "state": "running",
        "launch_time": "2026-02-01T00:00:00Z",
        "tags": tags,
    }


def build_world(spec: dict) -> dict:
    """Turn the declarative account/role table into an emulator scenario."""
    platform = spec["platform_account"]
    accounts: list[dict] = [
        {
            "account_id": platform,
            "alias": spec["platform_alias"],
            "roles": [],
            "policies": [],
            "instances": [],
        }
    ]

    for raw in spec["customers"]:
        account_id = raw["account_id"]
        policies = []
        for name, document in raw.get("policies", {}).items():
            policies.append(
                {
                    "arn": f"arn:aws:iam::{account_id}:policy/{name}",
                    "name": name,
                    "document": document,
                }
            )
        roles = []
        for role in raw.get("roles", []):
            kind = role["trust"]
            if kind == "platform":
                trust = trust_platform(platform, role.get("external_id"))
            elif kind == "self":
                trust = trust_self(account_id)
            else:
                trust = trust_service(role.get("service", "ec2.amazonaws.com"))
            roles.append(
                {
                    "name": role["name"],
                    "trust_policy": trust,
                    "attached_policy_arns": [
                        f"arn:aws:iam::{account_id}:policy/{name}" for name in role.get("attached", [])
                    ],
                    "inline_policies": role.get("inline", {}),
                }
            )
        accounts.append(
            {
                "account_id": account_id,
                "alias": raw["alias"],
                "roles": roles,
                "policies": policies,
                "instances": raw.get("instances", []),
            }
        )

    return {
        "region": REGION,
        "bootstrap_identity": {
            "account_id": platform,
            "access_key_id": "LOCALMETERINGKEY14",
            "secret_access_key": "metering-secret",
        },
        "accounts": accounts,
    }


# ---------------------------------------------------------------------------
# the sandbox world: every kind of role the graded world contains, one each
# ---------------------------------------------------------------------------

SANDBOX = {
    "platform_account": "600000000042",
    "platform_alias": "meteringco-platform",
    "customers": [
        {
            "account_id": "300000000011",
            "alias": "northwind-prod",
            "policies": {
                "usage-collection": EC2_READ,
                "reports-only": STORAGE_ONLY,
                "spend-only": BILLING_ONLY,
            },
            "roles": [
                {
                    "name": "meteringco-usage-scraper",
                    "trust": "platform",
                    "external_id": "nw-7f31c2",
                    "attached": ["usage-collection"],
                },
                {
                    "name": "meteringco-open-scraper",
                    "trust": "platform",
                    "attached": ["usage-collection"],
                },
                {
                    "name": "meteringco-reports-reader",
                    "trust": "platform",
                    "external_id": "nw-a01b",
                    "attached": ["reports-only"],
                },
                {
                    "name": "meteringco-spend-reader",
                    "trust": "platform",
                    "attached": ["spend-only"],
                },
                {
                    "name": "deployment-pipeline",
                    "trust": "self",
                    "attached": ["usage-collection"],
                },
            ],
            "instances": [
                instance("i-0a11aa0011", "m6i.large", "us-east-1a", {"Name": "api-1"}),
                instance("i-0a11aa0012", "t3.medium", "us-east-1b", {"Name": "worker-1"}),
            ],
        },
        {
            "account_id": "300000000022",
            "alias": "northwind-staging",
            "policies": {"usage-collection": EC2_READ},
            "roles": [
                {
                    "name": "meteringco-staging-scraper",
                    "trust": "platform",
                    "external_id": "nw-stg-4410",
                    "inline": {"collector": EC2_READ},
                },
                {
                    "name": "meteringco-bare-role",
                    "trust": "platform",
                },
                {
                    "name": "ec2-instance-profile",
                    "trust": "service",
                    "service": "ec2.amazonaws.com",
                    "attached": ["usage-collection"],
                },
            ],
            "instances": [instance("i-0b22bb0021", "c6i.large", "us-east-1c", {"Name": "stg-api"})],
        },
    ],
}


# ---------------------------------------------------------------------------
# the graded world: same kinds, different names, four customer accounts
# ---------------------------------------------------------------------------

HOLDOUT = {
    "platform_account": "755000000019",
    "platform_alias": "meteringco-platform",
    "customers": [
        {
            "account_id": "411000000071",
            "alias": "veridian-prod",
            "policies": {"metering-read": EC2_READ, "invoice-archive": STORAGE_ONLY},
            "roles": [
                {
                    "name": "meteringco-metering",
                    "trust": "platform",
                    "external_id": "vd-9c41ab27",
                    "attached": ["metering-read"],
                },
                {
                    "name": "meteringco-metering-legacy",
                    "trust": "platform",
                    "attached": ["metering-read"],
                },
                {
                    "name": "meteringco-archive",
                    "trust": "platform",
                    "external_id": "vd-31ff00",
                    "attached": ["invoice-archive"],
                },
                {
                    "name": "terraform-apply",
                    "trust": "self",
                    "attached": ["metering-read"],
                },
            ],
            "instances": [
                instance("i-0d71dd0001", "m6i.xlarge", "us-east-1a", {"Name": "vd-api-1"}),
                instance("i-0d71dd0002", "m6i.xlarge", "us-east-1a", {"Name": "vd-api-2"}),
                instance("i-0d71dd0003", "r6i.large", "us-east-1b", {"Name": "vd-db"}),
            ],
        },
        {
            "account_id": "411000000082",
            "alias": "veridian-analytics",
            "policies": {"cost-explorer": BILLING_ONLY},
            "roles": [
                {
                    "name": "meteringco-cost-view",
                    "trust": "platform",
                    "external_id": "vd-an-7761",
                    "attached": ["cost-explorer"],
                },
                {
                    "name": "meteringco-empty",
                    "trust": "platform",
                    "external_id": "vd-an-0002",
                },
            ],
            "instances": [instance("i-0e82ee0001", "c6i.2xlarge", "us-east-1c", {"Name": "an-etl"})],
        },
        {
            "account_id": "411000000093",
            "alias": "kestrel-core",
            "policies": {"collector": EC2_READ},
            "roles": [
                {
                    "name": "meteringco-collector",
                    "trust": "platform",
                    "inline": {"inline-collector": EC2_READ},
                },
                {
                    "name": "meteringco-collector-guarded",
                    "trust": "platform",
                    "external_id": "ks-core-88f1",
                    "attached": ["collector"],
                },
                {
                    "name": "ci-runner",
                    "trust": "service",
                    "service": "codebuild.amazonaws.com",
                    "attached": ["collector"],
                },
            ],
            "instances": [
                instance("i-0f93ff0001", "t3.large", "us-east-1a", {"Name": "ks-web"}),
                instance("i-0f93ff0002", "t3.large", "us-east-1b", {"Name": "ks-web-2"}),
            ],
        },
        {
            "account_id": "411000000104",
            "alias": "kestrel-lab",
            "policies": {"collector": EC2_READ},
            "roles": [
                {
                    "name": "meteringco-lab",
                    "trust": "platform",
                    "external_id": "ks-lab-2f0a",
                    "attached": ["collector"],
                }
            ],
            "instances": [instance("i-0a04aa0001", "t3.small", "us-east-1a", {"Name": "lab-1"})],
        },
    ],
}


# ---------------------------------------------------------------------------
# the graded save sequence
# ---------------------------------------------------------------------------


def holdout_runs() -> list[dict]:
    """Saves are replayed in order against one business, and each one is judged
    on the status the endpoint answered with and the settings a caller can read
    back straight afterwards.

    A save that is turned away must leave the record exactly as it was, so a
    rejected payload always carries a plain field the previous accepted save
    already settled -- if the rejection was not clean, that field moves.
    """
    prod = "arn:aws:iam::411000000071:role"
    analytics = "arn:aws:iam::411000000082:role"
    core = "arn:aws:iam::411000000093:role"
    lab = "arn:aws:iam::411000000104:role"
    return [
        {
            "label": "connect-guarded-role",
            "body": {
                "businessName": "Veridian Systems",
                "city": "Portland",
                "cloudIAM": {"iamRoleArn": f"{prod}/meteringco-metering", "externalId": "vd-9c41ab27"},
            },
        },
        {
            "label": "wrong-external-id",
            "body": {
                "city": "Bend",
                "cloudIAM": {"iamRoleArn": f"{prod}/meteringco-metering", "externalId": "vd-9c41ab28"},
            },
        },
        {
            "label": "external-id-omitted",
            "body": {"cloudIAM": {"iamRoleArn": f"{prod}/meteringco-metering"}},
        },
        {
            "label": "unguarded-role-no-external-id",
            "body": {"cloudIAM": {"iamRoleArn": f"{prod}/meteringco-metering-legacy"}},
        },
        {
            "label": "unguarded-role-with-external-id",
            "body": {
                "cloudIAM": {"iamRoleArn": f"{prod}/meteringco-metering-legacy", "externalId": "vd-not-required"}
            },
        },
        {
            "label": "assumable-but-storage-only",
            "body": {
                "vatId": "OR-88112",
                "cloudIAM": {"iamRoleArn": f"{prod}/meteringco-archive", "externalId": "vd-31ff00"},
            },
        },
        {
            "label": "assumable-but-cost-only",
            "body": {
                "city": "Salem",
                "cloudIAM": {"iamRoleArn": f"{analytics}/meteringco-cost-view", "externalId": "vd-an-7761"},
            },
        },
        {
            "label": "assumable-but-no-policies",
            "body": {"cloudIAM": {"iamRoleArn": f"{analytics}/meteringco-empty", "externalId": "vd-an-0002"}},
        },
        {
            "label": "trusts-only-its-own-account",
            "body": {"vatId": "OR-11111", "cloudIAM": {"iamRoleArn": f"{prod}/terraform-apply"}},
        },
        {
            "label": "trusts-a-service-not-us",
            "body": {"cloudIAM": {"iamRoleArn": f"{core}/ci-runner"}},
        },
        {
            "label": "role-does-not-exist",
            "body": {"city": "Medford", "cloudIAM": {"iamRoleArn": f"{core}/meteringco-collector-typo"}},
        },
        {
            "label": "account-does-not-exist",
            "body": {"cloudIAM": {"iamRoleArn": "arn:aws:iam::411000000999:role/meteringco-collector"}},
        },
        {
            "label": "not-an-arn",
            "body": {"vatId": "OR-22222", "cloudIAM": {"iamRoleArn": "meteringco-collector"}},
        },
        {
            "label": "arn-of-a-user",
            "body": {"cloudIAM": {"iamRoleArn": "arn:aws:iam::411000000093:user/meteringco-collector"}},
        },
        {
            "label": "external-id-but-no-role",
            "body": {"city": "Astoria", "cloudIAM": {"externalId": "ks-core-88f1"}},
        },
        {
            "label": "inline-policy-role",
            "body": {"cloudIAM": {"iamRoleArn": f"{core}/meteringco-collector"}},
        },
        {
            "label": "guarded-role-in-another-account",
            "body": {
                "cloudIAM": {"iamRoleArn": f"{core}/meteringco-collector-guarded", "externalId": "ks-core-88f1"}
            },
        },
        {
            "label": "blank-role-clears",
            "body": {"cloudIAM": {"iamRoleArn": ""}},
        },
        {
            "label": "no-cloud-block-at-all",
            "body": {"city": "Eugene"},
        },
        {
            "label": "reconnect-lab-role",
            "body": {"cloudIAM": {"iamRoleArn": f"{lab}/meteringco-lab", "externalId": "ks-lab-2f0a"}},
        },
        {
            "label": "blank-role-drops-stale-external-id",
            "body": {"cloudIAM": {"iamRoleArn": "", "externalId": "ks-lab-2f0a"}},
        },
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    def write(name: str, payload: dict) -> None:
        path = os.path.join(args.out_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=False)
            handle.write("\n")
        print(f"wrote {path}")

    write("public.json", build_world(SANDBOX))
    write("holdout.json", build_world(HOLDOUT))
    write(
        "run-spec.json",
        {
            "businessID": "veridian-production",
            "subject": "auth0|verifier",
            "runs": holdout_runs(),
        },
    )


if __name__ == "__main__":
    main()
