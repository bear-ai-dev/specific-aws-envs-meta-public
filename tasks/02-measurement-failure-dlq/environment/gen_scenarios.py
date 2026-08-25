#!/usr/bin/env python3
"""Build the mock-AWS scenario documents and the intake spec this task runs against.

Four documents come out of here:

  public.json            the world the sandbox serves. An ingestion bucket with a
                         handful of source objects and a dead-letter bucket
                         holding records of past intake failures.

  holdout.json           the world the verifier serves. Same wire shape, different
                         business identifiers, different bucket names, and a
                         dead-letter bucket that starts empty.

  holdout-degraded.json  holdout.json with the dead-letter bucket removed, so a
                         write to it is refused. Used for the one case that asks
                         what the caller is told when the dead-letter store will
                         not take the record.

  run-spec.json          the intake calls the driver makes, in two phases.

`compute_reward.py` re-derives which of those calls can be loaded and what each
failure must leave behind; nothing here stores that answer.
"""

from __future__ import annotations

import argparse
import json
import os

REGION = "us-east-1"
BOOTSTRAP_KEY = "LOCALMETERINGKEY02"


def usage_message(timestamp: str, customer: str, dimension: str, value: str, **extra) -> str:
    """A well-formed datastore usage message, serialised the way a producer sends it."""
    document = {
        "timestamp": timestamp,
        "customerId": customer,
        "dimensionId": dimension,
        "recordValue": value,
    }
    document.update(extra)
    return json.dumps(document)


def bucket(name: str, objects: list[dict]) -> dict:
    return {"name": name, "region": REGION, "objects": objects}


def source_object(key: str, body: str, last_modified: str) -> dict:
    return {"key": key, "body_b64": _b64(body), "last_modified": last_modified}


def _b64(text: str) -> str:
    import base64

    return base64.b64encode(text.encode()).decode()


def constraint_violation(document: dict, prop: str, constraint: str, message: str) -> list[dict]:
    """The shape `validateOrReject` rejects with: a list, not an Error."""
    return [
        {
            "target": document,
            "value": document.get(prop),
            "property": prop,
            "children": [],
            "constraints": {constraint: message},
        }
    ]


def dead_letter(key: str, original: str, source_key: str | None, error, when: str) -> dict:
    """A record of one intake failure, in the envelope the intake writes."""
    failed_document: dict = {"originalFileContent": original}
    if source_key is not None:
        failed_document["s3Key"] = source_key
    stem = key.rsplit("-", 1)[0]
    body = {
        "failedDocument": failed_document,
        "metadata": {
            "timestamp": when,
            "errorInfo": error,
            "results": "failed to load data",
            "orginalProcessedName": stem,
        },
    }
    return {"key": key, "body_json": body, "last_modified": when}


NO_FAULTS = {"enabled": True, "rules": []}


# --------------------------------------------------------------------------
# sandbox
# --------------------------------------------------------------------------

PUBLIC_ACCOUNT = "900000000001"
PUBLIC_INGESTION = "meteringco-usage-record-dump-bucket-sandbox"
PUBLIC_DLQ = "meteringco-usage-record-dlq-bucket-sandbox"


