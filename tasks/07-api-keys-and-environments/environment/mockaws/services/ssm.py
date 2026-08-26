"""SSM (json-1.1): the public global-infrastructure parameter tree.

Only the region long-name lookups are served; that is the one parameter the
metering path reads, and its values are public AWS metadata rather than
anything a scenario needs to declare.
"""

from __future__ import annotations

from ..state import Session, World
from ..wire import Request, Response, error_json, json_response, json_target

REGION_LONG_NAMES = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "eu-west-1": "Europe (Ireland)",
    "eu-central-1": "Europe (Frankfurt)",
    "ap-south-1": "Asia Pacific (Mumbai)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
    "ap-southeast-2": "Asia Pacific (Sydney)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
    "ca-central-1": "Canada (Central)",
    "sa-east-1": "South America (Sao Paulo)",
}

PREFIX = "/aws/service/global-infrastructure/regions/"
SUFFIX = "/longName"


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("UnrecognizedClientException", "The security token is invalid", 403)
    if json_target(req) != "GetParameter":
        return error_json("InvalidAction", "Only GetParameter is supported", 400)

    name = req.json().get("Name", "")
    if not (name.startswith(PREFIX) and name.endswith(SUFFIX)):
        return error_json("ParameterNotFound", f"Parameter {name} not found", 400)

    code = name[len(PREFIX) : -len(SUFFIX)]
    value = REGION_LONG_NAMES.get(code)
    if value is None:
        return error_json("ParameterNotFound", f"Parameter {name} not found", 400)

    return json_response(
        {
            "Parameter": {
                "Name": name,
                "Type": "String",
                "Value": value,
                "Version": 1,
                "ARN": f"arn:aws:ssm:{world.region}::parameter{name}",
                "DataType": "text",
            }
        }
    )
