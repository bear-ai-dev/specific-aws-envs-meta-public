#!/usr/bin/env python3
"""Builds the two configuration ledgers this task runs against.

The sandbox ledger is baked into the image and served to the box, so an agent
can save a document and read it back while it works. The held-out ledger is
verifier-only material: different businesses, different stored values, and a
different mix of which fields are recorded, which are recorded blank, and which
were never recorded at all -- that last distinction being the one every rule
here turns on, because a field the ledger never carried and a field the ledger
carries as an empty string are not the same thing to a caller who omits it.

The run spec lists the saves the verifier replays. It carries no answers: the
scorer re-derives what each business should look like afterwards from the
recorded document plus the save itself.

This generator never enters the image.

    python3 gen_scenarios.py --out .
"""

from __future__ import annotations

import argparse
import json
import os

BUCKET = "qa-config"
MEASUREMENT = "Setting"


def document(business_id: str, business_name: str, recorded: dict, stamp: str) -> dict:
    """One recorded configuration row.

    The business name is the row's only field; everything else about a business
    is a tag on it, which is why a value that was never recorded is simply a
    tag that is not there.
    """
    tags = {"businessID": business_id}
    for key, value in recorded.items():
        tags[key] = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    return {
        "measurement": MEASUREMENT,
        "time": stamp,
        "tags": tags,
        "fields": {"businessName": business_name},
    }


# ---------------------------------------------------------------------------
# the sandbox the box itself talks to
# ---------------------------------------------------------------------------


def sandbox() -> dict:
    rows = [
        # Everything recorded, including two fields recorded blank on purpose:
        # the postal code the business never filled in, and the tax category it
        # cleared. Both sit alongside fields carrying real values.
        document(
            "biz_sandbox_orchard",
            "Orchard Systems",
            {
                "addressLine1": "12 Mill Lane",
                "addressLine2": "",
                "city": "Cambridge",
                "state": "Cambridgeshire",
                "country": "GB",
                "postalCode": "",
                "vatId": "GB 342 1188 09",
                "taxCategory": "",
                "supportEmail": "billing@orchard.example",
                "invoicePaymentTerm": "30",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "invoiceGeneration": "consolidatedPerBillingCycle",
                "sendInvoiceEmail": "false",
                "computeCostSource": "eks",
                "storageCostSource": "ebs",
                "archiveCostSource": "none",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Your invoices"},
                    "payment": {"enabled": True, "text": "Pay a bill"},
                    "offering": {
                        "enabled": True,
                        "text": "Choose a plan",
                        "appearance": {"accent": "#1f6feb", "border": "#d0d7de", "radius": "8px"},
                    },
                },
            },
            "2026-02-03T09:15:00Z",
        ),
        # A young business: most of the document was never recorded at all, so
        # a reader sees the platform's own starting values rather than blanks
        # the business chose. Nothing here is recorded blank.
        document(
            "biz_sandbox_kite",
            "Kite Analytics",
            {
                "addressLine1": "4 Harbour Road",
                "city": "Bristol",
                "country": "GB",
                "accountState": "sandbox",
            },
            "2026-02-04T11:40:00Z",
        ),
    ]
    return {"region": "us-east-1", "accounts": [], "influx": {"buckets": {BUCKET: rows}}}


# ---------------------------------------------------------------------------
# the businesses the verifier serves, and the saves it replays
# ---------------------------------------------------------------------------


