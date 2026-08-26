"""The tenant identity provider, standing in for the hosted one.

Not an AWS service: it answers the management API that the backend administers
machine credentials through, plus the token endpoint those credentials are
exchanged at and the public key set the API validates bearer tokens against.
Everything is served from the same endpoint as the rest of the world so a box
needs exactly one address configured; requests are routed here by path
(`/oauth/token`, `/.well-known/jwks.json`, `/api/v2/...`) rather than by SigV4
scope, because management calls are bearer-authenticated rather than signed.

Behaviours that matter to a caller and are therefore modelled faithfully:

* a machine credential is a client with an id and a secret, and the pair is the
  only way to obtain a bearer token;
* rotating a secret replaces it in place -- the id survives, the old secret is
  refused from the next request onwards, and nothing else about the client
  changes;
* deleting a client removes it, so neither the old secret nor a newly rotated
  one will mint anything afterwards;
* the client listing is paginated and, because the platform asks for it with
  `include_fields=false` over the secret fields, it never carries secrets;
* a token minted for a client carries `<client_id>@clients` as its subject,
  which is the identity the rest of the platform stores configuration under.

Tokens are RS256, signed with a fixed key held below so that a run is
reproducible and so that no third-party crypto library is required.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from typing import Any
from urllib.parse import parse_qsl, unquote

from ..state import Client, World
from ..wire import Request, Response, rest_json_response

API_PREFIX = "/api/v2/"
ISSUER = "https://auth.meteringco.example/"
KEY_ID = "meteringco-local-signing-key"
MANAGEMENT_AUDIENCE_MARKER = "/api/v2/"

# A fixed 2048-bit RSA key. The public half is published at the JWKS endpoint
# and the private half signs tokens; both are constants so that two runs of the
# same scenario produce byte-identical material.
RSA_N = int(
    "944daddf171731cb3b616c6b2a187ee835636f35ae362eefbe61ddc248c9f486a30921603de8514c0499e68adc34c167"
    "01e224f5838f1cb7df6c9e064e8211d9c6ed187e5dd821d4730682fcb275c0632b2b7ff80d6d162f451c3357dd5d2429"
    "2f6e4bf4eb7f767f1cdaaee2d5ee57d45f5f7a091e1aa4abafa2a00b7227312857c0d455351b2e7755a7d4341d52241f"
    "6548fb5c338990e9ebf63ae1b87aabefbafc34754292a86e53e8c1f00b79cbde62afcda59ca9085ac2a63aa1ede8d03e"
    "169b1f96dce554fc04a0d8025686ff2e754ad5eff4d30894ffef3122184081b906b5b4eeb757afa198b5b02489c6ab2b"
    "641bc331a51d0042d279890dd2a375d5",
    16,
)
RSA_E = 65537
RSA_D = int(
    "dfd87fe08391d6eed32a31e36f1e9a2f14a6896d950ee3b9aabb3d65cb4849760f0ff0f8bb78b57cf054fbce0ca2f468"
    "ee46d15262c8d8a810ec79793b76c84ad61f792103b4ff1b14a37782c43b47b067b0b8ef4814a7afa1b8f7266051fe0a"
    "cc34c7215f747cff50262462ee555aec8b2829a329753da886ea08783e4d39bb46b524fe7aa4119940e7b96d7fdc5daa"
    "0247d577b7a5fbd8ead0e3ed670bfb61178da8a0fa452932dc7eefe1d79cf67afb528d11ae2cf2ea6ac6c8bf9abc937c"
    "20221ed4350008ecf7cf4b44dd28990e7bca2790a745236bf3a96bdc6ae1d0bed68667fb439c2776508067bc07eaea30"
    "4e2ab0495786640ffedff0b983f38e1",
    16,
)
_KEY_BYTES = (RSA_N.bit_length() + 7) // 8
_SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")

TOKEN_LIFETIME_SECONDS = 3600


# The management API and the time-series store both live under `/api/v2/`, so
# the collections this provider answers for are named rather than inferred.
MANAGEMENT_COLLECTIONS = ("clients", "users", "users-by-email", "resource-servers")


def owns(path: str) -> bool:
    clean = path.strip().rstrip("/")
    if clean in ("/oauth/token", "/.well-known/jwks.json", "/.well-known/openid-configuration"):
        return True
    if not path.strip().startswith(API_PREFIX):
        return False
    collection = path.strip()[len(API_PREFIX) :].split("/", 1)[0].split("?", 1)[0]
    return collection in MANAGEMENT_COLLECTIONS


def handle(world: World, req: Request) -> Response:
    path = req.path.strip()
    clean = path.rstrip("/")

    if clean == "/.well-known/jwks.json":
        return rest_json_response({"keys": [_public_jwk()]})
    if clean == "/.well-known/openid-configuration":
        return rest_json_response(
            {
                "issuer": ISSUER,
                "jwks_uri": f"{ISSUER}.well-known/jwks.json",
                "token_endpoint": f"{ISSUER}oauth/token",
            }
        )
    if clean == "/oauth/token":
        return _issue_token(world, req)

    if not _management_bearer(world, req):
        return rest_json_response(
            {"statusCode": 401, "error": "Unauthorized", "message": "Missing authentication"}, 401
        )

    route = path[len(API_PREFIX) :].strip("/") if path.startswith(API_PREFIX) else ""
    parts = [unquote(segment) for segment in route.split("/") if segment]
    method = req.method.upper()

    if parts[:1] == ["clients"]:
        return _clients(world, req, parts, method)
    if parts[:1] == ["users"]:
        return _users(world, req, parts, method)
    return rest_json_response(
        {"statusCode": 404, "error": "Not Found", "message": f"Unknown management route: {route}"}, 404
    )


# ---------------------------------------------------------------------------
# signing
# ---------------------------------------------------------------------------


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _int_to_b64(value: int) -> str:
    length = (value.bit_length() + 7) // 8
    return _b64(value.to_bytes(length, "big"))


def _public_jwk() -> dict[str, Any]:
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": KEY_ID,
        "n": _int_to_b64(RSA_N),
        "e": _int_to_b64(RSA_E),
    }


def _sign_rs256(signing_input: bytes) -> bytes:
    """RSASSA-PKCS1-v1_5 over SHA-256, by hand.

    Deliberately dependency-free: the image is not guaranteed to carry a Python
    crypto library and the signature only has to satisfy a standards-compliant
    verifier, which is a few lines of modular arithmetic.
    """
    digest = hashlib.sha256(signing_input).digest()
    encoded = _SHA256_DIGEST_INFO + digest
    padding_length = _KEY_BYTES - len(encoded) - 3
    block = b"\x00\x01" + b"\xff" * padding_length + b"\x00" + encoded
    signature = pow(int.from_bytes(block, "big"), RSA_D, RSA_N)
    return signature.to_bytes(_KEY_BYTES, "big")


def mint_access_token(claims: dict[str, Any]) -> str:
    header = {"alg": "RS256", "typ": "JWT", "kid": KEY_ID}
    segments = [
        _b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode()),
        _b64(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()),
    ]
    signing_input = ".".join(segments).encode()
    segments.append(_b64(_sign_rs256(signing_input)))
    return ".".join(segments)


# ---------------------------------------------------------------------------
# token endpoint
# ---------------------------------------------------------------------------


def _form(req: Request) -> dict[str, str]:
    content_type = req.header("content-type")
    body = req.body.decode("utf-8", "replace") if req.body else ""
    if "json" in content_type:
        try:
            parsed = json.loads(body or "{}")
        except json.JSONDecodeError:
            return {}
        return {str(k): str(v) for k, v in parsed.items()}
    return dict(parse_qsl(body, keep_blank_values=True))


def _issue_token(world: World, req: Request) -> Response:
    payload = _form(req)
    client_id = payload.get("client_id", "")
    client_secret = payload.get("client_secret", "")
    audience = payload.get("audience", "")

    client = world.identity.clients.get(client_id)
    if client is None or client.client_secret != client_secret:
        world.identity.token_denials.append(
            {"at": time.time(), "client_id": client_id, "reason": "unknown client" if client is None else "bad secret"}
        )
        return rest_json_response(
            {"error": "access_denied", "error_description": "Unauthorized"},
            401,
        )

    world.identity.token_grants.append({"at": time.time(), "client_id": client_id, "audience": audience})

    if MANAGEMENT_AUDIENCE_MARKER in audience or client.management:
        digest = hashlib.sha1(f"{world.seed}:{client_id}:management".encode()).hexdigest()
        return rest_json_response(
            {
                "access_token": f"mgmt.{digest}",
                "expires_in": 86400,
                "scope": payload.get("scope", ""),
                "token_type": "Bearer",
            }
        )

    now = int(time.time())
    subject = client.token_subject()
    granted = client.permissions
    if granted is None:
        granted = world.identity.permissions.get(subject, [])
    claims = {
        "iss": ISSUER,
        "sub": subject,
        "aud": audience or world.identity.api_audience,
        "azp": client_id,
        "iat": now,
        "exp": now + TOKEN_LIFETIME_SECONDS,
        "gty": "client-credentials",
        "permissions": list(granted),
    }
    return rest_json_response(
        {
            "access_token": mint_access_token(claims),
            "expires_in": TOKEN_LIFETIME_SECONDS,
            "token_type": "Bearer",
        }
    )


def _management_bearer(world: World, req: Request) -> bool:
    header = req.header("authorization")
    if not header.lower().startswith("bearer "):
        return False
    return len(header.split(" ", 1)[-1].strip()) > 0


# ---------------------------------------------------------------------------
# clients
# ---------------------------------------------------------------------------


def _client_json(client: Client, include_secret: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "client_id": client.client_id,
        "name": client.name,
        "app_type": client.app_type,
        "tenant": "meteringco",
        "grant_types": ["client_credentials"],
    }
    if include_secret:
        body["client_secret"] = client.client_secret
    return body


def _clients(world: World, req: Request, parts: list[str], method: str) -> Response:
    identity = world.identity

    if len(parts) == 1 and method == "GET":
        return _list_clients(world, req)

    if len(parts) >= 2:
        client_id = parts[1]
        client = identity.clients.get(client_id)
        if client is None:
            return rest_json_response(
                {"statusCode": 404, "error": "Not Found", "message": "The client does not exist."}, 404
            )
        if len(parts) == 2 and method == "GET":
            return rest_json_response(_client_json(client))
        if len(parts) == 2 and method == "DELETE":
            del identity.clients[client_id]
            identity.deleted_client_ids.append(client_id)
            return Response(status=204, body=b"", headers={"Content-Type": "application/json"})
        if len(parts) == 3 and parts[2] == "rotate-secret" and method == "POST":
            client.client_secret = identity.next_secret(world.seed, client_id)
            identity.rotations.append({"at": time.time(), "client_id": client_id})
            return rest_json_response(_client_json(client, include_secret=True))

    return rest_json_response(
        {"statusCode": 405, "error": "Method Not Allowed", "message": "Unsupported client operation"}, 405
    )


def _list_clients(world: World, req: Request) -> Response:
    identity = world.identity
    ordered = [identity.clients[key] for key in sorted(identity.clients)]

    include_totals = req.query.get("include_totals", "false").lower() == "true"
    try:
        per_page = int(req.query.get("per_page", "50"))
    except ValueError:
        per_page = 50
    per_page = max(1, min(per_page, 100))
    try:
        page = int(req.query.get("page", "0"))
    except ValueError:
        page = 0
    page = max(0, page)

    start = page * per_page
    window = ordered[start : start + per_page]
    # `fields` selects columns and `include_fields` says whether the selection is
    # a whitelist or a blacklist, so a listing only carries secrets when one is
    # asked for explicitly.
    selected = {field.strip() for field in req.query.get("fields", "").split(",") if field.strip()}
    whitelist = req.query.get("include_fields", "true").lower() == "true"
    include_secret = whitelist and "client_secret" in selected

    body = [_client_json(client, include_secret=include_secret) for client in window]
    if not include_totals:
        return rest_json_response(body)
    return rest_json_response(
        {"start": start, "limit": per_page, "total": len(ordered), "clients": body}
    )


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------


def _users(world: World, req: Request, parts: list[str], method: str) -> Response:
    identity = world.identity
    if len(parts) >= 2:
        subject = parts[1]
        if len(parts) == 3 and parts[2] == "permissions":
            if method == "GET":
                granted = identity.permissions.get(subject, [])
                return rest_json_response(
                    [
                        {
                            "permission_name": name,
                            "resource_server_identifier": identity.api_audience,
                        }
                        for name in granted
                    ]
                )
            if method == "POST":
                payload = req.json()
                requested = [
                    entry.get("permission_name")
                    for entry in (payload.get("permissions") or [])
                    if entry.get("permission_name")
                ]
                current = identity.permissions.setdefault(subject, [])
                for name in requested:
                    if name not in current:
                        current.append(name)
                identity.permission_grants.append(
                    {"at": time.time(), "subject": subject, "permissions": requested}
                )
                return rest_json_response({}, 201)
            if method == "DELETE":
                payload = req.json()
                revoked = {
                    entry.get("permission_name")
                    for entry in (payload.get("permissions") or [])
                    if entry.get("permission_name")
                }
                current = identity.permissions.setdefault(subject, [])
                identity.permissions[subject] = [name for name in current if name not in revoked]
                return Response(status=204, body=b"", headers={"Content-Type": "application/json"})
        if len(parts) == 2 and method == "GET":
            client_id = subject.split("@")[0]
            client = identity.clients.get(client_id)
            if client is None:
                return rest_json_response(
                    {"statusCode": 404, "error": "Not Found", "message": "The user does not exist."}, 404
                )
            return rest_json_response(
                {"user_id": subject, "name": client.name, "email": "", "user_metadata": {}}
            )
    return rest_json_response(
        {"statusCode": 405, "error": "Method Not Allowed", "message": "Unsupported user operation"}, 405
    )