def build_public() -> dict:
    ingestion = [
        source_object(
            "biz-cadence/2026/02/03/usage-000116.json",
            usage_message("2026-02-03T08:00:00Z", "cus_harbor", "dim-api-calls", "1450"),
            "2026-02-03T08:01:00Z",
        ),
        source_object(
            "biz-cadence/2026/02/11/usage-000203.json",
            usage_message("2026-02-11T08:00:00Z", "cus_lattice", "dim-api-calls", "88"),
            "2026-02-11T08:01:00Z",
        ),
        source_object(
            "biz-lumen/2026/02/12/usage-000030.json",
            usage_message("2026-02-12T09:30:00Z", "cus_pergola", "dim-storage-gb", "12.75"),
            "2026-02-12T09:31:00Z",
        ),
    ]

    # Records of intake failures the sandbox business already had. Between them
    # they show a source file that failed twice without either record being
    # lost, and a message that arrived with no source file at all.
    truncated = '{"timestamp":"2026-02-03T08:05:00Z","customerId":"cus_harbor","dimensionId":"dim-api-c'
    dlq = [
        dead_letter(
            "biz-cadence/2026/02/03/usage-000117.json-k3f9a1.json",
            truncated,
            "biz-cadence/2026/02/03/usage-000117.json",
            {"name": "SyntaxError", "message": "Unterminated string in JSON at position 86"},
            "2026-02-03T08:06:11.402Z",
        ),
        dead_letter(
            "biz-cadence/2026/02/03/usage-000117.json-9wq2mz.json",
            truncated,
            "biz-cadence/2026/02/03/usage-000117.json",
            {"name": "SyntaxError", "message": "Unterminated string in JSON at position 86"},
            "2026-02-03T11:42:57.918Z",
        ),
        dead_letter(
            "biz-cadence/2026/02/11/usage-000204.json-b7t4xd.json",
            '{"timestamp": "11/02/2026 08:00", "customerId": "cus_lattice",'
            ' "dimensionId": "dim-api-calls", "recordValue": "301"}',
            "biz-cadence/2026/02/11/usage-000204.json",
            constraint_violation(
                {
                    "businessID": "biz-cadence",
                    "timestamp": "11/02/2026 08:00",
                    "customerId": "cus_lattice",
                    "dimensionId": "dim-api-calls",
                    "recordValue": "301",
                },
                "timestamp",
                "isRFC3339",
                "timestamp must be RFC 3339 date",
            ),
            "2026-02-11T08:00:41.264Z",
        ),
        dead_letter(
            "meteringco-unknown/1f5c9d2e-8a41-4f2b-9c07-6b3e5a0d1122-h2k8vq.json",
            '{"timestamp":"2026-02-11T22:14:00Z","customerId":"cus_lattice",'
            '"dimensionId":"dim-api-calls","recordValue":"4"}',
            None,
            {
                "name": "BadRequestException",
                "message": "Invalid message format, please check the documentation for the correct format",
            },
            "2026-02-11T22:14:03.771Z",
        ),
        dead_letter(
            "biz-lumen/2026/02/12/usage-000031.json-m4p1cs.json",
            '{"timestamp":"2026-02-12T09:35:00Z","customerId":"cus_pergola",'
            '"dimensionId":"dim-storage-gb","recordValue":"not a number"}',
            "biz-lumen/2026/02/12/usage-000031.json",
            constraint_violation(
                {
                    "businessID": "biz-lumen",
                    "timestamp": "2026-02-12T09:35:00Z",
                    "customerId": "cus_pergola",
                    "dimensionId": "dim-storage-gb",
                    "recordValue": "not a number",
                },
                "recordValue",
                "isNumberString",
                "recordValue must be a number string",
            ),
            "2026-02-12T09:35:22.005Z",
        ),
    ]

    return {
        "region": REGION,
        "bootstrap_identity": {"account_id": PUBLIC_ACCOUNT, "access_key_id": BOOTSTRAP_KEY},
        "accounts": [
            {
                "account_id": PUBLIC_ACCOUNT,
                "alias": "meteringco-platform",
                "buckets": [bucket(PUBLIC_INGESTION, ingestion), bucket(PUBLIC_DLQ, dlq)],
            }
        ],
        "faults": NO_FAULTS,
    }


# --------------------------------------------------------------------------
# held-out world
# --------------------------------------------------------------------------

HOLDOUT_ACCOUNT = "900000000042"
HOLDOUT_INGESTION = "meteringco-usage-record-dump-bucket-qa7"
HOLDOUT_DLQ = "meteringco-usage-record-dlq-bucket-qa7"


def holdout_ingestion_objects() -> list[dict]:
    return [
        source_object(
            "biz-arclight/2026/05/04/usage-004411.json",
            usage_message("2026-05-04T11:00:00Z", "cus_meridian", "dim-requests", "9120"),
            "2026-05-04T11:01:00Z",
        ),
        source_object(
            "biz-westmoor/2026/05/04/usage-000097.json",
            usage_message("2026-05-04T11:00:00Z", "cus_tessellate", "dim-seats", "40"),
            "2026-05-04T11:02:00Z",
        ),
        source_object(
            "biz-arclight/2026/05/04/usage-004412.json",
            "{}",
            "2026-05-04T11:03:00Z",
        ),
    ]


def build_holdout() -> dict:
    return {
        "region": REGION,
        "bootstrap_identity": {"account_id": HOLDOUT_ACCOUNT, "access_key_id": BOOTSTRAP_KEY},
        "accounts": [
            {
                "account_id": HOLDOUT_ACCOUNT,
                "alias": "meteringco-platform",
                "buckets": [
                    bucket(HOLDOUT_INGESTION, holdout_ingestion_objects()),
                    bucket(HOLDOUT_DLQ, []),
                ],
            }
        ],
        "faults": NO_FAULTS,
    }


def build_holdout_degraded() -> dict:
    """The same world with no dead-letter bucket, so a write to it is refused."""
    return {
        "region": REGION,
        "bootstrap_identity": {"account_id": HOLDOUT_ACCOUNT, "access_key_id": BOOTSTRAP_KEY},
        "accounts": [
            {
                "account_id": HOLDOUT_ACCOUNT,
                "alias": "meteringco-platform",
                "buckets": [bucket(HOLDOUT_INGESTION, holdout_ingestion_objects())],
            }
        ],
        "faults": NO_FAULTS,
    }


