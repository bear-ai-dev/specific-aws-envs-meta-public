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
import gzip
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qsl, urlparse

from .faults import FaultInjector, Throttled, TransientServerError
from .services import (
    auth0,
    autoscaling,
    cloudtrail,
    cloudwatch,
    costexplorer,
    ec2,
    eks,
    iam,
    influx,
    pricing,
    s3,
    ssm,
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
    "ssm": "ssm",
}

QUERY_PROTOCOL = {"sts", "iam", "ec2", "autoscaling"}
# CloudWatch migrated to JSON 1.0 (`GraniteServiceVersion20100801.*`) in
# current SDKs, so it is grouped with the JSON services rather than the
# query-protocol ones despite its historical API shape.
JSON_PROTOCOL = {"ce", "pricing", "cloudtrail", "cloudwatch", "ssm"}

# EKS is REST-JSON: its actions come from the request path rather than a target
# header, so it is not in JSON_PROTOCOL, but its errors are still JSON. Sending
# it a query-protocol XML error would leave the SDK unable to read the error
# code, and a throttle the SDK cannot recognise is a throttle it cannot retry.
JSON_ERROR_PROTOCOL = JSON_PROTOCOL | {"eks"}


class MockAws:
    def __init__(self, scenario: dict[str, Any], seed: int = 0) -> None:
        self.seed = seed
        self.world = World(scenario, seed=seed)
        self.injector = FaultInjector(scenario.get("faults"), seed=seed)
        self.calls: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    def reseed(self, scenario: dict[str, Any], seed: int | None = None) -> None:
        with self._lock:
            self.seed = self.seed if seed is None else seed
            self.world = World(scenario, seed=self.seed)
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
        if target.startswith("AmazonSSM"):
            return "ssm"
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

        # Neither the identity provider nor the time-series store is an AWS
        # service, and neither signs its requests, so both are routed by path
        # before SigV4 scope resolution. The identity provider goes first
        # because its management API also lives under `/api/v2/`.
        if auth0.owns(req.path):
            with self._lock:
                self.calls.append(
                    {"service": "identity", "action": f"{req.method} {req.path}", "access_key": None, "at": time.time()}
                )
            with self.world.lock:
                return auth0.handle(self.world, req)

        if req.path.startswith("/api/v2/") or req.path.rstrip("/") in ("/ping", "/health"):
            with self._lock:
                self.calls.append(
                    {"service": "influx", "action": f"{req.method} {req.path}", "access_key": None, "at": time.time()}
                )
            with self.world.lock:
                return influx.handle(self.world, req)

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
            if service == "ssm":
                return ssm.handle(self.world, req, self.injector, caller)
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

        def _read_chunked(self) -> bytes:
            """A body sent without a declared length, framed as chunks."""
            chunks = []
            while True:
                line = self.rfile.readline(65536).strip()
                if not line:
                    break
                size = int(line.split(b";")[0], 16)
                if size == 0:
                    # Trailers, then the blank line that closes the body.
                    while self.rfile.readline(65536).strip():
                        pass
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)  # the CRLF that ends each chunk
            return b"".join(chunks)

        def _read(self) -> Request:
            # A client that does not know its payload size up front streams the
            # body in chunks and sends no Content-Length. Reading only the
            # declared length sees an empty body in that case, and a handler
            # given an empty body writes nothing while still answering success,
            # so the write disappears with no error anywhere.
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                body = self._read_chunked()
            else:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
            # Clients compress once a payload gets large enough -- the InfluxDB
            # client gzips anything over a kilobyte -- so a handler that reads
            # the body raw sees plausible-looking garbage and quietly stores
            # nothing. Decoding here keeps that from depending on payload size.
            encoding = (self.headers.get("Content-Encoding") or "").lower()
            if body and "gzip" in encoding:
                try:
                    body = gzip.decompress(body)
                except OSError:
                    pass
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


def serve(scenario_path: str, host: str, port: int, seed: int) -> None:
    with open(scenario_path, encoding="utf-8") as handle:
        scenario = json.load(handle)
    engine = MockAws(scenario, seed=seed)
    httpd = ThreadingHTTPServer((host, port), _make_handler(engine))
    httpd.daemon_threads = True
    print(f"mockaws listening on http://{host}:{port} (scenario={scenario_path}, seed={seed})", flush=True)
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic mock AWS control plane")
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4566)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    serve(args.scenario, args.host, args.port, args.seed)


if __name__ == "__main__":
    main()
