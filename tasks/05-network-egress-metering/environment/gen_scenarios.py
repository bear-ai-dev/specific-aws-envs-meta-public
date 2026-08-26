#!/usr/bin/env python3
"""Build the sandbox estate, the held-out estate and the recorded prior output.

Two estates, no shared identifier between them: different metering account,
different metered account, different business, different dimensions, different
customers, different machines, different byte magnitudes.

Both are written as `mockaws` scenario documents. Metric observations are
declared as `points_from_anchor`, offsets in seconds from the most recent
five-minute boundary, so one document keeps its shape whenever it is served:
the readings are always a few minutes old relative to whoever is asking.

The recorded prior output shipped in the sandbox is derived by
`tests/compute_reward.py`'s own reference model, imported here rather than
reimplemented, so the worked example a solver reads and the answer the verifier
grades cannot disagree.

This file never enters the task image. It produces the held-out estate and the
run programme, which is to say the graded steps and their expected outcomes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REGION = "us-east-1"

# The billable observations sit in the five-minute bucket that ends five minutes
# before the anchor, which is where a metric published a few minutes ago lands.
# Any collection window reaching back past this and not confined to the freshest
# few minutes sees the whole of it, whatever its exact length.
SETTLED_SPAN = (-355, -305)
# A reading a full day old. Present so that a machine can have a metric history
# and still have published nothing recent, which is not the same thing as a
# machine that has never published at all.
STALE_SPAN = (-93600, -93550)


def spread(total: float, count: int, span: tuple[int, int]) -> list[list[float]]:
    """`count` observations inside `span`, summing to `total`."""
    first, last = span
    step = (last - first) / max(1, count - 1) if count > 1 else 0
    offsets = [round(first + step * index) for index in range(count)]
    if total == 0:
        values = [0.0] * count
    else:
        # Deliberately uneven, so a total cannot be mistaken for a multiple of
        # any single observation and the observation count varies per machine.
        weights = [3, 3, 3, 2, 2, 1][:count]
        scale = total / sum(weights)
        values = [weight * scale for weight in weights]
        values[-1] = total - sum(values[:-1])
    return [[float(offset), float(value)] for offset, value in zip(offsets, values)]


def machine(
    instance_id: str,
    *,
    state: str,
    instance_type: str,
    tags: dict[str, str],
    egress: float | None,
    ingress: float,
    samples: int = 4,
    stale: bool = False,
) -> tuple[dict, list[dict]]:
    """One machine plus the metric series it publishes.

    `egress=None` means the machine has never published a transmitted-bytes
    series at all. `stale=True` means it has one, but nothing in it is recent.
    """
    instance = {
        "instance_id": instance_id,
        "instance_type": instance_type,
        "availability_zone": f"{REGION}a",
        "state": state,
        "tags": tags,
        "launch_time": "2026-07-14T09:12:00Z",
    }
    series: list[dict] = []
    if egress is not None:
        series.append(
            {
                "namespace": "AWS/EC2",
                "metric_name": "NetworkOut",
                "dimensions": {"InstanceId": instance_id},
                "unit": "Bytes",
                "points_from_anchor": spread(egress, samples, STALE_SPAN if stale else SETTLED_SPAN),
            }
        )
    # Received bytes always exist and never match transmitted bytes, so a
    # collector reading the wrong direction produces a full set of wrong figures
    # rather than nothing at all.
    series.append(
        {
            "namespace": "AWS/EC2",
            "metric_name": "NetworkIn",
            "dimensions": {"InstanceId": instance_id},
            "unit": "Bytes",
            "points_from_anchor": spread(ingress, 4, SETTLED_SPAN),
        }
    )
    series.append(
        {
            "namespace": "AWS/EC2",
            "metric_name": "NetworkPacketsOut",
            "dimensions": {"InstanceId": instance_id},
            "unit": "Count",
            "points_from_anchor": spread(max(1.0, (egress or 0.0) / 1400.0), 4, SETTLED_SPAN),
        }
    )
    return instance, series


def estate(
    *,
    metering_account: str,
    metered_account: str,
    alias: str,
    role_name: str,
    external_id: str,
    access_key_id: str,
    secret_access_key: str,
    machines: list[tuple[dict, list[dict]]],
) -> dict:
    instances = [entry[0] for entry in machines]
    metrics = [series for entry in machines for series in entry[1]]
    return {
        "region": REGION,
        # Relative observations hang off the most recent five-minute boundary.
        "metric_anchor_seconds": 300,
        "bootstrap_identity": {
            "account_id": metering_account,
            "access_key_id": access_key_id,
            "secret_access_key": secret_access_key,
        },
        "accounts": [
            {
                "account_id": metering_account,
                "alias": "meteringco-metering",
                "roles": [],
            },
            {
                "account_id": metered_account,
                "alias": alias,
                "roles": [
                    {
                        "name": role_name,
                        "trust_policy": {
                            "Version": "2012-10-17",
                            "Statement": [
                                {
                                    "Effect": "Allow",
                                    "Action": "sts:AssumeRole",
                                    "Principal": {"AWS": f"arn:aws:iam::{metering_account}:root"},
                                    "Condition": {"StringEquals": {"sts:ExternalId": external_id}},
                                }
                            ],
                        },
                        "inline_policies": {
                            "read-metrics": {
                                "Version": "2012-10-17",
                                "Statement": [
                                    {
                                        "Effect": "Allow",
                                        "Action": [
                                            "ec2:DescribeInstances",
                                            "cloudwatch:GetMetricData",
                                            "cloudwatch:GetMetricStatistics",
                                            "cloudwatch:ListMetrics",
                                        ],
                                        "Resource": ["*"],
                                    }
                                ],
                            }
                        },
                    }
                ],
                "instances": instances,
                "metrics": metrics,
            },
        ],
    }


# ---------------------------------------------------------------------------
# the sandbox estate
# ---------------------------------------------------------------------------

SANDBOX_METERING = "900000000001"
SANDBOX_METERED = "100000000031"
SANDBOX_ROLE = "meteringco-egress-reader"
SANDBOX_EXTERNAL_ID = "nw-sbx-4417"
SANDBOX_BUSINESS = "biz-northwind"
SANDBOX_DIMENSION = "dim_sbx_egress"
SANDBOX_OTHER_DIMENSION = "dim_sbx_archive"


def sandbox_machines() -> list[tuple[dict, list[dict]]]:
    d, other = SANDBOX_DIMENSION, SANDBOX_OTHER_DIMENSION
    return [
        machine(
            "i-0sbx000000000001",
            state="running",
            instance_type="m5.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_harborlight", "Name": "edge-01"},
            egress=4_000_000,
            ingress=11_500_000,
            samples=5,
        ),
        machine(
            "i-0sbx000000000002",
            state="running",
            instance_type="m5.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_harborlight", "Name": "edge-02"},
            egress=2_500_000,
            ingress=7_250_000,
        ),
        machine(
            "i-0sbx000000000003",
            state="stopped",
            instance_type="c6i.xlarge",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_glasswing", "Name": "batch-01"},
            egress=1_750_000,
            ingress=980_000,
            samples=3,
        ),
        machine(
            "i-0sbx000000000004",
            state="running",
            instance_type="t3.medium",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_pellucid", "Name": "relay-01"},
            egress=None,
            ingress=64_000,
        ),
        machine(
            "i-0sbx000000000005",
            state="running",
            instance_type="t3.small",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_marlinspike", "Name": "idle-01"},
            egress=0,
            ingress=17_500,
        ),
        machine(
            "i-0sbx000000000006",
            state="running",
            instance_type="t3.large",
            tags={"meteringcoDimensionId": f"{d},{other}", "meteringcoCustomerId": "cus_stanchion", "Name": "shared-01"},
            egress=250_000,
            ingress=1_120_000,
        ),
        machine(
            "i-0sbx000000000007",
            state="running",
            instance_type="t3.large",
            tags={"meteringcoDimensionId": other, "meteringcoCustomerId": "cus_offledger", "Name": "archive-01"},
            egress=3_300_000,
            ingress=410_000,
        ),
        machine(
            "i-0sbx000000000008",
            state="running",
            instance_type="m5.large",
            tags={"meteringcoDimensionId": d, "Name": "unassigned-01"},
            egress=1_900_000,
            ingress=520_000,
        ),
        machine(
            "i-0sbx000000000009",
            state="running",
            instance_type="m5.xlarge",
            tags={"Name": "platform-jenkins"},
            egress=6_400_000,
            ingress=8_800_000,
        ),
        machine(
            "i-0sbx000000000010",
            state="running",
            instance_type="t3.medium",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_pellucid", "Name": "relay-02"},
            egress=2_750_000,
            ingress=88_000,
            stale=True,
        ),
        machine(
            "i-0sbx000000000011",
            state="terminated",
            instance_type="c6i.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_windlass", "Name": "burst-01"},
            egress=640_000,
            ingress=225_000,
        ),
        machine(
            "i-0sbx000000000012",
            state="running",
            instance_type="c6i.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_windlass", "Name": "burst-02"},
            egress=None,
            ingress=96_000,
        ),
    ]


# ---------------------------------------------------------------------------
# the held-out estate
# ---------------------------------------------------------------------------

HOLDOUT_METERING = "900000000009"
HOLDOUT_METERED = "200000000077"
HOLDOUT_ROLE = "meteringco-transfer-reader"
HOLDOUT_EXTERNAL_ID = "tes-hld-8821"
HOLDOUT_BUSINESS = "biz-tessellate"
HOLDOUT_DIMENSION = "dim_hld_transfer"
HOLDOUT_OTHER_DIMENSION = "dim_hld_replica"


def holdout_machines() -> list[tuple[dict, list[dict]]]:
    d, other = HOLDOUT_DIMENSION, HOLDOUT_OTHER_DIMENSION
    return [
        machine(
            "i-0hld000000000101",
            state="running",
            instance_type="m6i.2xlarge",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_ravelin", "Name": "gateway-a"},
            egress=7_340_032,
            ingress=19_922_944,
            samples=5,
        ),
        machine(
            "i-0hld000000000102",
            state="running",
            instance_type="m6i.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_ravelin", "Name": "gateway-b"},
            egress=1_048_576,
            ingress=4_194_304,
        ),
        machine(
            "i-0hld000000000103",
            state="stopped",
            instance_type="r6i.xlarge",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_bastion", "Name": "extract-a"},
            egress=3_145_728,
            ingress=1_572_864,
            samples=3,
        ),
        machine(
            "i-0hld000000000104",
            state="running",
            instance_type="t3.small",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_kestrelmoor", "Name": "probe-a"},
            egress=None,
            ingress=131_072,
        ),
        machine(
            "i-0hld000000000105",
            state="running",
            instance_type="t3.small",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_solenoid", "Name": "parked-a"},
            egress=0,
            ingress=26_624,
        ),
        machine(
            "i-0hld000000000106",
            state="running",
            instance_type="c6i.2xlarge",
            tags={"meteringcoDimensionId": f"{other},{d}", "meteringcoCustomerId": "cus_tallow", "Name": "shared-a"},
            egress=524_288,
            ingress=2_097_152,
        ),
        machine(
            "i-0hld000000000107",
            state="running",
            instance_type="c6i.large",
            tags={"meteringcoDimensionId": other, "meteringcoCustomerId": "cus_ferrule", "Name": "mirror-a"},
            egress=393_216,
            ingress=786_432,
        ),
        machine(
            "i-0hld000000000108",
            state="running",
            instance_type="m6i.large",
            tags={"meteringcoDimensionId": d, "Name": "staging-a"},
            egress=5_242_880,
            ingress=1_310_720,
        ),
        machine(
            "i-0hld000000000109",
            state="running",
            instance_type="m6i.xlarge",
            tags={"Name": "tessellate-bastion-host"},
            egress=9_437_184,
            ingress=12_582_912,
        ),
        machine(
            "i-0hld000000000110",
            state="running",
            instance_type="t3.small",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_kestrelmoor", "Name": "probe-b"},
            egress=6_291_456,
            ingress=98_304,
            stale=True,
        ),
        machine(
            "i-0hld000000000111",
            state="terminated",
            instance_type="m5.2xlarge",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_wharfage", "Name": "seasonal-a"},
            egress=2_097_152,
            ingress=655_360,
        ),
        machine(
            "i-0hld000000000112",
            state="running",
            instance_type="m5.large",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_wharfage", "Name": "seasonal-b"},
            egress=None,
            ingress=212_992,
        ),
        machine(
            "i-0hld000000000113",
            state="stopping",
            instance_type="t3.xlarge",
            tags={"meteringcoDimensionId": d, "meteringcoCustomerId": "cus_calliper", "Name": "drain-a"},
            egress=131_072,
            ingress=57_344,
            samples=3,
        ),
    ]


# ---------------------------------------------------------------------------
# documents
# ---------------------------------------------------------------------------


def sandbox_estate() -> dict:
    return estate(
        metering_account=SANDBOX_METERING,
        metered_account=SANDBOX_METERED,
        alias="northwind-sandbox",
        role_name=SANDBOX_ROLE,
        external_id=SANDBOX_EXTERNAL_ID,
        access_key_id="LOCALMETERINGKEY01",
        secret_access_key="billing-secret",
        machines=sandbox_machines(),
    )


def holdout_estate() -> dict:
    return estate(
        metering_account=HOLDOUT_METERING,
        metered_account=HOLDOUT_METERED,
        alias="tessellate-production",
        role_name=HOLDOUT_ROLE,
        external_id=HOLDOUT_EXTERNAL_ID,
        access_key_id="LOCALMETERINGKEY01",
        secret_access_key="billing-secret",
        machines=holdout_machines(),
    )


def sandbox_run() -> dict:
    return {
        "label": "sandbox-egress",
        "businessID": SANDBOX_BUSINESS,
        "dimensionId": SANDBOX_DIMENSION,
        "region": REGION,
        "iamRoleArn": f"arn:aws:iam::{SANDBOX_METERED}:role/{SANDBOX_ROLE}",
        "externalId": SANDBOX_EXTERNAL_ID,
    }


def holdout_run_spec() -> dict:
    base = {
        "region": REGION,
        "businessID": HOLDOUT_BUSINESS,
        "iamRoleArn": f"arn:aws:iam::{HOLDOUT_METERED}:role/{HOLDOUT_ROLE}",
        "externalId": HOLDOUT_EXTERNAL_ID,
    }
    return {
        "runs": [
            dict(base, label="transfer", dimensionId=HOLDOUT_DIMENSION),
            dict(base, label="replica", dimensionId=HOLDOUT_OTHER_DIMENSION),
        ]
    }


SANDBOX_README = """\
Local AWS sandbox
=================

