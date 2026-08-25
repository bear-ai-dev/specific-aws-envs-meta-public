"""HTTP front end for the mock AWS control plane.

One endpoint serves every mocked service. Dispatch is by the service name in
the SigV4 credential scope (`Credential=AKIA.../<date>/<region>/<service>/...`),
which every AWS SDK sends, so `boto3` and the AWS CLI work against this server
with nothing more than `--endpoint-url`.

An admin plane lives under `/_admin/*`, gated by a bearer token supplied at
startup. The token is only ever placed in the verifier's environment, so a task
agent can observe the world exactly as an AWS client would and no other way.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qsl, urlparse

from .faults import FaultInjector, Throttled, TransientServerError
from .services import (
    autoscaling,
    cloudtrail,
    cloudwatch,
    costexplorer,
    ec2,
    eks,
    iam,
    pricing,
    s3,
    sts,
)
from .state import World
from .wire import Request, Response, credential_service, error_json, error_s3, error_xml, json_target, query_action

SERVICE_BY_SCOPE = {
    "s3": "s3",
    "sts": "sts",
    "iam": "iam",
    "ec2": "ec2",
    "eks": "eks",
    "monitoring": "cloudwatch",
    "autoscaling": "autoscaling",
    "ce": "ce",
    "pricing": "pricing",
    "api.pricing": "pricing",
    "cloudtrail": "cloudtrail",
}

QUERY_PROTOCOL = {"sts", "iam", "ec2", "autoscaling", "cloudwatch"}
# The AWS SDK pinned in the serviced project still speaks the historical query
# protocol to CloudWatch, so it is grouped with EC2 and STS rather than with the
# JSON services.
JSON_PROTOCOL = {"ce", "pricing", "cloudtrail"}

# EKS is REST-JSON: its actions come from the request path rather than a target
# header, so it is not in JSON_PROTOCOL, but its errors are still JSON. Sending
# it a query-protocol XML error would leave the SDK unable to read the error
# code, and a throttle the SDK cannot recognise is a throttle it cannot retry.
JSON_ERROR_PROTOCOL = JSON_PROTOCOL | {"eks"}


class MockAws:
    def __init__(self, scenario: dict[str, Any], seed: int = 0, anchor: datetime | None = None) -> None:
        self.seed = seed
        self.anchor = anchor
        self.world = World(scenario, seed=seed, anchor=anchor)
        self.injector = FaultInjector(scenario.get("faults"), seed=seed)
        self.calls: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    def reseed(self, scenario: dict[str, Any], seed: int | None = None) -> None:
        with self._lock:
            self.seed = self.seed if seed is None else seed
            self.world = World(scenario, seed=self.seed, anchor=self.anchor)
            self.injector = FaultInjector(scenario.get("faults"), seed=self.seed)
            self.calls = []

    # ---- dispatch -----------------------------------------------------

    def _resolve_service(self, req: Request) -> str:
        _, scope = credential_service(req.headers)
        if scope and scope in SERVICE_BY_SCOPE:
            return SERVICE_BY_SCOPE[scope]
        target = req.header("x-amz-target")
        if target.startswith("GraniteServiceVersion"):
            return "cloudwatch"
        if target.startswith("AWSInsightsIndexService"):
            return "ce"
        if target.startswith("AWSPriceListService"):
            return "pricing"
        if target.startswith("CloudTrail"):
            return "cloudtrail"
        path = req.path
        if path.startswith("/clusters"):
            return "eks"
        action = query_action(req)
        if action in ("AssumeRole", "GetCallerIdentity"):
            return "sts"
        return "s3"

    def _action_name(self, service: str, req: Request) -> str:
        if service == "s3":
            if req.method == "GET" and req.query.get("list-type") == "2":
                return "ListObjectsV2"
            if req.method == "GET" and "versions" in req.query:
                return "ListObjectVersions"
            if req.method == "GET":
                for marker, name in (
                    ("lifecycle", "GetBucketLifecycleConfiguration"),
                    ("intelligent-tiering", "ListBucketIntelligentTieringConfigurations"),
                    ("replication", "GetBucketReplication"),
                    ("requestPayment", "GetBucketRequestPayment"),
                    ("location", "GetBucketLocation"),
                    ("uploads", "ListMultipartUploads"),
                    ("uploadId", "ListParts"),
                    ("tagging", "GetObjectTagging"),
                ):
                    if marker in req.query:
                        return name
            return {"GET": "GetObject", "PUT": "PutObject", "HEAD": "HeadObject", "DELETE": "DeleteObject"}.get(
                req.method, req.method
            )
        if service == "eks":
            return f"{req.method} {req.path}"
        if service in JSON_PROTOCOL:
            return json_target(req)
        return query_action(req)

    def handle(self, req: Request) -> Response:
        if req.path.startswith("/_admin/"):
            return self._admin(req)

        service = self._resolve_service(req)
        action = self._action_name(service, req)
        access_key, _ = credential_service(req.headers)

        with self._lock:
            self.calls.append(
                {"service": service, "action": action, "access_key": access_key, "at": time.time()}
            )
            try:
                latency = self.injector.before_call(service, action)
            except Throttled:
                return self._throttle_response(service)
            except TransientServerError:
                return self._server_error_response(service)

        if latency:
            time.sleep(latency)

        caller = self.world.session_for_key(access_key) if access_key else None

        with self.world.lock:
            if service == "s3":
                return s3.handle(self.world, req, self.injector)
            if service == "sts":
                return sts.handle(self.world, req, self.injector, caller)
            if service == "iam":
                return iam.handle(self.world, req, self.injector, caller)
            if service == "ec2":
                return ec2.handle(self.world, req, self.injector, caller)
            if service == "eks":
                return eks.handle(self.world, req, self.injector, caller)
            if service == "cloudwatch":
                return cloudwatch.handle(self.world, req, self.injector, caller)
            if service == "autoscaling":
                return autoscaling.handle(self.world, req, self.injector, caller)
            if service == "ce":
                return costexplorer.handle(self.world, req, self.injector, caller)
            if service == "pricing":
                return pricing.handle(self.world, req, self.injector, caller)
            if service == "cloudtrail":
                return cloudtrail.handle(self.world, req, self.injector, caller)
        return error_xml("InvalidAction", f"Unroutable request: {req.method} {req.path}", 400)

    def _throttle_response(self, service: str) -> Response:
        message = "Rate exceeded"
        if service == "s3":
            return error_s3("SlowDown", "Please reduce your request rate.", 503)
        if service in JSON_ERROR_PROTOCOL:
            return error_json("ThrottlingException", message, 400)
        return error_xml("Throttling", message, 400)

    def _server_error_response(self, service: str) -> Response:
        message = "We encountered an internal error. Please try again."
        if service == "s3":
            return error_s3("InternalError", message, 500)
        if service in JSON_ERROR_PROTOCOL:
            return error_json("InternalFailure", message, 500)
        return error_xml("InternalFailure", message, 500)

    # ---- admin plane --------------------------------------------------

    def _admin(self, req: Request) -> Response:
        expected = os.environ.get("MOCKAWS_ADMIN_TOKEN", "")
        supplied = req.header("x-mockaws-admin-token")
        if not expected or supplied != expected:
            return Response(status=403, body=b'{"error":"forbidden"}', headers={"Content-Type": "application/json"})

        route = req.path[len("/_admin/") :]
        if route == "snapshot":
            with self.world.lock:
                payload = self.world.snapshot()
            return Response(
                status=200,
                body=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
        if route == "calls":
            with self._lock:
                payload = {"calls": self.calls, "fault_counters": self.injector.stats()}
            return Response(
                status=200, body=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
            )
        if route == "reseed" and req.method == "POST":
            payload = req.json()
            self.reseed(payload.get("scenario", {}), payload.get("seed"))
            return Response(status=200, body=b'{"ok":true}', headers={"Content-Type": "application/json"})
        if route == "faults" and req.method == "POST":
            payload = req.json()
            self.injector.enabled = bool(payload.get("enabled", True))
            return Response(status=200, body=b'{"ok":true}', headers={"Content-Type": "application/json"})
        if route == "health":
            return Response(status=200, body=b'{"ok":true}', headers={"Content-Type": "application/json"})
        return Response(status=404, body=b'{"error":"unknown admin route"}', headers={"Content-Type": "application/json"})


def _make_handler(engine: MockAws):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "mockaws/1.0"

        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            if os.environ.get("MOCKAWS_VERBOSE"):
                super().log_message(fmt, *args)

        def _read(self) -> Request:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            parsed = urlparse(self.path)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            headers = {key.lower(): value for key, value in self.headers.items()}
            return Request(
                method=self.command, path=parsed.path, query=query, headers=headers, body=body
            )

        def _dispatch(self) -> None:
            request = self._read()
            try:
                response = engine.handle(request)
            except Exception as exc:  # noqa: BLE001 - surface as a 500 like AWS would
                response = Response(
                    status=500,
                    body=json.dumps({"error": type(exc).__name__, "message": str(exc)}).encode(),
                    headers={"Content-Type": "application/json"},
                )
            self.send_response(response.status)
            payload = response.body or b""
            declared_length: str | None = None
            for name, value in response.headers.items():
                if name.lower() == "content-length":
                    declared_length = value
                    continue
                self.send_header(name, value)
            # A HEAD reply carries no body but must still advertise the size the
            # matching GET would return, which is what HeadObject reports.
            self.send_header(
                "Content-Length",
                declared_length if self.command == "HEAD" and declared_length else str(len(payload)),
            )
            self.send_header("x-amzn-RequestId", "mockaws-request")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

        do_GET = _dispatch
        do_PUT = _dispatch
        do_POST = _dispatch
        do_HEAD = _dispatch
        do_DELETE = _dispatch

    return Handler


def serve(scenario_path: str, host: str, port: int, seed: int, anchor_epoch: int | None = None) -> None:
    with open(scenario_path, encoding="utf-8") as handle:
        scenario = json.load(handle)
    anchor = None if anchor_epoch is None else datetime.fromtimestamp(anchor_epoch, tz=timezone.utc)
    engine = MockAws(scenario, seed=seed, anchor=anchor)
    httpd = ThreadingHTTPServer((host, port), _make_handler(engine))
    httpd.daemon_threads = True
    print(
        f"mockaws listening on http://{host}:{port} (scenario={scenario_path}, seed={seed}, "
        f"anchor={'per-request' if anchor is None else anchor.isoformat()})",
        flush=True,
    )
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic mock AWS control plane")
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4566)
    parser.add_argument("--seed", type=int, default=0)
    # Pins the instant relative-timed metric points hang off. Left out, every
    # request resolves them against the hour that has most recently finished.
    parser.add_argument("--anchor-epoch", type=int, default=None)
    args = parser.parse_args()
    serve(args.scenario, args.host, args.port, args.seed, args.anchor_epoch)


if __name__ == "__main__":
    main()
