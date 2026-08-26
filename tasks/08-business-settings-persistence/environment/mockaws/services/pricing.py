"""Pricing API (json-1.1): GetProducts / DescribeServices."""

from __future__ import annotations

import json

from ..state import Session, World
from ..wire import Request, Response, error_json, json_response, json_target


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("UnrecognizedClientException", "The security token is invalid", 403)

    target = json_target(req)
    payload = req.json()

    if target == "DescribeServices":
        services = sorted({item.service_code for item in world.pricing})
        return json_response(
            {"Services": [{"ServiceCode": code, "AttributeNames": []} for code in services], "FormatVersion": "aws_v1"}
        )

    if target != "GetProducts":
        return error_json("InvalidParameterException", f"Unsupported Pricing action: {target}", 400)

    service_code = payload.get("ServiceCode", "")
    filters = payload.get("Filters", [])

    def matches(item) -> bool:
        if service_code and item.service_code != service_code:
            return False
        for spec in filters:
            field = spec.get("Field", "")
            value = spec.get("Value", "")
            if item.attributes.get(field) != value:
                return False
        return True

    selected = [item for item in world.pricing if matches(item)]
    max_results = int(payload.get("MaxResults", 100))
    page_size = injector.page_size("pricing", "GetProducts", max_results)
    token = payload.get("NextToken")
    offset = int(token) if token else 0
    page = selected[offset : offset + page_size]

    price_list = [
        json.dumps(
            {
                "product": {
                    "sku": item.sku,
                    "productFamily": item.attributes.get("productFamily", "Compute Instance"),
                    "attributes": item.attributes,
                },
                "serviceCode": item.service_code,
                "terms": item.terms,
                "version": "20260101000000",
                "publicationDate": "2026-01-01T00:00:00Z",
            },
            separators=(",", ":"),
        )
        for item in page
    ]
    response = {"FormatVersion": "aws_v1", "PriceList": price_list}
    if offset + page_size < len(selected):
        response["NextToken"] = str(offset + page_size)
    return json_response(response)
