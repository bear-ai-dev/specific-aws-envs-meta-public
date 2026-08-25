"""CloudTrail (json-1.1): LookupEvents over the seeded audit trail."""

from __future__ import annotations

from ..state import Session, World, parse_ts
from ..wire import Request, Response, error_json, json_response, json_target


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("UnrecognizedClientException", "The security token is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_json("AccessDeniedException", "Unknown account", 403)

    if json_target(req) != "LookupEvents":
        return error_json("InvalidParameterException", "Only LookupEvents is supported", 400)

    payload = req.json()
    start = parse_ts(payload["StartTime"]) if "StartTime" in payload else None
    end = parse_ts(payload["EndTime"]) if "EndTime" in payload else None
    attributes = payload.get("LookupAttributes", [])

    def matches(event) -> bool:
        if start is not None and event.event_time < start:
            return False
        if end is not None and event.event_time >= end:
            return False
        for spec in attributes:
            key = spec.get("AttributeKey", "")
            value = spec.get("AttributeValue", "")
            if key == "EventName" and event.event_name != value:
                return False
            if key == "EventSource" and event.event_source != value:
                return False
            if key == "Username" and event.username != value:
                return False
        return True

    selected = [event for event in account.trail if matches(event)]
    requested = int(payload.get("MaxResults", 50))
    page_size = injector.page_size("cloudtrail", "LookupEvents", requested)
    token = payload.get("NextToken")
    offset = int(token) if token else 0
    page = selected[offset : offset + page_size]

    import json as _json

    events = [
        {
            "EventId": event.event_id,
            "EventName": event.event_name,
            "EventSource": event.event_source,
            "EventTime": event.event_time.timestamp(),
            "Username": event.username,
            "Resources": [
                {"ResourceType": item.get("type", ""), "ResourceName": item.get("name", "")}
                for item in event.resources
            ],
            "CloudTrailEvent": _json.dumps(
                {
                    "eventVersion": "1.09",
                    "eventTime": event.event_time.isoformat().replace("+00:00", "Z"),
                    "eventSource": event.event_source,
                    "eventName": event.event_name,
                    "awsRegion": world.region,
                    "userIdentity": {"type": "AssumedRole", "userName": event.username},
                    "requestParameters": event.request_parameters,
                    "errorCode": event.error_code,
                },
                separators=(",", ":"),
            ),
        }
        for event in page
    ]
    response = {"Events": events}
    if offset + page_size < len(selected):
        response["NextToken"] = str(offset + page_size)
    return json_response(response)