def holdout() -> dict:
    rows = [
        # Carries a value away from the platform's starting value in every
        # field a careless save would quietly reset.
        document(
            "biz_hold_thornbury",
            "Thornbury Freight",
            {
                "addressLine1": "88 Dock Street",
                "addressLine2": "Unit 3",
                "city": "Hull",
                "state": "East Riding",
                "country": "GB",
                "postalCode": "HU1 3DZ",
                "vatId": "GB 771 4432 21",
                "customFields": "purchaseOrder",
                "taxCategory": "SW054000",
                "logoUrl": "https://assets.example/thornbury.png",
                "supportEmail": "accounts@thornbury.example",
                "invoicePaymentTerm": "60",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "invoiceGeneration": "consolidatedPerBillingCycle",
                "sendInvoiceEmail": "false",
                "computeCostSource": "eks",
                "storageCostSource": "ebs",
                "archiveCostSource": "ebs",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Freight invoices"},
                    "payment": {"enabled": True, "text": "Settle up"},
                    "offering": {
                        "enabled": True,
                        "text": "Shipping plans",
                        "appearance": {"accent": "#8250df", "border": "#eaeef2", "radius": "4px"},
                    },
                },
            },
            "2026-02-05T08:00:00Z",
        ),
        # Carries a portal block whose three pages all say something, so a save
        # aimed at one of them has two others to leave alone.
        document(
            "biz_hold_calder",
            "Calder Print",
            {
                "addressLine1": "23 Bindery Street",
                "city": "Halifax",
                "country": "GB",
                "postalCode": "HX1 2QB",
                "supportEmail": "studio@calder.example",
                "invoiceApproval": "automatic",
                "sendInvoiceEmail": "false",
                "computeCostSource": "none",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Print invoices"},
                    "payment": {"enabled": True, "text": "Pay the studio"},
                    "offering": {
                        "enabled": True,
                        "text": "Print plans",
                        "appearance": {"accent": "#116329", "border": "#d8dee4"},
                    },
                },
            },
            "2026-02-05T08:40:00Z",
        ),
        # Its invoice page is on, so switching it off is a visible move.
        document(
            "biz_hold_teviot",
            "Teviot Wool",
            {
                "addressLine1": "7 Loom Street",
                "city": "Hawick",
                "country": "GB",
                "supportEmail": "mill@teviot.example",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "computeCostSource": "none",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Wool invoices"},
                    "payment": {"enabled": False, "text": "Settle"},
                    "offering": {"enabled": True, "text": "Wool plans"},
                },
            },
            "2026-02-05T08:45:00Z",
        ),
        # Its look-and-feel block carries three entries, so a save that names
        # one of them has two others that have to survive.
        document(
            "biz_hold_amberley",
            "Amberley Studios",
            {
                "addressLine1": "40 Chalk Lane",
                "city": "Arundel",
                "country": "GB",
                "supportEmail": "hello@amberley.example",
                "invoicePaymentTerm": "30",
                "invoiceApproval": "automatic",
                "computeCostSource": "none",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Studio invoices"},
                    "payment": {"enabled": True, "text": "Pay"},
                    "offering": {
                        "enabled": True,
                        "text": "Studio plans",
                        "appearance": {"accent": "#953800", "border": "#eaeef2", "radius": "12px"},
                    },
                },
            },
            "2026-02-05T08:50:00Z",
        ),
        # Two fields recorded blank next to two carrying values, so clearing
        # one and leaving another alone are told apart in the same document.
        document(
            "biz_hold_marlowe",
            "Marlowe Instruments",
            {
                "addressLine1": "2 Foundry Way",
                "addressLine2": "",
                "city": "Sheffield",
                "state": "",
                "country": "GB",
                "postalCode": "S3 8LR",
                "vatId": "GB 220 9981 47",
                "customFields": "costCentre",
                "supportEmail": "ap@marlowe.example",
                "invoicePaymentTerm": "30",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "sendInvoiceEmail": "false",
                "computeCostSource": "none",
                "storageCostSource": "ebs",
                "accountState": "sandbox",
                "pages": {
                    "invoice": {"enabled": True, "text": "Instrument invoices"},
                    "payment": {"enabled": False, "text": "Pay now"},
                    "offering": {
                        "enabled": True,
                        "text": "Calibration plans",
                        "appearance": {"accent": "#cf222e", "border": "#d0d7de"},
                    },
                },
            },
            "2026-02-05T08:05:00Z",
        ),
        # Recorded without a portal block at all, and without most of the
        # address, so the reader's starting values are what a save has to
        # preserve rather than a set of blanks.
        document(
            "biz_hold_selby",
            "Selby Grain",
            {
                "addressLine1": "1 Granary Court",
                "city": "Selby",
                "country": "GB",
                "vatId": "GB 615 3320 88",
                "supportEmail": "finance@selby.example",
                "invoiceApproval": "automatic",
                "invoiceGeneration": "consolidatedPerBillingCycle",
                "sendInvoiceEmail": "false",
                "computeCostSource": "eks",
                "accountState": "sandbox",
            },
            "2026-02-05T08:10:00Z",
        ),
        # Sits on the cluster cost source so a save that moves off it has
        # somewhere to move from.
        document(
            "biz_hold_ardley",
            "Ardley Robotics",
            {
                "addressLine1": "9 Kiln Road",
                "city": "Oxford",
                "country": "GB",
                "postalCode": "OX5 2QT",
                "supportEmail": "ops@ardley.example",
                "invoiceApproval": "automatic",
                "computeCostSource": "eks",
                "storageCostSource": "ebs",
                "accountState": "sandbox",
            },
            "2026-02-05T08:15:00Z",
        ),
        # Sits off the cluster cost source, so a save that moves onto it has
        # somewhere to move from.
        document(
            "biz_hold_penrith",
            "Penrith Dairy",
            {
                "addressLine1": "6 Creamery Lane",
                "city": "Penrith",
                "country": "GB",
                "postalCode": "CA11 7JQ",
                "supportEmail": "hello@penrith.example",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "computeCostSource": "none",
                "accountState": "sandbox",
            },
            "2026-02-05T08:20:00Z",
        ),
        # Already on the cluster cost source and stays there, so a save that
        # repeats the value has no transition to act on.
        document(
            "biz_hold_wenlock",
            "Wenlock Media",
            {
                "addressLine1": "31 Print Row",
                "city": "Shrewsbury",
                "country": "GB",
                "supportEmail": "billing@wenlock.example",
                "invoiceApproval": "automatic",
                "sendInvoiceEmail": "false",
                "computeCostSource": "eks",
                "accountState": "sandbox",
            },
            "2026-02-05T08:25:00Z",
        ),
        # Exercised through the profile surface only.
        document(
            "biz_hold_fenwick",
            "Fenwick Joinery",
            {
                "addressLine1": "17 Sawmill Street",
                "addressLine2": "Workshop 2",
                "city": "Durham",
                "state": "County Durham",
                "country": "GB",
                "postalCode": "DH1 4TA",
                "vatId": "GB 447 2210 65",
                "supportEmail": "office@fenwick.example",
                "invoicePaymentTerm": "30",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "invoiceGeneration": "consolidatedPerBillingCycle",
                "sendInvoiceEmail": "false",
                "computeCostSource": "eks",
                "storageCostSource": "ebs",
                "accountState": "sandbox",
            },
            "2026-02-05T08:30:00Z",
        ),
        # Also profile-only, and used to check that a save aimed at the profile
        # does not carry fields that are not part of one.
        document(
            "biz_hold_ravensworth",
            "Ravensworth Tooling",
            {
                "addressLine1": "5 Anvil Way",
                "city": "Darlington",
                "country": "GB",
                "postalCode": "DL1 2XN",
                "supportEmail": "purchasing@ravensworth.example",
                "invoicePaymentTerm": "30",
                "invoiceApproval": "automatic",
                "freeDimensionOnInvoice": "hide",
                "computeCostSource": "none",
                "accountState": "sandbox",
            },
            "2026-02-05T08:35:00Z",
        ),
    ]
    return {"region": "us-east-1", "accounts": [], "influx": {"buckets": {BUCKET: rows}}}