This box has no route to AWS. Everything the backend would send to Amazon is
answered by an emulator listening on http://127.0.0.1:4566, which speaks the
same wire protocols the AWS SDK uses. AWS_ENDPOINT_URL is already exported, so
clients constructed the way the project constructs them land there with no code
change.

The credentials in the environment belong to a bootstrap identity in the
metering account. Customer estates are separate accounts that the metering
account reads by assuming a role they grant it:

    metering account      %(metering)s     (the shell's own credentials)
    metered account       %(metered)s
    role to assume        %(role_arn)s
    external id           %(external_id)s
    region                %(region)s

    business              %(business)s
    dimension             %(dimension)s
    a second dimension    %(other_dimension)s

schedule-parameters.example.json holds those values in the shape a scheduled
run carries them.

The metered account holds twelve machines, tagged the way this platform tags
metered resources. DescribeInstances lists them with their tags; ListMetrics
lists the series each one publishes to AWS/EC2, and GetMetricStatistics or
GetMetricData will read any of those series. Observations are always a few
minutes old relative to whenever you ask, because the emulator lays them down
against the current five-minute boundary rather than at fixed wall-clock times.

The estate the emulator is currently serving is described in full by
/opt/billing-sandbox/public.json. It is a small estate and a quiet one; real
ones run far more machines per customer and far more customers per dimension,
so treat what you see here as the easy case rather than the shape of the world.

recorded-usage.json is usage the platform stored for %(business)s on
%(dimension)s during one earlier five-minute run against this same estate, one
entry per customer billed.

To point the emulator at a different estate document, restart it yourself:

    kill "$(cat /tmp/task-infra/mockaws.pid)"
    PYTHONPATH=/opt/mockaws python3 -m mockaws \\
        --scenario /path/to/your.json --host 127.0.0.1 --port 4566 --seed 7 &

TypeScript in this project can be run directly with tsx, for example

    tsx -e "import('./src/utils/aws/awsEc2.js').then(console.log)"
"""


def sandbox_readme() -> str:
    return SANDBOX_README % {
        "metering": SANDBOX_METERING,
        "metered": SANDBOX_METERED,
        "role_arn": f"arn:aws:iam::{SANDBOX_METERED}:role/{SANDBOX_ROLE}",
        "external_id": SANDBOX_EXTERNAL_ID,
        "region": REGION,
        "business": SANDBOX_BUSINESS,
        "dimension": SANDBOX_DIMENSION,
        "other_dimension": SANDBOX_OTHER_DIMENSION,
    }


def write_json(path: Path, document) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="environment/sandbox")
    parser.add_argument("--verifier-dir", default="environment/verifier-data")
    parser.add_argument("--check", action="store_true", help="fail if the shipped documents would change")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here.parent / "tests"))
    from compute_reward import expected_rows  # noqa: E402  the scorer's own model

    sandbox_dir = Path(args.out_dir)
    verifier_dir = Path(args.verifier_dir)

    sandbox = sandbox_estate()
    holdout = holdout_estate()
    run = sandbox_run()

    recorded = {
        "businessID": run["businessID"],
        "dimensionId": run["dimensionId"],
        "rows": expected_rows(sandbox, run["dimensionId"]),
    }

    documents = {
        sandbox_dir / "public.json": json.dumps(sandbox, indent=2) + "\n",
        sandbox_dir / "recorded-usage.json": json.dumps(recorded, indent=2) + "\n",
        sandbox_dir
        / "schedule-parameters.example.json": json.dumps(
            {
                "iamRoleArn": run["iamRoleArn"],
                "externalId": run["externalId"],
                "dimensionId": run["dimensionId"],
                "region": run["region"],
            },
            indent=2,
        )
        + "\n",
        sandbox_dir / "README": sandbox_readme(),
        verifier_dir / "holdout.json": json.dumps(holdout, indent=2) + "\n",
        verifier_dir / "run-spec.json": json.dumps(holdout_run_spec(), indent=2) + "\n",
    }

    if args.check:
        drifted = [
            str(path)
            for path, body in documents.items()
            if not path.exists() or path.read_text(encoding="utf-8") != body
        ]
        if drifted:
            print("these shipped documents no longer match the generator:")
            for path in drifted:
                print(f"  {path}")
            return 1
        print(f"all {len(documents)} shipped documents reproduce byte-for-byte")
        return 0

    for path, body in documents.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
