#!/usr/bin/env python3
"""Build every document this task runs against.

Four artefacts come out of here:

  public.json               the SES account the sandbox emulator serves.

  sandbox/dispatch-capture/ a recording taken off the running service before
                            the mail path was lost: the communication events
                            the bus carried, and the outbox the endpoint wrote
                            while carrying them. Paired by nothing but their
                            order, the way an operator's capture would be.

  holdout.json              the SES account the verifier serves. Same shape,
                            different identities, different suppression list.

  run-spec.json             the communications the verifier publishes.

The capture is produced by the same `framing()` function that `compute_reward`
re-implements, so the evidence in the box and the answer the grader derives
cannot drift apart: if the convention changes here, the capture changes with
it.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os

REGION = "us-east-1"
BOOTSTRAP_KEY = "LOCALMETERINGKEY02"


# ---------------------------------------------------------------------------
# the framing convention
# ---------------------------------------------------------------------------


def encoded_word(text: str) -> str:
    """RFC 2047 base64 encoded-word, applied whatever the name contains."""
    return "=?UTF-8?B?" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "?="


def framing(email: dict) -> dict:
    """The wire form of one customer communication, as the service framed it."""
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


def dispatched(events: list[dict], suppressed: set[str]) -> list[dict]:
    """Everything the endpoint accepted, for a run over `events` in order."""
    out: list[dict] = []
    for event in events:
        data = event.get("data") or []
        if not data:
            # Nothing to draft from, so nothing is sent and the run carries on.
            continue
        email = data[0]
        if email.get("toEmail", "").lower() in suppressed:
            # Refused by the endpoint; it never reaches the outbox.
            continue
        out.append(framing(email))
    return out


def as_capture(rows: list[dict], started: str = "2026-02-11T08:%02d:17.000Z") -> list[dict]:
    """Dress the framings in the envelope fields the endpoint records."""
    dressed = []
    for index, row in enumerate(rows):
        digest = hashlib.sha1(f"capture:{index}:{row['to'][0]}".encode()).hexdigest()[:20]
        dressed.append(
            {
                "messageId": f"0100{digest}-mockaws",
                "at": started % (12 + index * 3),
                "sourceAddress": bare_address(row["source"]),
                **row,
            }
        )
    return dressed


def bare_address(value: str) -> str:
    start = value.rfind("<")
    end = value.rfind(">")
    return value[start + 1 : end].strip() if 0 <= start < end else value.strip()


# ---------------------------------------------------------------------------
# sandbox
# ---------------------------------------------------------------------------

PUBLIC_IDENTITIES = [
    "meteringco.example",
    "no-reply@meteringco.example",
    "billing@harbor-analytics.example",
]
PUBLIC_SUPPRESSED = ["bounced@lattice-robotics.example"]


def email(
    subject: str,
    from_name: str,
    to_email: str,
    content: str,
    reply_to_name: str,
    *,
    from_email: str = "no-reply@meteringco.example",
    reply_to_email: str = "support@meteringco.example",
    html: bool | None = None,
) -> dict:
    body = {
        "subject": subject,
        "fromName": from_name,
        "fromEmail": from_email,
        "toEmail": to_email,
        "content": content,
        "replyToName": reply_to_name,
        "replyToEmail": reply_to_email,
    }
    if html is not None:
        body["html"] = html
    return body


def event(message: str, data: list[dict]) -> dict:
    return {"message": message, "topic": "EMAIL", "data": data}


def build_public_events() -> list[dict]:
    """One instance of every situation the sandbox is meant to show."""
    return [
        # Plain ASCII sender name, HTML body.
        event(
            "Sending email to customer",
            [
                email(
                    "New invoice from Harbor Analytics #INV-4180",
                    "Harbor Analytics",
                    "ap@harbor-analytics.example",
                    "<html>Hi,<br/>Your statement is ready.</html>",
                    "Harbor Analytics",
                    html=True,
                )
            ],
        ),
        # Accented sender name, plain text body, html absent rather than false.
        event(
            "Sending email to customer",
            [
                email(
                    "Reçu de paiement — Lattice Robotics",
                    "Lattice Robotique Société",
                    "compta@lattice-robotics.example",
                    "Merci pour votre paiement.",
                    "Lattice Robotique Société",
                )
            ],
        ),
        # Reply-to name carries a non-ASCII character too.
        event(
            "Sending email to customer",
            [
                email(
                    "Zahlungserinnerung",
                    "Harbor Analytics",
                    "buchhaltung@harbor-analytics.example",
                    "<html>Guten Tag</html>",
                    "Harbor Kundenbetreuung Groß",
                    reply_to_email="hilfe@meteringco.example",
                    html=True,
                )
            ],
        ),
        # Two drafts arrive on one event.
        event(
            "Sending email to customer",
            [
                email(
                    "Trial ending for Harbor Analytics",
                    "Harbor Analytics",
                    "ops@harbor-analytics.example",
                    "<html>Your trial ends on Friday.</html>",
                    "Harbor Analytics",
                    html=True,
                ),
                email(
                    "Trial ending for Harbor Analytics",
                    "Harbor Analytics",
                    "finance@harbor-analytics.example",
                    "<html>Your trial ends on Friday.</html>",
                    "Harbor Analytics",
                    html=True,
                ),
            ],
        ),
        # An event that arrived with nothing to draft from.
        event("Sending email to customer", []),
        # Recipient the endpoint refuses.
        event(
            "Sending email to customer",
            [
                email(
                    "New invoice from Lattice Robotics #INV-2201",
                    "Lattice Robotics",
                    "bounced@lattice-robotics.example",
                    "<html>Your invoice is attached.</html>",
                    "Lattice Robotics",
                    html=True,
                )
            ],
        ),
        # Sent by a business that mails under its own verified domain, and
        # whose html flag is explicitly false.
        event(
            "Sending email to customer",
            [
                email(
                    "Statement 2026-01 for Harbor Analytics",
                    "Harbor Analytics",
                    "ar@harbor-analytics.example",
                    "Your January statement is ready to download.",
                    "Harbor Support",
                    from_email="billing@harbor-analytics.example",
                    html=False,
                )
            ],
        ),
        # A refused recipient on an event whose second draft is deliverable.
        event(
            "Sending email to customer",
            [
                email(
                    "Renewal notice for Lattice Robotics",
                    "Lattice Robotics",
                    "bounced@lattice-robotics.example",
                    "<html>Your plan renews next month.</html>",
                    "Lattice Robotics",
                    html=True,
                ),
                email(
                    "Renewal notice for Lattice Robotics",
                    "Lattice Robotics",
                    "backup-ap@lattice-robotics.example",
                    "<html>Your plan renews next month.</html>",
                    "Lattice Robotics",
                    html=True,
                ),
            ],
        ),
        # A business that never filled its display name in.
        event(
            "Sending email to customer",
            [
                email(
                    "Receipt for INV-4188",
                    "",
                    "payments@harbor-analytics.example",
                    "Thanks for your payment.",
                    "Harbor Analytics",
                )
            ],
        ),
        # Subject and body outside latin-1.
        event(
            "Sending email to customer",
            [
                email(
                    "請求書 #INV-4190 — Harbor Analytics",
                    "Harbor Analytics 株式会社",
                    "keiri@harbor-analytics.example",
                    "<html>いつもお世話になっております。</html>",
                    "Harbor Analytics 株式会社",
                    html=True,
                )
            ],
        ),
    ]


def build_public() -> dict:
    return {
        "region": REGION,
        "bootstrap_identity": {"account_id": "900000000001", "access_key_id": BOOTSTRAP_KEY},
        "accounts": [{"account_id": "900000000001", "alias": "meteringco-notifications"}],
        "ses": {"identities": PUBLIC_IDENTITIES, "suppressed": PUBLIC_SUPPRESSED},
    }


# ---------------------------------------------------------------------------
# held-out account
# ---------------------------------------------------------------------------

HOLDOUT_IDENTITIES = [
    "meteringco.example",
    "no-reply@meteringco.example",
    "invoices@bravado-freight.example",
]
HOLDOUT_SUPPRESSED = ["hardbounce@meridian-labs.example", "quarantine@sable-foods.example"]


def build_holdout_events() -> list[dict]:
    return [
        # ASCII sender name; the encoded-word applies to it all the same.
        event(
            "Sending email to customer",
            [
                email(
                    "New invoice from Bravado Freight #INV-90311",
                    "Bravado Freight",
                    "accounts@meridian-labs.example",
                    "<html>Hi,<br/>A new invoice is ready for review.</html>",
                    "Bravado Freight",
                    html=True,
                )
            ],
        ),
        # Non-ASCII in the sender name.
        event(
            "Sending email to customer",
            [
                email(
                    "Facture — Bravado Frêt #INV-90312",
                    "Bravado Frêt Société Anonyme",
                    "comptabilite@sable-foods.example",
                    "<html>Bonjour,<br/>Votre facture est disponible.</html>",
                    "Bravado Frêt Société Anonyme",
                    html=True,
                )
            ],
        ),
        # Non-ASCII reply-to name, ASCII sender name: the two are framed
        # differently and this is the event that shows it.
        event(
            "Sending email to customer",
            [
                email(
                    "Zahlungsbestätigung",
                    "Bravado Freight",
                    "kreditoren@nordwind-guss.example",
                    "<html>Vielen Dank für Ihre Zahlung.</html>",
                    "Bravado Kundenbetreuung Groß & Söhne",
                    reply_to_email="hilfe@meteringco.example",
                    html=True,
                )
            ],
        ),
        # No html flag at all.
        event(
            "Sending email to customer",
            [
                email(
                    "Payment received for INV-90309",
                    "Bravado Freight",
                    "ap@kestrel-marine.example",
                    "Thanks for your business.",
                    "Bravado Freight",
                )
            ],
        ),
        # html explicitly false.
        event(
            "Sending email to customer",
            [
                email(
                    "Statement 2026-02 for Kestrel Marine",
                    "Bravado Freight",
                    "statements@kestrel-marine.example",
                    "Your February statement is ready to download.",
                    "Bravado Support",
                    from_email="invoices@bravado-freight.example",
                    html=False,
                )
            ],
        ),
        # Three drafts on one event.
        event(
            "Sending email to customer",
            [
                email(
                    "Contract renewal for Meridian Labs",
                    "Bravado Freight",
                    "legal@meridian-labs.example",
                    "<html>Your contract renews on the 1st.</html>",
                    "Bravado Freight",
                    html=True,
                ),
                email(
                    "Contract renewal for Meridian Labs",
                    "Bravado Freight",
                    "procurement@meridian-labs.example",
                    "<html>Your contract renews on the 1st.</html>",
                    "Bravado Freight",
                    html=True,
                ),
                email(
                    "Contract renewal for Meridian Labs",
                    "Bravado Freight",
                    "cfo@meridian-labs.example",
                    "<html>Your contract renews on the 1st.</html>",
                    "Bravado Freight",
                    html=True,
                ),
            ],
        ),
        # Nothing to draft from.
        event("Sending email to customer", []),
        # Refused recipient sitting between two live ones.
        event(
            "Sending email to customer",
            [
                email(
                    "New invoice from Bravado Freight #INV-90314",
                    "Bravado Freight",
                    "hardbounce@meridian-labs.example",
                    "<html>A new invoice is ready for review.</html>",
                    "Bravado Freight",
                    html=True,
                )
            ],
        ),
        # A second refused recipient, this one on an event whose second draft
        # is deliverable: the message must not fall through to it.
        event(
            "Sending email to customer",
            [
                email(
                    "Overdue notice for Sable Foods",
                    "Bravado Freight",
                    "quarantine@sable-foods.example",
                    "<html>Please review the attached.</html>",
                    "Bravado Freight",
                    html=True,
                ),
                email(
                    "Overdue notice for Sable Foods",
                    "Bravado Freight",
                    "backup-ap@sable-foods.example",
                    "<html>Please review the attached.</html>",
                    "Bravado Freight",
                    html=True,
                ),
            ],
        ),
        # Subject and body carry characters outside latin-1.
        event(
            "Sending email to customer",
            [
                email(
                    "請求書 #INV-90315 — Bravado Freight",
                    "Bravado Freight 株式会社",
                    "keiri@aoi-denki.example",
                    "<html>いつもお世話になっております。</html>",
                    "Bravado Freight 株式会社",
                    html=True,
                )
            ],
        ),
        # An empty display name still gets an encoded-word, which is an empty
        # base64 payload rather than no header at all.
        event(
            "Sending email to customer",
            [
                email(
                    "Receipt for INV-90316",
                    "",
                    "billing@harrow-optics.example",
                    "Thanks for your payment.",
                    "Bravado Freight",
                )
            ],
        ),
        # Last one, so a run that stops early after a refusal is visible.
        event(
            "Sending email to customer",
            [
                email(
                    "New invoice from Bravado Freight #INV-90317",
                    "Bravado Freight",
                    "ap@windlass-rail.example",
                    "<html>A new invoice is ready for review.</html>",
                    "Bravado Freight",
                    html=True,
                )
            ],
        ),
    ]


def build_holdout() -> dict:
    return {
        "region": REGION,
        "bootstrap_identity": {"account_id": "900000000009", "access_key_id": BOOTSTRAP_KEY},
        "accounts": [{"account_id": "900000000009", "alias": "bravado-notifications"}],
        "ses": {"identities": HOLDOUT_IDENTITIES, "suppressed": HOLDOUT_SUPPRESSED},
    }


def build_run_spec() -> dict:
    return {"events": build_holdout_events()}


# ---------------------------------------------------------------------------


def write_json(path: str, document) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, sort_keys=False, ensure_ascii=False)
        handle.write("\n")
    print(f"wrote {path}")


def write_jsonl(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"wrote {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, help="where public.json and the capture go")
    parser.add_argument("--verifier-dir", required=True, help="where holdout.json and run-spec.json go")
    args = parser.parse_args()

    capture_dir = os.path.join(args.out_dir, "dispatch-capture")
    os.makedirs(capture_dir, exist_ok=True)
    os.makedirs(args.verifier_dir, exist_ok=True)

    public_events = build_public_events()
    write_json(os.path.join(args.out_dir, "public.json"), build_public())
    write_jsonl(os.path.join(capture_dir, "communication-events.jsonl"), public_events)
    write_jsonl(
        os.path.join(capture_dir, "ses-outbox.jsonl"),
        as_capture(dispatched(public_events, {a.lower() for a in PUBLIC_SUPPRESSED})),
    )

    write_json(os.path.join(args.verifier_dir, "holdout.json"), build_holdout())
    write_json(os.path.join(args.verifier_dir, "run-spec.json"), build_run_spec())


if __name__ == "__main__":
    main()