def run_spec() -> dict:
    """The saves the verifier replays, in order, each against its own business.

    `surface` picks which of the two save endpoints carries the payload.
    """
    return {
        "bucket": BUCKET,
        "measurement": MEASUREMENT,
        "steps": [
            {
                "label": "one-field-save-leaves-the-rest-alone",
                "businessID": "biz_hold_thornbury",
                "surface": "settings",
                "payload": {"city": "Leeds"},
            },
            {
                "label": "a-submitted-blank-clears-what-was-there",
                "businessID": "biz_hold_marlowe",
                "surface": "settings",
                "payload": {"vatId": ""},
            },
            {
                "label": "a-document-with-gaps-keeps-its-gaps",
                "businessID": "biz_hold_selby",
                "surface": "settings",
                "payload": {"postalCode": "YO8 4AB"},
            },
            {
                "label": "one-page-changes-and-the-others-do-not",
                "businessID": "biz_hold_calder",
                "surface": "settings",
                "payload": {"pages": {"invoice": {"text": "Statements"}}},
            },
            {
                "label": "switching-a-page-off-is-a-value-not-a-silence",
                "businessID": "biz_hold_teviot",
                "surface": "settings",
                "payload": {"pages": {"invoice": {"enabled": False}}},
            },
            {
                "label": "look-and-feel-merges-key-by-key",
                "businessID": "biz_hold_amberley",
                "surface": "settings",
                "payload": {"pages": {"offering": {"appearance": {"accent": "#0969da"}}}},
            },
            {
                "label": "moving-onto-the-cluster-source-starts-the-hourly-job",
                "businessID": "biz_hold_penrith",
                "surface": "settings",
                "payload": {"computeCostSource": "eks"},
            },
            {
                "label": "moving-off-the-cluster-source-stops-the-hourly-job",
                "businessID": "biz_hold_ardley",
                "surface": "settings",
                "payload": {"computeCostSource": "none"},
            },
            {
                "label": "restating-the-cluster-source-changes-nothing",
                "businessID": "biz_hold_wenlock",
                "surface": "settings",
                "payload": {"computeCostSource": "eks", "city": "Telford"},
            },
            {
                "label": "the-profile-save-merges-like-any-other",
                "businessID": "biz_hold_fenwick",
                "surface": "profile",
                "payload": {"city": "Newcastle"},
            },
            {
                "label": "the-profile-save-carries-only-a-profile",
                "businessID": "biz_hold_ravensworth",
                "surface": "profile",
                "payload": {"supportEmail": "ap@ravensworth.example", "invoiceApproval": "manual"},
            },
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = parser.parse_args()

    sandbox_dir = os.path.join(args.out, "sandbox")
    verifier_dir = os.path.join(args.out, "verifier-data")
    os.makedirs(sandbox_dir, exist_ok=True)
    os.makedirs(verifier_dir, exist_ok=True)

    sandbox_doc = sandbox()
    holdout_doc = holdout()

    sandbox_ids = {row["tags"]["businessID"] for row in sandbox_doc["influx"]["buckets"][BUCKET]}
    holdout_ids = {row["tags"]["businessID"] for row in holdout_doc["influx"]["buckets"][BUCKET]}
    overlap = sandbox_ids & holdout_ids
    if overlap:
        raise SystemExit(f"the sandbox and the held-out ledger share businesses: {sorted(overlap)}")

    spec = run_spec()
    unknown = {step["businessID"] for step in spec["steps"]} - holdout_ids
    if unknown:
        raise SystemExit(f"the run spec names businesses the held-out ledger does not carry: {sorted(unknown)}")

    for path, payload in (
        (os.path.join(sandbox_dir, "public.json"), sandbox_doc),
        (os.path.join(verifier_dir, "holdout.json"), holdout_doc),
        (os.path.join(verifier_dir, "run-spec.json"), spec),
    ):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=False)
            handle.write("\n")
        print(f"wrote {path}")

    readme = os.path.join(sandbox_dir, "README")
    with open(readme, "w", encoding="utf-8") as handle:
        handle.write(
            "Configuration ledger for the two businesses this box serves.\n"
            "\n"
            "Orchard Systems has a fully filled-in document, including a postal code\n"
            "and a tax category recorded as empty strings. Kite Analytics was only\n"
            "ever recorded with an address line, a city and a country, so the rest of\n"
            "its document has never been written at all.\n"
        )
    print(f"wrote {readme}")


if __name__ == "__main__":
    main()
