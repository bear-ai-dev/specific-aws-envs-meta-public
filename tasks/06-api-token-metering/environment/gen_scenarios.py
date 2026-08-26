#!/usr/bin/env python3
"""Build the two worlds this task runs against, plus the run spec.

`sandbox/metering.json` is the world the box itself talks to. It holds a
recorded stretch of the platform's own metering: per-call registrations sitting
in the aggregate bucket and the six-hourly roll-ups they were turned into. It is
the only place the shapes are written down -- the bucket the registrations live
in, the measurement they use, which tags carry the platform's own customer and
which carry the call's identity, and the two dogfood accounts the platform bills
itself under.

`verifier-data/holdout.json` is a different account entirely and holds no
metering at all beyond one stale registration that every window under test
excludes. Everything the graded run measures is written by the submission during
the run, so the only thing shared between the two worlds is the handful of
platform-wide constants that would make the capability ungradeable if they
differed.

`verifier-data/run-spec.json` carries the graded call sequence as offsets in
seconds from a base the verifier pins at run time, so the same file grades a run
today and a run next year.

This generator never enters the image.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent

STAGE = "dev"
AGGREGATE_BUCKET = "dogfood-aggregate-bucket"
USAGE_BUCKET = f"{STAGE}-usage-data"
CONFIG_BUCKET = "prod-config"

TOKEN_MEASUREMENT = "tokenConsumer"
USAGE_MEASUREMENT = "usageMeasurement"
CUSTOMER_MEASUREMENT = "customer"

# Platform-wide constants. The platform meters itself as one of its own
# customers, under a production account and a sandbox account, and each account
# has one dimension it bills API traffic against. These are the same in both
# worlds because they are properties of the platform rather than of a tenant.
PROD_BUSINESS = "meteringco-production"
SANDBOX_BUSINESS = "meteringco-sandbox"
PROD_DIMENSION = "697f07d0-3180-4351-bdff-7ca029e6c18d"
SANDBOX_DIMENSION = "00abdf4f-f975-41c6-8293-76ba09a5cb23"

HOUR = 3600


def point(measurement: str, tags: dict, fields: dict, time: str) -> dict:
    return {"measurement": measurement, "tags": tags, "fields": fields, "time": time}


def registration(customer: str, business: str, dimension: str, uuid: str, amount: float, time: str) -> dict:
    """One API call, as the platform records it before it is billable.

    The call's own identity and the account it belongs to are tags, so they are
    part of the series key; the amount is the only field. Metadata values arrive
    JSON-encoded because that is what the shared point builder does with them.
    """
    tags = {
        "customerId": customer,
        "dimensionId": dimension,
        "businessID": business,
        "metadata_tokenType": '"apiCall"',
    }
    if uuid:
        tags["metadata_uuid"] = f'"{uuid}"'
    return point(TOKEN_MEASUREMENT, tags, {"recordValue": amount}, time)


def rollup(customer: str, business: str, dimension: str, amount: float, time: str) -> dict:
    return point(
        USAGE_MEASUREMENT,
        {
            "customerId": customer,
            "dimensionId": dimension,
            "businessID": business,
            "metadata_tokenType": '"apiCall"',
            "metadata_managed": '"true"',
        },
        {"recordValue": amount},
        time,
    )


def dogfood_customer(customer: str, business: str, tenant: str, name: str, time: str) -> dict:
    """A platform customer document, as the dogfood customer read expects it."""
    return point(
        CUSTOMER_MEASUREMENT,
        {"customerId": customer, "businessID": business, "metadata": json.dumps({"businessID": tenant})},
        {"recordValue": name},
        time,
    )


# ---------------------------------------------------------------------------
# sandbox world: a recorded afternoon of the platform metering itself
# ---------------------------------------------------------------------------

SANDBOX_PROD_CUSTOMER = "cus-4f1a-northwind-prod"
SANDBOX_SBX_CUSTOMER = "cus-9c07-northwind-sbx"


def sandbox_world() -> dict:
    aggregate: list[dict] = []
    usage: list[dict] = []

    # 12:00-18:00 period, production account. Six calls, one of them delivered
    # twice: the redelivery carried the same identity and the same call time, so
    # the store holds one row for it and the roll-up counted it once.
    prod_calls = [
        ("2025-05-14T12:04:11.238Z", "b41d7c60-2f5e-4a0e-9d61-1c8e0a2f5b31"),
        ("2025-05-14T12:41:52.907Z", "6e2a1f84-70b3-4d2c-8f19-5b7c3d9e0a42"),
        ("2025-05-14T14:17:03.461Z", "f0c98a15-3d47-49bb-b2e6-8a1d5c7f2093"),
        ("2025-05-14T15:52:38.014Z", "27b6e5d9-1a8c-4f30-95d7-6e0b4a9c1f85"),
        ("2025-05-14T16:33:19.672Z", "9d4f2c07-8e61-4b5a-a3c8-0f7e2b6d4a19"),
        ("2025-05-14T17:48:56.325Z", "3a7e0b62-c94d-4816-8b5f-2d1c6e9a0f47"),
    ]
    for at, uuid in prod_calls:
        aggregate.append(registration(SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION, uuid, 0.001, at))
    # Accepting a measurement is metered too, and at a hundred times the rate of
    # serving an ordinary request. These carry no identity of their own: the
    # moment they arrived is what tells them apart.
    accepted = [
        ("2025-05-14T13:07:44.512Z", None),
        ("2025-05-14T15:19:26.883Z", None),
    ]
    for at, uuid in accepted:
        aggregate.append(registration(SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION, uuid, 0.1, at))
    usage.append(
        rollup(SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION, 0.206, "2025-05-14T18:00:02.118Z")
    )

    # Same period, sandbox account. Two calls arrived out of order -- 13:22 was
    # delivered after 14:05 -- and both sit at the time the call happened, not
    # the time the platform got round to recording it.
    sbx_calls = [
        ("2025-05-14T13:22:47.583Z", "5c1b8e34-6f92-4a7d-b0e5-9c3a1d7f2648"),
        ("2025-05-14T14:05:12.196Z", "e8d3a97b-405c-4e21-9f6a-7b2c8d0e5194"),
        ("2025-05-14T16:09:31.740Z", "1f6c4d80-b273-4958-8ae1-3d9f0b6c2a57"),
    ]
    for at, uuid in sbx_calls:
        aggregate.append(registration(SANDBOX_SBX_CUSTOMER, SANDBOX_BUSINESS, SANDBOX_DIMENSION, uuid, 0.001, at))
    usage.append(
        rollup(SANDBOX_SBX_CUSTOMER, SANDBOX_BUSINESS, SANDBOX_DIMENSION, 0.003, "2025-05-14T18:00:02.884Z")
    )

    # The previous period, so the window is visibly six hours wide and visibly
    # closed: nothing before 12:00 was counted into the 18:00 roll-up.
    for at, uuid in [
        ("2025-05-14T07:12:04.881Z", "a2e7c519-4b06-4d83-95f2-1e8b0c6a3d74"),
        ("2025-05-14T10:38:27.315Z", "7b0d6f92-c351-4a08-8e4d-9f2a5c1b7e36"),
    ]:
        aggregate.append(registration(SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION, uuid, 0.001, at))
    usage.append(
        rollup(SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION, 0.002, "2025-05-14T12:00:01.507Z")
    )

    # Measurement traffic the tenant sent in its own right, so that the
    # platform's own billable rows are visibly a different account from the
    # tenant's and not a relabelling of them.
    tenant_usage = [
        point(
            USAGE_MEASUREMENT,
            {
                "customerId": "cus-northwind-8831",
                "dimensionId": "d51c7a90-6b24-4e18-9f03-2a7c5d8e1b46",
                "businessID": "northwind-logistics",
            },
            {"recordValue": 42.0},
            "2025-05-14T13:11:09.402Z",
        ),
        point(
            USAGE_MEASUREMENT,
            {
                "customerId": "cus-northwind-8831",
                "dimensionId": "d51c7a90-6b24-4e18-9f03-2a7c5d8e1b46",
                "businessID": "northwind-logistics",
            },
            {"recordValue": 17.5},
            "2025-05-14T16:44:51.883Z",
        ),
    ]

    customers = [
        dogfood_customer(
            SANDBOX_PROD_CUSTOMER, PROD_BUSINESS, "northwind-logistics", "Northwind Logistics",
            "2025-04-02T09:14:22.001Z",
        ),
        dogfood_customer(
            SANDBOX_SBX_CUSTOMER, SANDBOX_BUSINESS, "northwind-staging", "Northwind Staging",
            "2025-04-02T09:15:03.774Z",
        ),
    ]

    return {
        "influx": {
            "buckets": {
                AGGREGATE_BUCKET: aggregate,
                USAGE_BUCKET: usage + tenant_usage,
                CONFIG_BUCKET: customers,
            }
        }
    }


# ---------------------------------------------------------------------------
# holdout world and the graded call sequence
# ---------------------------------------------------------------------------

HOLDOUT_TENANT = "harborline-freight"
HOLDOUT_CUSTOMER = "cus-2d83-harborline-prod"
HOLDOUT_OTHER_CUSTOMER = "cus-6a17-harborline-alt"

# Identities the graded run attaches to its calls. Fixed so that the reward can
# look for them by name in the store without trusting anything the run reports.
CALLS = {
    "A": "0c5e91a7-3b48-4d16-8f92-6a0d7c2e5b83",
    "B": "84f2b6d0-19ce-4a73-b508-2e7f9c1a6d34",
    "D": "b7a3e04c-52d9-4816-9c1f-8d5b0a2e7f96",
    "C": "39d8c1f6-a047-4b52-8e63-1c9a5d0b4e27",
    "T1": "5e0b7a94-6d31-4c08-af75-3b2e8c1d9f40",
    "T2": "c62f9d18-0a54-4e37-b91d-7f4a6c3b0e85",
    "P": "d18a4c70-9e62-4f51-8b03-5c7d2a9e6b14",
    "O": "72c5e8b3-4f19-40ad-9d68-1a0b6e5c3f92",
    # A burst of ordinary calls inside the first period. Their purpose beyond
    # volume: a registration is about 250 bytes of line protocol, and the metric
    # store's client compresses and streams anything over about a kilobyte
    # instead of declaring a length. With three calls in a period the graded run
    # never reached that size, so the whole compressed-and-streamed write path
    # went unexercised by grading -- and how many registrations a submission
    # sends in one request is the submission's decision, not this task's.
    "R1": "1f6c8a25-7d40-4b93-a58e-2c0f9b7d4e61",
    "R2": "a4e70b93-2c18-4f6d-95b7-8e1a3d0c6f52",
    "R3": "7b2d5e18-c096-4a37-8f41-6d9c2b0a5e73",
    "R4": "e93a0c47-5b62-4d18-9a70-3f8b1e6d2c94",
    "R5": "50d8b4f1-9a37-4c62-b08d-7e2c5a9f1b36",
}

AMOUNT = 0.001


def holdout_world() -> dict:
    # One registration from a period that closed long before any window under
    # test, so a submission that reads the bucket without bounding it by time
    # bills for traffic that was already invoiced.
    stale = registration(
        HOLDOUT_CUSTOMER, PROD_BUSINESS, PROD_DIMENSION,
        "ea9160b7-5c34-4d28-8f01-6b3e7a2c9d45", 0.001, "2025-01-02T04:17:33.628Z",
    )
    customers = [
        dogfood_customer(
            HOLDOUT_CUSTOMER, PROD_BUSINESS, HOLDOUT_TENANT, "Harborline Freight",
            "2024-11-19T11:02:41.339Z",
        ),
        # The second platform customer belongs to the sandbox account, not the
        # production one. Without it every graded call belongs to a production
        # customer, and a pipeline that never looks at which account a customer
        # belongs to -- one that just says production -- is indistinguishable
        # from one that reads it properly. Measured: with both customers on
        # production, exactly such a pipeline scored full marks.
        dogfood_customer(
            HOLDOUT_OTHER_CUSTOMER, SANDBOX_BUSINESS, "harborline-staging", "Harborline Staging",
            "2024-11-19T11:03:16.882Z",
        ),
    ]
    return {"influx": {"buckets": {AGGREGATE_BUCKET: [stale], CONFIG_BUCKET: customers}}}


def run_spec() -> dict:
    steps = [
        # --- first period: three calls, then close it -----------------------
        {"label": "p1.call-a", "op": "register", "call": "A", "atOffset": -9 * HOUR},
        {"label": "p1.call-b", "op": "register", "call": "B", "atOffset": -8 * HOUR},
        {"label": "p1.call-d", "op": "register", "call": "D", "atOffset": -7.5 * HOUR},
        # A burst inside the same period, so the batch this flush hands over is
        # large enough that the client compresses it and streams it without a
        # declared length. Grading then covers that write path rather than
        # depending on a submission choosing to send small requests.
        {"label": "p1.burst-1", "op": "register", "call": "R1", "atOffset": -7 * HOUR},
        {"label": "p1.burst-2", "op": "register", "call": "R2", "atOffset": -7 * HOUR + 1},
        {"label": "p1.burst-3", "op": "register", "call": "R3", "atOffset": -7 * HOUR + 2},
        {"label": "p1.burst-4", "op": "register", "call": "R4", "atOffset": -7 * HOUR + 3},
        {"label": "p1.burst-5", "op": "register", "call": "R5", "atOffset": -7 * HOUR + 4},
        {"label": "p1.flush", "op": "flush"},
        {"label": "p1.rollup", "op": "aggregate", "startOffset": -12 * HOUR, "endOffset": -6 * HOUR},
        # --- second period -------------------------------------------------
        {"label": "p2.call-c", "op": "register", "call": "C", "atOffset": -3 * HOUR},
        # Two calls inside the same millisecond. Only their identities tell them
        # apart, so both have to survive.
        {"label": "p2.twin-1", "op": "register", "call": "T1", "atOffset": -2 * HOUR},
        {"label": "p2.twin-2", "op": "register", "call": "T2", "atOffset": -2 * HOUR},
        {"label": "p2.flush", "op": "flush"},
        # A redelivery of a call the first period already billed, arriving in
        # the second period. Its own time has not changed.
        {"label": "p2.redeliver-d", "op": "register", "call": "D", "atOffset": -7.5 * HOUR},
        # A call that happened before this period opened, delivered inside it.
        {"label": "p2.late-p", "op": "register", "call": "P", "atOffset": -6.5 * HOUR},
        # A redelivery of a call from this period, across a flush boundary.
        {"label": "p2.redeliver-c", "op": "register", "call": "C", "atOffset": -3 * HOUR},
        {"label": "p2.flush-2", "op": "flush"},
        # Traffic belonging to a different platform customer in the same period.
        {"label": "p2.other-customer", "op": "register", "call": "O", "atOffset": -1 * HOUR, "customer": "other"},
        {"label": "p2.flush-3", "op": "flush"},
        {"label": "p2.rollup", "op": "aggregate", "startOffset": -6 * HOUR, "endOffset": 2 * HOUR},
        # The same window closed for the other platform customer, who belongs to
        # the sandbox account. Its roll-up has to be billed there, so the account
        # a roll-up carries is settled by the customer rather than by a constant.
        {
            "label": "p2.rollup-other", "op": "aggregate", "tenant": "other",
            "startOffset": -6 * HOUR, "endOffset": 2 * HOUR,
        },
        # --- the call path that produces the traffic in the first place -----
        {"label": "callsite", "op": "usage.create"},
    ]

    return {
        "tenant": HOLDOUT_TENANT,
        "subject": "auth0|harborline-ops-6d21",
        "platformCustomer": HOLDOUT_CUSTOMER,
        "otherPlatformCustomer": HOLDOUT_OTHER_CUSTOMER,
        "platformBusiness": PROD_BUSINESS,
        "otherPlatformBusiness": SANDBOX_BUSINESS,
        "aggregateBucket": AGGREGATE_BUCKET,
        "usageBucket": USAGE_BUCKET,
        "amount": AMOUNT,
        "calls": CALLS,
        # Method names the workspace already had. The driver treats anything
        # else on these classes as the submission's own work, so a neighbour is
        # never mistaken for the entry point under test.
        "preexistingMethods": {
            "TokenConsumerService": ["create", "scheduleTokenProcessor", "removeTokenProcessor", "findAll"],
            "TokenConsumerAsyncProcessor": ["loadTokens", "jobFailure"],
        },
        "tenantMeasurement": {
            "customerId": "cus-harborline-4417",
            "dimensionId": "8c3f5b21-7d94-4e60-a1f8-2b5c9d7e0a36",
            "recordValue": "23.5",
        },
        "environment": {
            "INFLUX_ORG": "meteringco",
            "INFLUX_TOKEN": "harborline-holdout-token",
            "METERINGCO_DOGFOOD_INFLUX_SECRET": "harborline-holdout-token",
            "STAGE": STAGE,
        },
        "steps": steps,
    }


def main() -> None:
    (HERE / "sandbox").mkdir(exist_ok=True)
    (HERE / "verifier-data").mkdir(exist_ok=True)
    (HERE / "sandbox" / "metering.json").write_text(json.dumps(sandbox_world(), indent=2) + "\n")
    (HERE / "verifier-data" / "holdout.json").write_text(json.dumps(holdout_world(), indent=2) + "\n")
    (HERE / "verifier-data" / "run-spec.json").write_text(json.dumps(run_spec(), indent=2) + "\n")
    print("wrote sandbox/metering.json, verifier-data/holdout.json, verifier-data/run-spec.json")


if __name__ == "__main__":
    main()
