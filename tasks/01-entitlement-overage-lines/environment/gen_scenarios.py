#!/usr/bin/env python3
"""Regenerate the two account documents this task serves.

`public.json` is what the box itself talks to: a small, quiet business whose
catalogue exercises every shape a plan can take, at a dose an engineer can hold
in their head. `holdout.json` is what the verifier serves: two businesses, ten
enrolments, forty-odd priced dimensions, and the two invoice settings side by
side.

Both documents are built from the same description, so a shape that appears in
one appears in the other. Neither carries an expected result: the scorer derives
those itself from the catalogue and the metric readings.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone

UTC = timezone.utc

PERIOD_START = datetime(2026, 7, 1, tzinfo=UTC)
PERIOD_END = datetime(2026, 8, 1, tzinfo=UTC)
USAGE_NAMESPACE = "MeteringCo/Usage"
USAGE_METRIC = "AggregatedUsage"
USAGE_PERIOD = 3600


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# catalogue building blocks
# ---------------------------------------------------------------------------


ABSENT = object()


def dimension(
    dimension_id: str,
    dimension_name: str,
    consumption_price: str,
    entitlement=None,
    overage=ABSENT,
) -> dict:
    """One priced dimension, in the shape the offerings API hands back.

    A plan that says nothing about going over its allowance is a real shape, and
    documents in the wild spell that either by leaving the field out or by
    writing it null, so both appear here.
    """
    body = {
        "dimensionId": dimension_id,
        "dimensionName": dimension_name,
        "consumptionPrice": consumption_price,
        "usageIncrement": "1",
        "rounding": "round",
        "sampleType": "gauge",
        "aggregationInterval": "hour",
        "aggregationMethod": "sum",
        "paymentSchedule": "arrear",
        "consumptionUnit": {"type": "count", "unit": "count-based"},
    }
    if entitlement is not None:
        body["usageEntitlement"] = entitlement
        if overage is not ABSENT:
            body["overageAllowed"] = overage
    return body


def offering(offering_id: str, offering_name: str, offering_type: str, dimensions: list[dict]) -> dict:
    body = {
        "offeringId": offering_id,
        "offeringName": offering_name,
        "offeringType": offering_type,
        "billingCycle": "monthly",
        "offeringVisibility": "public",
        "dimensions": dimensions,
    }
    if offering_type == "subscription":
        body["subscriptionPrice"] = 0
    return body


def catalogue(
    business_id: str,
    free_dimension_on_invoice: str,
    offerings: list[dict],
    enrolments: list[dict],
) -> dict:
    return {
        "businessID": business_id,
        "periodStart": iso(PERIOD_START),
        "periodEnd": iso(PERIOD_END),
        "usageNamespace": USAGE_NAMESPACE,
        "usageMetricName": USAGE_METRIC,
        "usagePeriod": USAGE_PERIOD,
        "settings": {
            "businessID": business_id,
            "invoiceGeneration": "perOffering",
            "freeDimensionOnInvoice": free_dimension_on_invoice,
        },
        "offerings": offerings,
        "enrolments": [
            {"customerId": customer_id, "offeringId": offering_id}
            for customer_id, offering_id, _ in enrolments
        ],
    }


# ---------------------------------------------------------------------------
# metric readings
# ---------------------------------------------------------------------------


def split(total: int, parts: int) -> list[int]:
    """`total` broken into `parts` whole readings. Whole numbers throughout, so
    the arithmetic an invoice does on them is exact."""
    base, remainder = divmod(total, parts)
    return [base + (1 if index < remainder else 0) for index in range(parts)]


def series(business_id: str, customer_id: str, dimension_id: str, total: int, parts: int, stride: int) -> dict:
    """One published series. A dimension nothing was recorded against has no
    series at all, which is how the metric store represents silence."""
    points = []
    for index, value in enumerate(value for value in split(total, parts) if value > 0):
        moment = PERIOD_START + timedelta(hours=stride * (index + 1))
        points.append([iso(moment), float(value)])
    return {
        "namespace": USAGE_NAMESPACE,
        "metric_name": USAGE_METRIC,
        "dimensions": {
            "BusinessId": business_id,
            "CustomerId": customer_id,
            "DimensionId": dimension_id,
        },
        "points": points,
    }


def metrics_for(business_id: str, enrolments: list[tuple], parts: int, stride_base: int) -> list[dict]:
    """Every series the business published over the period. The readings for one
    series are spread across the month on their own stride, so nothing about the
    numbers depends on two series sharing a bucket."""
    published = []
    for index, (customer_id, _, usage) in enumerate(enrolments):
        for offset, (dimension_id, total) in enumerate(usage.items()):
            if not total:
                continue
            stride = stride_base + (3 * index + 5 * offset) % 17
            published.append(series(business_id, customer_id, dimension_id, total, parts, stride))
    return published


# ---------------------------------------------------------------------------
# the sandbox business
# ---------------------------------------------------------------------------


def sandbox_document() -> dict:
    ridge_plan = offering(
        "off-ridge-plan",
        "Ridge Plan",
        "subscription",
        [
            dimension("ridge-api-calls", "Ridge API Calls", "0.01"),
            dimension("ridge-seats", "Ridge Seats", "10.00", 10, "true"),
            dimension("ridge-alerts", "Ridge Alerts", "0.00"),
            dimension("ridge-reports", "Ridge Reports", "1.00", 5, "false"),
            dimension("ridge-storage", "Ridge Storage", "0.20", "inf", "true"),
        ],
    )
    ridge_usage = offering(
        "off-ridge-usage",
        "Ridge Metered",
        "usage-based",
        [
            dimension("ridge-jobs", "Ridge Jobs", "0.05"),
            dimension("ridge-minutes", "Ridge Minutes", "0.02", 100, "true"),
            dimension("ridge-scans", "Ridge Scans", "0.50", "inf", "true"),
            dimension("ridge-tasks", "Ridge Tasks", "0.10", 50),
        ],
    )
    ridge_enrolments = [
        (
            "cus_sample_alpha",
            "off-ridge-plan",
            {
                "ridge-api-calls": 100,
                "ridge-seats": 12,
                "ridge-alerts": 5,
                "ridge-reports": 7,
                "ridge-storage": 40,
            },
        ),
        (
            "cus_sample_bravo",
            "off-ridge-usage",
            {"ridge-jobs": 200, "ridge-minutes": 80, "ridge-scans": 0, "ridge-tasks": 70},
        ),
    ]

    vale_plan = offering(
        "off-vale-plan",
        "Vale Plan",
        "subscription",
        [
            dimension("vale-messages", "Vale Messages", "0.01"),
            dimension("vale-hours", "Vale Hours", "0.00"),
            dimension("vale-units", "Vale Units", "5.00", 20, "true"),
        ],
    )
    vale_enrolments = [
        (
            "cus_sample_charlie",
            "off-vale-plan",
            {"vale-messages": 50, "vale-hours": 10, "vale-units": 25},
        ),
    ]

    ridge = catalogue("biz-ridge", "hide", [ridge_plan, ridge_usage], ridge_enrolments)
    vale = catalogue("biz-vale", "show", [vale_plan], vale_enrolments)

    return {
        "region": "us-east-1",
        "bootstrap_identity": {
            "account_id": "800000000001",
            "access_key_id": "LOCALMETERINGKEY01",
            "secret_access_key": "billing-secret",
        },
        "faults": {
            "enabled": True,
            "rules": [{"service": "cloudwatch", "action": "GetMetricData", "max_page_size": 3}],
        },
        "accounts": [
            {
                "account_id": "800000000001",
                "alias": "meteringco-billing",
                "buckets": [
                    {
                        "name": "meteringco-billing-sandbox",
                        "region": "us-east-1",
                        "objects": [
                            {
                                "key": "catalogues/biz-ridge-2026-07.json",
                                "body_json": ridge,
                                "last_modified": "2026-08-01T00:05:00Z",
                            },
                            {
                                "key": "catalogues/biz-vale-2026-07.json",
                                "body_json": vale,
                                "last_modified": "2026-08-01T00:05:00Z",
                            },
                        ],
                    }
                ],
                "metrics": metrics_for("biz-ridge", ridge_enrolments, 3, 5)
                + metrics_for("biz-vale", vale_enrolments, 3, 11),
            }
        ],
    }


# ---------------------------------------------------------------------------
# the held-out businesses
# ---------------------------------------------------------------------------


def holdout_document() -> tuple[dict, dict]:
    cardinal_scale = offering(
        "off-cardinal-scale",
        "Cardinal Scale",
        "subscription",
        [
            dimension("cardinal-api-requests", "Cardinal API Requests", "0.004"),
            dimension("cardinal-included-seats", "Cardinal Included Seats", "12.00", 25, "true"),
            dimension("cardinal-storage-gigabytes", "Cardinal Storage Gigabytes", "0.15", "inf", "true"),
            dimension("cardinal-support-tickets", "Cardinal Support Tickets", "0.00"),
            dimension("cardinal-audit-exports", "Cardinal Audit Exports", "3.50", 40, "false"),
        ],
    )
    cardinal_metered = offering(
        "off-cardinal-metered",
        "Cardinal Metered",
        "usage-based",
        [
            dimension("cardinal-events-ingested", "Cardinal Events Ingested", "0.002"),
            dimension("cardinal-webhook-calls", "Cardinal Webhook Calls", "0.01", 500, "true"),
            dimension("cardinal-data-scans", "Cardinal Data Scans", "0.90", "inf", "true"),
            dimension("cardinal-archive-restores", "Cardinal Archive Restores", "5.00", 10, "false"),
            dimension("cardinal-sandbox-hours", "Cardinal Sandbox Hours", "0.00", 100, "true"),
            dimension("cardinal-replay-jobs", "Cardinal Replay Jobs", "0.40", 50, None),
        ],
    )
    cardinal_enrolments = [
        (
            "cus_meridian",
            "off-cardinal-scale",
            {
                "cardinal-api-requests": 1840,
                "cardinal-included-seats": 31,
                "cardinal-storage-gigabytes": 920,
                "cardinal-support-tickets": 14,
                "cardinal-audit-exports": 52,
            },
        ),
        (
            "cus_falconry",
            "off-cardinal-scale",
            {
                "cardinal-api-requests": 0,
                "cardinal-included-seats": 18,
                "cardinal-storage-gigabytes": 0,
                "cardinal-support-tickets": 6,
                "cardinal-audit-exports": 12,
            },
        ),
        (
            "cus_marlowe",
            "off-cardinal-scale",
            {
                "cardinal-api-requests": 705,
                "cardinal-included-seats": 25,
                "cardinal-storage-gigabytes": 140,
                "cardinal-support-tickets": 0,
                "cardinal-audit-exports": 41,
            },
        ),
        (
            "cus_larkspur",
            "off-cardinal-metered",
            {
                "cardinal-events-ingested": 24500,
                "cardinal-webhook-calls": 640,
                "cardinal-data-scans": 310,
                "cardinal-archive-restores": 13,
                "cardinal-sandbox-hours": 180,
                "cardinal-replay-jobs": 88,
            },
        ),
        (
            "cus_pinnacle",
            "off-cardinal-metered",
            {
                "cardinal-events-ingested": 0,
                "cardinal-webhook-calls": 380,
                "cardinal-data-scans": 0,
                "cardinal-archive-restores": 4,
                "cardinal-sandbox-hours": 90,
                "cardinal-replay-jobs": 20,
            },
        ),
    ]

    solstice_team = offering(
        "off-solstice-team",
        "Solstice Team",
        "subscription",
        [
            dimension("solstice-messages-sent", "Solstice Messages Sent", "0.006"),
            dimension("solstice-active-users", "Solstice Active Users", "9.00", 50, "true"),
            dimension("solstice-bandwidth-gigabytes", "Solstice Bandwidth Gigabytes", "0.00"),
            dimension("solstice-retention-days", "Solstice Retention Days", "0.00", 30, "true"),
            dimension("solstice-priority-builds", "Solstice Priority Builds", "2.25", 20, "false"),
        ],
    )
    solstice_flex = offering(
        "off-solstice-flex",
        "Solstice Flex",
        "usage-based",
        [
            dimension("solstice-queries-run", "Solstice Queries Run", "0.03"),
            dimension("solstice-index-updates", "Solstice Index Updates", "0.05", 200, "true"),
            dimension("solstice-model-invocations", "Solstice Model Invocations", "0.00", "inf", "true"),
            dimension("solstice-export-jobs", "Solstice Export Jobs", "1.75", 15, "false"),
            dimension("solstice-stream-hours", "Solstice Stream Hours", "0.20", 100),
        ],
    )
    solstice_enrolments = [
        (
            "cus_orchard",
            "off-solstice-team",
            {
                "solstice-messages-sent": 3120,
                "solstice-active-users": 63,
                "solstice-bandwidth-gigabytes": 440,
                "solstice-retention-days": 48,
                "solstice-priority-builds": 27,
            },
        ),
        (
            "cus_juniper",
            "off-solstice-team",
            {
                "solstice-messages-sent": 0,
                "solstice-active-users": 50,
                "solstice-bandwidth-gigabytes": 0,
                "solstice-retention-days": 12,
                "solstice-priority-builds": 9,
            },
        ),
        (
            "cus_dunmore",
            "off-solstice-team",
            {
                "solstice-messages-sent": 95,
                "solstice-active-users": 51,
                "solstice-bandwidth-gigabytes": 1,
                "solstice-retention-days": 30,
                "solstice-priority-builds": 21,
            },
        ),
        (
            "cus_vesper",
            "off-solstice-flex",
            {
                "solstice-queries-run": 880,
                "solstice-index-updates": 260,
                "solstice-model-invocations": 75,
                "solstice-export-jobs": 22,
                "solstice-stream-hours": 175,
            },
        ),
        (
            "cus_cobalt",
            "off-solstice-flex",
            {
                "solstice-queries-run": 0,
                "solstice-index-updates": 140,
                "solstice-model-invocations": 0,
                "solstice-export-jobs": 8,
                "solstice-stream-hours": 40,
            },
        ),
    ]

    cardinal = catalogue(
        "biz-cardinal", "hide", [cardinal_scale, cardinal_metered], cardinal_enrolments
    )
    solstice = catalogue(
        "biz-solstice", "show", [solstice_team, solstice_flex], solstice_enrolments
    )

    document = {
        "region": "us-east-1",
        "bootstrap_identity": {
            "account_id": "800000000001",
            "access_key_id": "LOCALMETERINGKEY01",
            "secret_access_key": "billing-secret",
        },
        "faults": {
            "enabled": True,
            "rules": [{"service": "cloudwatch", "action": "GetMetricData", "max_page_size": 2}],
        },
        "accounts": [
            {
                "account_id": "800000000001",
                "alias": "meteringco-billing",
                "buckets": [
                    {
                        "name": "meteringco-billing-holdout",
                        "region": "us-east-1",
                        "objects": [
                            {
                                "key": "catalogues/biz-cardinal-2026-07.json",
                                "body_json": cardinal,
                                "last_modified": "2026-08-01T00:05:00Z",
                            },
                            {
                                "key": "catalogues/biz-solstice-2026-07.json",
                                "body_json": solstice,
                                "last_modified": "2026-08-01T00:05:00Z",
                            },
                        ],
                    }
                ],
                "metrics": metrics_for("biz-cardinal", cardinal_enrolments, 4, 3)
                + metrics_for("biz-solstice", solstice_enrolments, 4, 13),
            }
        ],
    }

    run_spec = {
        "runs": [
            {
                "label": "cardinal-july",
                "businessID": "biz-cardinal",
                "catalogueBucket": "meteringco-billing-holdout",
                "catalogueKey": "catalogues/biz-cardinal-2026-07.json",
            },
            {
                "label": "solstice-july",
                "businessID": "biz-solstice",
                "catalogueBucket": "meteringco-billing-holdout",
                "catalogueKey": "catalogues/biz-solstice-2026-07.json",
            },
        ]
    }
    return document, run_spec


# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    holdout, run_spec = holdout_document()
    written = {
        "public.json": sandbox_document(),
        "holdout.json": holdout,
        "run-spec.json": run_spec,
    }
    for name, payload in written.items():
        path = os.path.join(args.out_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=1, sort_keys=False)
            handle.write("\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