# --------------------------------------------------------------------------
# the intake calls
# --------------------------------------------------------------------------

ARC = "biz-arclight"
WES = "biz-westmoor"

# The same source file delivered twice, broken the same way both times.
REDELIVERED_KEY = f"{ARC}/2026/05/04/usage-004412.json"
REDELIVERED_BODY = '{"timestamp":"2026-05-04T11:20:00Z","customerId":"cus_meridian","dimensi'


def build_run_spec() -> dict:
    main_cases = [
        {
            "label": "loads-arclight",
            "endpoint": "db",
            "body": {
                "s3Key": f"{ARC}/2026/05/04/usage-004411.json",
                "message": usage_message("2026-05-04T11:00:00Z", "cus_meridian", "dim-requests", "9120"),
            },
        },
        {
            "label": "loads-westmoor",
            "endpoint": "db",
            "body": {
                "s3Key": f"{WES}/2026/05/04/usage-000097.json",
                "message": usage_message(
                    "2026-05-04T11:00:00Z",
                    "cus_tessellate",
                    "dim-seats",
                    "40",
                    metadata={"region": "eu-west-1"},
                ),
            },
        },
        {
            "label": "truncated-payload",
            "endpoint": "db",
            "body": {"s3Key": REDELIVERED_KEY, "message": REDELIVERED_BODY},
        },
        {
            "label": "truncated-payload-redelivered",
            "endpoint": "db",
            "body": {"s3Key": REDELIVERED_KEY, "message": REDELIVERED_BODY},
        },
        {
            "label": "timestamp-not-rfc3339",
            "endpoint": "db",
            "body": {
                "s3Key": f"{ARC}/2026/05/04/usage-004413.json",
                "message": usage_message("04/05/2026 11:15", "cus_meridian", "dim-requests", "12"),
            },
        },
        {
            "label": "customer-absent",
            "endpoint": "db",
            "body": {
                "s3Key": f"{WES}/2026/05/05/usage-000098.json",
                "message": json.dumps(
                    {"timestamp": "2026-05-05T09:00:00Z", "dimensionId": "dim-seats", "recordValue": "41"}
                ),
            },
        },
        {
            "label": "value-not-a-number-string",
            "endpoint": "db",
            "body": {
                "s3Key": f"{WES}/2026/05/05/usage-000099.json",
                "message": json.dumps(
                    {
                        "timestamp": "2026-05-05T10:00:00Z",
                        "customerId": "cus_tessellate",
                        "dimensionId": "dim-seats",
                        "recordValue": "several",
                    }
                ),
            },
        },
        {
            # Well-formed content, but nothing says which source file or which
            # business it came from.
            "label": "no-source-file",
            "endpoint": "db",
            "body": {
                "message": usage_message("2026-05-05T12:00:00Z", "cus_meridian", "dim-requests", "77")
            },
        },
        {
            "label": "blank-source-file",
            "endpoint": "db",
            "body": {
                "s3Key": "",
                "message": "<usage><record value='3'/></usage>",
            },
        },
        {
            # The Kafka-fed intake. Its failures are not this store's business.
            "label": "kafka-intake-failure",
            "endpoint": "datastore",
            "body": {"event": {"original": "this is not json"}},
            "headers": {"businessid": ARC},
        },
    ]

    degraded_cases = [
        {
            "label": "dead-letter-store-refuses",
            "endpoint": "db",
            "body": {
                "s3Key": f"{ARC}/2026/05/06/usage-004500.json",
                "message": '{"timestamp":"2026-05-06T07:00:00Z","customerId":',
            },
        }
    ]

    return {
        "dlqBucket": HOLDOUT_DLQ,
        "ingestionBucket": HOLDOUT_INGESTION,
        "phases": [
            {"label": "main", "scenario": "holdout.json", "cases": main_cases},
            {"label": "degraded", "scenario": "holdout-degraded.json", "cases": degraded_cases},
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--verifier-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    os.makedirs(args.verifier_dir, exist_ok=True)

    documents = [
        (os.path.join(args.out_dir, "public.json"), build_public()),
        (os.path.join(args.verifier_dir, "holdout.json"), build_holdout()),
        (os.path.join(args.verifier_dir, "holdout-degraded.json"), build_holdout_degraded()),
        (os.path.join(args.verifier_dir, "run-spec.json"), build_run_spec()),
    ]
    for path, document in documents:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, sort_keys=False)
            handle.write("\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
