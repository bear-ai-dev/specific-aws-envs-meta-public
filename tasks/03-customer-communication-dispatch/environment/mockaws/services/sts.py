"""STS (query protocol). AssumeRole enforces trust policy and ExternalId."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from ..state import Session, World, iso
from ..wire import XMLNS_STS, Request, Response, error_xml, query_action, tag, xml_response

UTC = timezone.utc


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    action = query_action(req)
    form = req.form()
    if action == "AssumeRole":
        return _assume_role(world, form, caller)
    if action == "GetCallerIdentity":
        return _caller_identity(caller)
    return error_xml("InvalidAction", f"Unsupported STS action: {action}", 400)


def _caller_identity(caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    body = (
        f'<GetCallerIdentityResponse xmlns="{XMLNS_STS}"><GetCallerIdentityResult>'
        f"{tag('Arn', caller.arn)}{tag('UserId', caller.access_key_id)}{tag('Account', caller.account_id)}"
        "</GetCallerIdentityResult>"
        "<ResponseMetadata><RequestId>mockaws-sts</RequestId></ResponseMetadata>"
        "</GetCallerIdentityResponse>"
    )
    return xml_response(body)


def _principal_allowed(trust_policy: dict[str, Any], caller_arn: str, caller_account: str) -> bool:
    statements = trust_policy.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]
    for statement in statements:
        if statement.get("Effect") != "Allow":
            continue
        actions = statement.get("Action", [])
        if isinstance(actions, str):
            actions = [actions]
        if not any(a in ("sts:AssumeRole", "sts:*", "*") for a in actions):
            continue
        principal = statement.get("Principal", {})
        aws_principals = principal.get("AWS", []) if isinstance(principal, dict) else []
        if isinstance(aws_principals, str):
            aws_principals = [aws_principals]
        for candidate in aws_principals:
            if candidate == "*":
                return True
            if candidate == caller_arn:
                return True
            # `arn:aws:iam::<account>:root` trusts the whole account.
            if candidate.endswith(":root") and candidate.split(":")[4] == caller_account:
                return True
            if candidate == caller_account:
                return True
    return False


def _required_external_id(trust_policy: dict[str, Any]) -> str | None:
    statements = trust_policy.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]
    for statement in statements:
        condition = statement.get("Condition", {})
        for operator in ("StringEquals", "StringEqualsIgnoreCase"):
            values = condition.get(operator, {})
            if "sts:ExternalId" in values:
                found = values["sts:ExternalId"]
                return found[0] if isinstance(found, list) else found
    return None


def _assume_role(world: World, form: dict[str, str], caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    role_arn = form.get("RoleArn", "")
    session_name = form.get("RoleSessionName", "session")
    external_id = form.get("ExternalId")
    duration = int(form.get("DurationSeconds", "3600"))

    parts = role_arn.split(":")
    if len(parts) < 6 or parts[2] != "iam":
        return error_xml("ValidationError", f"Invalid RoleArn: {role_arn}", 400)
    account_id = parts[4]
    account = world.account(account_id)
    if account is None:
        return error_xml("AccessDenied", f"Not authorized to perform sts:AssumeRole on {role_arn}", 403)
    role = account.find_role_by_arn(role_arn)
    if role is None:
        return error_xml("AccessDenied", f"Not authorized to perform sts:AssumeRole on {role_arn}", 403)

    if not _principal_allowed(role.trust_policy, caller.arn, caller.account_id):
        return error_xml(
            "AccessDenied",
            f"User: {caller.arn} is not authorized to perform: sts:AssumeRole on resource: {role_arn}",
            403,
        )
    required = _required_external_id(role.trust_policy)
    if required is not None and external_id != required:
        return error_xml(
            "AccessDenied",
            "Not authorized to perform sts:AssumeRole (ExternalId mismatch)",
            403,
        )

    digest = hashlib.sha1(f"{world.seed}:{role_arn}:{session_name}".encode()).hexdigest().upper()
    session = Session(
        access_key_id=f"ASIA{digest[:16]}",
        secret_access_key=digest[16:56],
        session_token=f"tok-{digest}",
        account_id=account_id,
        role_name=role.name,
        expiration=datetime.now(tz=UTC) + timedelta(seconds=duration),
        permissions=_effective_permissions(world, account_id, role),
    )
    world.register_session(session)
    body = (
        f'<AssumeRoleResponse xmlns="{XMLNS_STS}"><AssumeRoleResult>'
        "<Credentials>"
        f"{tag('AccessKeyId', session.access_key_id)}"
        f"{tag('SecretAccessKey', session.secret_access_key)}"
        f"{tag('SessionToken', session.session_token)}"
        f"{tag('Expiration', iso(session.expiration))}"
        "</Credentials>"
        "<AssumedRoleUser>"
        f"{tag('Arn', f'arn:aws:sts::{account_id}:assumed-role/{role.name}/{session_name}')}"
        f"{tag('AssumedRoleId', f'AROA{digest[:12]}:{session_name}')}"
        "</AssumedRoleUser>"
        "</AssumeRoleResult>"
        "<ResponseMetadata><RequestId>mockaws-sts</RequestId></ResponseMetadata>"
        "</AssumeRoleResponse>"
    )
    return xml_response(body)


def _effective_permissions(world: World, account_id: str, role) -> list[dict[str, Any]]:
    account = world.account(account_id)
    statements: list[dict[str, Any]] = []
    if account is None:
        return statements
    for arn in role.attached_policy_arns:
        policy = account.policies.get(arn)
        if policy is None:
            continue
        found = policy.document.get("Statement", [])
        statements.extend(found if isinstance(found, list) else [found])
    for document in role.inline_policies.values():
        found = document.get("Statement", [])
        statements.extend(found if isinstance(found, list) else [found])
    return statements
