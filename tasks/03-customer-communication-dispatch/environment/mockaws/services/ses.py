"""SES (query protocol, API version 2010-12-01).

Only the actions the backend's mail path touches are served: `SendEmail`, plus
the two read calls an operator would use to check what the account is allowed
to send as. Everything else answers `InvalidAction`, the way a region that has
not enabled a feature would.

Every accepted `SendEmail` is appended to the account's outbox. The outbox is
the record of what actually left the process: the envelope, the headers as they
were framed on the wire, and the body parts exactly as supplied. It is written
verbatim, with no normalisation, because the point of keeping it is to be able
to tell two nearly identical framings apart afterwards.

Set `MOCKAWS_SES_OUTBOX` to have each accepted message appended to that file as
one JSON object per line as well as held in memory.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

from ..state import Session, World, iso
from ..wire import Request, Response, error_xml, escape, query_action, tag, xml_response

XMLNS_SES = "http://ses.amazonaws.com/doc/2010-12-01/"

_ANGLE_ADDRESS = re.compile(r"<([^<>]*)>\s*$")


def bare_address(value: str) -> str:
    """The addr-spec inside a `Display Name <local@domain>` header value."""
    match = _ANGLE_ADDRESS.search(value or "")
    return (match.group(1) if match else (value or "")).strip()


def _members(form: dict[str, str], prefix: str) -> list[str]:
    """Collect `Prefix.member.1`, `Prefix.member.2`, ... in wire order.

    A list sent empty arrives as the bare key with no value (`Prefix=`), which
    is indistinguishable from an omitted list once parsed, and is treated as
    such.
    """
    found: list[tuple[int, str]] = []
    pattern = re.compile(rf"^{re.escape(prefix)}\.(?:member\.)?(\d+)$")
    for key, value in form.items():
        match = pattern.match(key)
        if match:
            found.append((int(match.group(1)), value))
    return [value for _, value in sorted(found)]


def _part(form: dict[str, str], prefix: str) -> dict[str, str] | None:
    data = form.get(f"{prefix}.Data")
    if data is None:
        return None
    return {"data": data, "charset": form.get(f"{prefix}.Charset", "")}


def _identity_allowed(world: World, address: str) -> bool:
    identities = world.ses.identities
    if not identities:
        return True
    address = address.lower()
    domain = address.rsplit("@", 1)[-1]
    return address in identities or domain in identities


def _record(world: World, form: dict[str, str], message_id: str) -> dict:
    return {
        "messageId": message_id,
        "at": iso(world.now()),
        "source": form.get("Source", ""),
        "sourceAddress": bare_address(form.get("Source", "")),
        "to": _members(form, "Destination.ToAddresses"),
        "cc": _members(form, "Destination.CcAddresses"),
        "bcc": _members(form, "Destination.BccAddresses"),
        "subject": _part(form, "Message.Subject"),
        "text": _part(form, "Message.Body.Text"),
        "html": _part(form, "Message.Body.Html"),
        "replyTo": _members(form, "ReplyToAddresses"),
        "configurationSet": form.get("ConfigurationSetName", ""),
    }


def _send_email(world: World, form: dict[str, str]) -> Response:
    source = form.get("Source", "")
    destinations = _members(form, "Destination.ToAddresses")

    if not source:
        return error_xml("MissingParameter", "Missing required header 'Source'.", 400)
    if not destinations:
        return error_xml("MissingParameter", "Missing required header 'Destination'.", 400)
    if form.get("Message.Subject.Data") is None:
        return error_xml("MissingParameter", "Missing required header 'Message.Subject'.", 400)
    if form.get("Message.Body.Text.Data") is None and form.get("Message.Body.Html.Data") is None:
        return error_xml("MissingParameter", "Missing required header 'Message.Body'.", 400)

    if not _identity_allowed(world, bare_address(source)):
        return error_xml(
            "MessageRejected",
            f"Email address is not verified. The following identities failed the check in region "
            f"{world.region.upper()}: {bare_address(source)}",
            400,
        )

    blocked = [
        address for address in destinations if bare_address(address).lower() in world.ses.suppressed
    ]
    if blocked:
        # An address on the account-level suppression list is refused outright;
        # nothing is queued and nothing reaches the outbox.
        return error_xml(
            "MessageRejected",
            f"Recipient address on the account-level suppression list: {blocked[0]}",
            400,
        )

    seed = f"{world.seed}:{len(world.ses.outbox)}:{source}:{destinations[0]}".encode()
    message_id = f"0100{hashlib.sha1(seed).hexdigest()[:20]}-mockaws"
    entry = _record(world, form, message_id)
    world.ses.outbox.append(entry)

    path = os.environ.get("MOCKAWS_SES_OUTBOX")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()

    body = (
        f'<SendEmailResponse xmlns="{XMLNS_SES}">'
        f"<SendEmailResult>{tag('MessageId', message_id)}</SendEmailResult>"
        f"<ResponseMetadata>{tag('RequestId', 'mockaws-request')}</ResponseMetadata>"
        "</SendEmailResponse>"
    )
    return xml_response(body)


def _list_identities(world: World) -> Response:
    members = "".join(f"<member>{escape(name)}</member>" for name in sorted(world.ses.identities))
    body = (
        f'<ListIdentitiesResponse xmlns="{XMLNS_SES}">'
        f"<ListIdentitiesResult><Identities>{members}</Identities></ListIdentitiesResult>"
        f"<ResponseMetadata>{tag('RequestId', 'mockaws-request')}</ResponseMetadata>"
        "</ListIdentitiesResponse>"
    )
    return xml_response(body)


def _verification_attributes(world: World, form: dict[str, str]) -> Response:
    asked = _members(form, "Identities") or sorted(world.ses.identities)
    entries = "".join(
        "<entry>"
        f"{tag('key', name)}"
        "<value>"
        f"{tag('VerificationStatus', 'Success' if name.lower() in world.ses.identities else 'Failed')}"
        "</value>"
        "</entry>"
        for name in asked
    )
    body = (
        f'<GetIdentityVerificationAttributesResponse xmlns="{XMLNS_SES}">'
        "<GetIdentityVerificationAttributesResult>"
        f"<VerificationAttributes>{entries}</VerificationAttributes>"
        "</GetIdentityVerificationAttributesResult>"
        f"<ResponseMetadata>{tag('RequestId', 'mockaws-request')}</ResponseMetadata>"
        "</GetIdentityVerificationAttributesResponse>"
    )
    return xml_response(body)


def _send_quota(world: World) -> Response:
    body = (
        f'<GetSendQuotaResponse xmlns="{XMLNS_SES}">'
        "<GetSendQuotaResult>"
        f"{tag('Max24HourSend', 50000.0)}{tag('MaxSendRate', 14.0)}"
        f"{tag('SentLast24Hours', float(len(world.ses.outbox)))}"
        "</GetSendQuotaResult>"
        f"<ResponseMetadata>{tag('RequestId', 'mockaws-request')}</ResponseMetadata>"
        "</GetSendQuotaResponse>"
    )
    return xml_response(body)


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid.", 403)

    action = query_action(req)
    form = req.form()

    if action == "SendEmail":
        return _send_email(world, form)
    if action == "ListIdentities":
        return _list_identities(world)
    if action == "GetIdentityVerificationAttributes":
        return _verification_attributes(world, form)
    if action == "GetSendQuota":
        return _send_quota(world)
    return error_xml("InvalidAction", f"Unsupported SES action: {action or '(none)'}", 400)
