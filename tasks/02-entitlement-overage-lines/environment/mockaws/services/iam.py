"""IAM (query protocol): roles, managed policies, inline policies."""

from __future__ import annotations

import json
from urllib.parse import quote

from ..state import OidcProvider, Policy, Role, Session, World, iso
from ..wire import XMLNS_IAM, Request, Response, error_xml, query_action, tag, xml_response


def _envelope(action: str, inner: str) -> Response:
    body = (
        f'<{action}Response xmlns="{XMLNS_IAM}">'
        f"<{action}Result>{inner}</{action}Result>"
        "<ResponseMetadata><RequestId>mockaws-iam</RequestId></ResponseMetadata>"
        f"</{action}Response>"
    )
    return xml_response(body)


def _role_xml(role) -> str:
    return (
        "<Role>"
        f"{tag('Path', role.path)}{tag('RoleName', role.name)}{tag('Arn', role.arn)}"
        f"{tag('RoleId', 'AROA' + role.name.upper()[:16])}"
        f"{tag('CreateDate', iso(role.created))}"
        f"{tag('AssumeRolePolicyDocument', quote(json.dumps(role.trust_policy), safe=''))}"
        "</Role>"
    )


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_xml("AccessDenied", "Unknown account", 403)

    action = query_action(req)
    form = req.form()

    if action == "ListRoles":
        roles = "".join(_role_xml(role) for role in account.roles.values())
        return _envelope("ListRoles", f"<Roles>{roles}</Roles><IsTruncated>false</IsTruncated>")

    if action == "GetRole":
        role = account.roles.get(form.get("RoleName", ""))
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        return _envelope("GetRole", _role_xml(role))

    if action == "CreateRole":
        name = form.get("RoleName", "")
        if not name:
            return error_xml("ValidationError", "RoleName is required", 400)
        if name in account.roles:
            return error_xml("EntityAlreadyExists", f"Role with name {name} already exists.", 409)
        try:
            trust = json.loads(form.get("AssumeRolePolicyDocument", "{}"))
        except json.JSONDecodeError as exc:
            return error_xml("MalformedPolicyDocument", f"Trust policy is not valid JSON: {exc}", 400)
        role = Role(
            name=name,
            account_id=account.account_id,
            trust_policy=trust,
            path=form.get("Path", "/"),
        )
        account.roles[name] = role
        return _envelope("CreateRole", _role_xml(role))

    if action == "DeleteRole":
        name = form.get("RoleName", "")
        role = account.roles.get(name)
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {name}", 404)
        if role.attached_policy_arns or role.inline_policies:
            return error_xml(
                "DeleteConflict",
                "Cannot delete entity, must detach all policies first.",
                409,
            )
        del account.roles[name]
        return _envelope("DeleteRole", "")

    if action == "ListOpenIDConnectProviders":
        entries = "".join(
            f"<member>{tag('Arn', arn)}</member>" for arn in sorted(account.oidc_providers)
        )
        return _envelope(
            "ListOpenIDConnectProviders",
            f"<OpenIDConnectProviderList>{entries}</OpenIDConnectProviderList>",
        )

    if action == "GetOpenIDConnectProvider":
        provider = account.oidc_providers.get(form.get("OpenIDConnectProviderArn", ""))
        if provider is None:
            return error_xml(
                "NoSuchEntity",
                f"OpenIDConnectProvider not found: {form.get('OpenIDConnectProviderArn')}",
                404,
            )
        clients = "".join(tag("member", value) for value in provider.client_ids)
        thumbprints = "".join(tag("member", value) for value in provider.thumbprints)
        # Real IAM reports the issuer without its scheme; Terraform stores it
        # with one. Callers have to normalise before comparing.
        return _envelope(
            "GetOpenIDConnectProvider",
            f"{tag('Url', provider.url.split('://', 1)[-1])}"
            f"<ClientIDList>{clients}</ClientIDList>"
            f"<ThumbprintList>{thumbprints}</ThumbprintList>"
            f"{tag('CreateDate', iso(provider.created))}",
        )

    if action == "CreateOpenIDConnectProvider":
        url = form.get("Url", "")
        host = url.split("://", 1)[-1]
        arn = f"arn:aws:iam::{account.account_id}:oidc-provider/{host}"
        if arn in account.oidc_providers:
            return error_xml("EntityAlreadyExists", f"Provider already exists: {arn}", 409)
        account.oidc_providers[arn] = OidcProvider(arn=arn, url=url)
        return _envelope("CreateOpenIDConnectProvider", tag("OpenIDConnectProviderArn", arn))

    if action == "ListAttachedRolePolicies":
        role = account.roles.get(form.get("RoleName", ""))
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        entries = "".join(
            f"<member>{tag('PolicyName', arn.rsplit('/', 1)[-1])}{tag('PolicyArn', arn)}</member>"
            for arn in role.attached_policy_arns
        )
        return _envelope(
            "ListAttachedRolePolicies",
            f"<AttachedPolicies>{entries}</AttachedPolicies><IsTruncated>false</IsTruncated>",
        )

    if action == "AttachRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        arn = form.get("PolicyArn", "")
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        if arn not in account.policies:
            return error_xml("NoSuchEntity", f"Policy not found: {arn}", 404)
        if arn not in role.attached_policy_arns:
            role.attached_policy_arns.append(arn)
        return _envelope("AttachRolePolicy", "")

    if action == "DetachRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        arn = form.get("PolicyArn", "")
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        if arn not in role.attached_policy_arns:
            return error_xml("NoSuchEntity", f"Policy {arn} is not attached to role", 404)
        role.attached_policy_arns.remove(arn)
        return _envelope("DetachRolePolicy", "")

    if action == "ListRolePolicies":
        role = account.roles.get(form.get("RoleName", ""))
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        names = "".join(f"<member>{name}</member>" for name in role.inline_policies)
        return _envelope("ListRolePolicies", f"<PolicyNames>{names}</PolicyNames><IsTruncated>false</IsTruncated>")

    if action == "PutRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        try:
            document = json.loads(form.get("PolicyDocument", "{}"))
        except json.JSONDecodeError as exc:
            return error_xml("MalformedPolicyDocument", f"Policy document is not valid JSON: {exc}", 400)
        role.inline_policies[form.get("PolicyName", "inline")] = document
        return _envelope("PutRolePolicy", "")

    if action == "GetRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        name = form.get("PolicyName", "")
        if role is None or name not in role.inline_policies:
            return error_xml("NoSuchEntity", f"Inline policy not found: {name}", 404)
        return _envelope(
            "GetRolePolicy",
            f"{tag('RoleName', role.name)}{tag('PolicyName', name)}"
            f"{tag('PolicyDocument', quote(json.dumps(role.inline_policies[name]), safe=''))}",
        )

    if action == "DeleteRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        name = form.get("PolicyName", "")
        if role is None or name not in role.inline_policies:
            return error_xml("NoSuchEntity", f"Inline policy not found: {name}", 404)
        del role.inline_policies[name]
        return _envelope("DeleteRolePolicy", "")

    if action == "UpdateAssumeRolePolicy":
        role = account.roles.get(form.get("RoleName", ""))
        if role is None:
            return error_xml("NoSuchEntity", f"Role not found: {form.get('RoleName')}", 404)
        try:
            role.trust_policy = json.loads(form.get("PolicyDocument", "{}"))
        except json.JSONDecodeError as exc:
            return error_xml("MalformedPolicyDocument", f"Policy document is not valid JSON: {exc}", 400)
        return _envelope("UpdateAssumeRolePolicy", "")

    if action == "CreatePolicy":
        name = form.get("PolicyName", "")
        arn = f"arn:aws:iam::{account.account_id}:policy/{name}"
        try:
            document = json.loads(form.get("PolicyDocument", "{}"))
        except json.JSONDecodeError as exc:
            return error_xml("MalformedPolicyDocument", f"Policy document is not valid JSON: {exc}", 400)
        if arn in account.policies:
            return error_xml("EntityAlreadyExists", f"Policy already exists: {arn}", 409)
        account.policies[arn] = Policy(arn=arn, name=name, document=document)
        return _envelope(
            "CreatePolicy",
            f"<Policy>{tag('PolicyName', name)}{tag('Arn', arn)}{tag('DefaultVersionId', 'v1')}</Policy>",
        )

    if action == "GetPolicy":
        arn = form.get("PolicyArn", "")
        policy = account.policies.get(arn)
        if policy is None:
            return error_xml("NoSuchEntity", f"Policy not found: {arn}", 404)
        return _envelope(
            "GetPolicy",
            f"<Policy>{tag('PolicyName', policy.name)}{tag('Arn', policy.arn)}"
            f"{tag('DefaultVersionId', 'v1')}{tag('AttachmentCount', policy.attachment_count)}</Policy>",
        )

    if action == "GetPolicyVersion":
        arn = form.get("PolicyArn", "")
        policy = account.policies.get(arn)
        if policy is None:
            return error_xml("NoSuchEntity", f"Policy not found: {arn}", 404)
        return _envelope(
            "GetPolicyVersion",
            "<PolicyVersion>"
            f"{tag('Document', quote(json.dumps(policy.document), safe=''))}"
            f"{tag('VersionId', 'v1')}{tag('IsDefaultVersion', 'true')}"
            "</PolicyVersion>",
        )

    if action == "ListPolicies":
        entries = "".join(
            f"<member>{tag('PolicyName', policy.name)}{tag('Arn', policy.arn)}"
            f"{tag('AttachmentCount', policy.attachment_count)}</member>"
            for policy in account.policies.values()
        )
        return _envelope("ListPolicies", f"<Policies>{entries}</Policies><IsTruncated>false</IsTruncated>")

    return error_xml("InvalidAction", f"Unsupported IAM action: {action}", 400)
