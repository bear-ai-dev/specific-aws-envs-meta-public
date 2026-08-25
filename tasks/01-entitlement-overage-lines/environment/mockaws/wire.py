"""Wire-format helpers shared by the service implementations.

Covers the four protocol families AWS actually uses for the services we mock:
`query` (EC2/IAM/STS/AutoScaling/CloudWatch), `rest-xml` (S3), `json-1.1`
(Cost Explorer/Pricing), and `rest-json` (EKS).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, unquote

XMLNS_EC2 = "http://ec2.amazonaws.com/doc/2016-11-15/"
XMLNS_IAM = "https://iam.amazonaws.com/doc/2010-05-08/"
XMLNS_STS = "https://sts.amazonaws.com/doc/2011-06-15/"
XMLNS_ASG = "http://autoscaling.amazonaws.com/doc/2011-01-01/"
XMLNS_CW = "http://monitoring.amazonaws.com/doc/2010-08-01/"
XMLNS_S3 = "http://s3.amazonaws.com/doc/2006-03-01/"

_AUTH_CREDENTIAL = re.compile(r"Credential=([^/]+)/[^/]+/([^/]+)/([^/]+)/aws4_request")


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, str]
    headers: dict[str, str]
    body: bytes

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def form(self) -> dict[str, str]:
        return dict(parse_qsl(self.text, keep_blank_values=True))

    def json(self) -> dict[str, Any]:
        if not self.body:
            return {}
        return json.loads(self.text)

    def header(self, name: str, default: str = "") -> str:
        return self.headers.get(name.lower(), default)


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    headers: dict[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.headers is None:
            self.headers = {}


def xml_response(body: str, status: int = 200) -> Response:
    payload = ('<?xml version="1.0" encoding="UTF-8"?>\n' + body).encode()
    return Response(status=status, body=payload, headers={"Content-Type": "application/xml"})


def json_response(payload: Any, status: int = 200) -> Response:
    body = json.dumps(payload, separators=(",", ":")).encode()
    return Response(status=status, body=body, headers={"Content-Type": "application/x-amz-json-1.1"})


def rest_json_response(payload: Any, status: int = 200) -> Response:
    body = json.dumps(payload, separators=(",", ":")).encode()
    return Response(status=status, body=body, headers={"Content-Type": "application/json"})


def escape(value: Any) -> str:
    text = "" if value is None else str(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def tag(name: str, value: Any) -> str:
    return f"<{name}>{escape(value)}</{name}>"


def credential_service(headers: dict[str, str]) -> tuple[str | None, str | None]:
    """Extract (access_key_id, service) from a SigV4 Authorization header."""
    auth = headers.get("authorization", "")
    match = _AUTH_CREDENTIAL.search(auth)
    if not match:
        return None, None
    return match.group(1), match.group(3)


def query_action(req: Request) -> str:
    if req.method == "POST" and "x-www-form-urlencoded" in req.header("content-type"):
        return req.form().get("Action", "")
    return req.query.get("Action", "")


def json_target(req: Request) -> str:
    target = req.header("x-amz-target")
    return target.split(".")[-1] if target else ""


def flatten_members(form: dict[str, str], prefix: str) -> list[str]:
    """Collect `Prefix.member.1`, `Prefix.member.2`, ... in order."""
    out: list[tuple[int, str]] = []
    pattern = re.compile(rf"^{re.escape(prefix)}\.(?:member\.)?(\d+)$")
    for key, value in form.items():
        match = pattern.match(key)
        if match:
            out.append((int(match.group(1)), value))
    return [value for _, value in sorted(out)]


def flatten_structs(form: dict[str, str], prefix: str) -> list[dict[str, str]]:
    """Collect `Prefix.member.N.Field` groups into dicts, ordered by N."""
    grouped: dict[int, dict[str, str]] = {}
    pattern = re.compile(rf"^{re.escape(prefix)}\.(?:member\.)?(\d+)\.(.+)$")
    for key, value in form.items():
        match = pattern.match(key)
        if match:
            grouped.setdefault(int(match.group(1)), {})[match.group(2)] = value
    return [grouped[index] for index in sorted(grouped)]


def error_xml(code: str, message: str, status: int, request_id: str = "mockaws-request") -> Response:
    body = (
        "<ErrorResponse>"
        f"<Error><Type>Sender</Type>{tag('Code', code)}{tag('Message', message)}</Error>"
        f"{tag('RequestId', request_id)}"
        "</ErrorResponse>"
    )
    return xml_response(body, status=status)


def error_s3(code: str, message: str, status: int, resource: str = "") -> Response:
    body = (
        "<Error>"
        f"{tag('Code', code)}{tag('Message', message)}{tag('Resource', resource)}"
        f"{tag('RequestId', 'mockaws-request')}"
        "</Error>"
    )
    return xml_response(body, status=status)


def error_json(code: str, message: str, status: int) -> Response:
    payload = {"__type": code, "message": message, "Message": message}
    return json_response(payload, status=status)


def decode_path(path: str) -> str:
    return unquote(path)
