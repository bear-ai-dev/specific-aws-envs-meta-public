"""Auto Scaling (query protocol): describe and resize groups."""

from __future__ import annotations

from ..state import Session, World
from ..wire import (
    XMLNS_ASG,
    Request,
    Response,
    error_xml,
    flatten_members,
    query_action,
    tag,
    xml_response,
)


def _envelope(action: str, inner: str) -> Response:
    body = (
        f'<{action}Response xmlns="{XMLNS_ASG}">'
        f"<{action}Result>{inner}</{action}Result>"
        "<ResponseMetadata><RequestId>mockaws-asg</RequestId></ResponseMetadata>"
        f"</{action}Response>"
    )
    return xml_response(body)


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_xml("InvalidClientTokenId", "The security token included in the request is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_xml("AccessDenied", "Unknown account", 403)

    action = query_action(req)
    form = req.form()

    if action == "DescribeAutoScalingGroups":
        wanted = set(flatten_members(form, "AutoScalingGroupNames"))
        matching = [
            asg
            for name, asg in sorted(account.auto_scaling_groups.items())
            if not wanted or name in wanted
        ]
        requested = int(form.get("MaxRecords", "100"))
        page_size = injector.page_size("autoscaling", "DescribeAutoScalingGroups", requested)
        offset = int(form.get("NextToken", "0") or 0)
        page = matching[offset : offset + page_size]

        entries = []
        for asg in page:
            instances = "".join(
                "<member>"
                f"{tag('InstanceId', instance_id)}{tag('LifecycleState', 'InService')}"
                f"{tag('HealthStatus', 'Healthy')}"
                "</member>"
                for instance_id in asg.instance_ids
            )
            zones = "".join(f"<member>{zone}</member>" for zone in asg.availability_zones)
            tags = "".join(
                f"<member>{tag('Key', k)}{tag('Value', v)}{tag('PropagateAtLaunch', 'true')}</member>"
                for k, v in sorted(asg.tags.items())
            )
            entries.append(
                "<member>"
                f"{tag('AutoScalingGroupName', asg.name)}"
                f"{tag('MinSize', asg.min_size)}{tag('MaxSize', asg.max_size)}"
                f"{tag('DesiredCapacity', asg.desired_capacity)}"
                f"<AvailabilityZones>{zones}</AvailabilityZones>"
                f"<Instances>{instances}</Instances>"
                f"<Tags>{tags}</Tags>"
                "</member>"
            )
        next_token = (
            tag("NextToken", str(offset + page_size)) if offset + page_size < len(matching) else ""
        )
        return _envelope(
            "DescribeAutoScalingGroups",
            f"<AutoScalingGroups>{''.join(entries)}</AutoScalingGroups>{next_token}",
        )

    if action in ("UpdateAutoScalingGroup", "SetDesiredCapacity"):
        name = form.get("AutoScalingGroupName", "")
        asg = account.auto_scaling_groups.get(name)
        if asg is None:
            return error_xml("ValidationError", f"AutoScalingGroup name not found: {name}", 400)
        # Validate the whole update before applying any of it, so a rejected
        # call leaves the group exactly as it was.
        min_size = int(form.get("MinSize", asg.min_size))
        max_size = int(form.get("MaxSize", asg.max_size))
        desired = int(form.get("DesiredCapacity", asg.desired_capacity))
        if min_size > max_size:
            return error_xml("ValidationError", "MinSize must not exceed MaxSize", 400)
        if not (min_size <= desired <= max_size):
            return error_xml(
                "ValidationError",
                "New DesiredCapacity must be between MinSize and MaxSize",
                400,
            )
        asg.min_size, asg.max_size, asg.desired_capacity = min_size, max_size, desired
        return _envelope(action, "")

    return error_xml("InvalidAction", f"Unsupported Auto Scaling action: {action}", 400)
