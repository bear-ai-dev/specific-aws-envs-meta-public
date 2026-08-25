"""EC2 (query protocol): instances, reserved instances, instance types."""

from __future__ import annotations

from ..authz import allows
from ..state import Session, World, iso
from ..wire import (
    XMLNS_EC2,
    Request,
    Response,
    error_xml,
    flatten_members,
    flatten_structs,
    query_action,
    tag,
    xml_response,
)

# Only the shapes the tasks need; enough to bin-pack against.
INSTANCE_TYPES: dict[str, dict[str, float]] = {
    "t3.small": {"vcpu": 2, "memory_gib": 2.0, "max_pods": 11},
    "t3.medium": {"vcpu": 2, "memory_gib": 4.0, "max_pods": 17},
    "t3.large": {"vcpu": 2, "memory_gib": 8.0, "max_pods": 35},
    "t3.xlarge": {"vcpu": 4, "memory_gib": 16.0, "max_pods": 58},
    "m5.large": {"vcpu": 2, "memory_gib": 8.0, "max_pods": 29},
    "m5.xlarge": {"vcpu": 4, "memory_gib": 16.0, "max_pods": 58},
    "m5.2xlarge": {"vcpu": 8, "memory_gib": 32.0, "max_pods": 58},
    "m6i.large": {"vcpu": 2, "memory_gib": 8.0, "max_pods": 29},
    "m6i.xlarge": {"vcpu": 4, "memory_gib": 16.0, "max_pods": 58},
    "m6i.2xlarge": {"vcpu": 8, "memory_gib": 32.0, "max_pods": 58},
    "m6i.4xlarge": {"vcpu": 16, "memory_gib": 64.0, "max_pods": 234},
    "c6i.large": {"vcpu": 2, "memory_gib": 4.0, "max_pods": 29},
    "c6i.xlarge": {"vcpu": 4, "memory_gib": 8.0, "max_pods": 58},
    "c6i.2xlarge": {"vcpu": 8, "memory_gib": 16.0, "max_pods": 58},
    "c6i.4xlarge": {"vcpu": 16, "memory_gib": 32.0, "max_pods": 234},
    "r6i.large": {"vcpu": 2, "memory_gib": 16.0, "max_pods": 29},
    "r6i.xlarge": {"vcpu": 4, "memory_gib": 32.0, "max_pods": 58},
    "r6i.2xlarge": {"vcpu": 8, "memory_gib": 64.0, "max_pods": 58},
    "r6i.4xlarge": {"vcpu": 16, "memory_gib": 128.0, "max_pods": 234},
}


def _envelope(action: str, inner: str) -> Response:
    body = (
        f'<{action}Response xmlns="{XMLNS_EC2}">'
        "<requestId>mockaws-ec2</requestId>"
        f"{inner}"
        f"</{action}Response>"
    )
    return xml_response(body)


def _filters(form: dict[str, str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    index = 1
    while True:
        name = form.get(f"Filter.{index}.Name")
        if name is None:
            break
        values = flatten_members(form, f"Filter.{index}.Value")
        out[name] = values
        index += 1
    return out


def _instance_matches(instance, filters: dict[str, list[str]]) -> bool:
    for name, values in filters.items():
        if name == "instance-state-name":
            if instance.state not in values:
                return False
        elif name == "instance-type":
            if instance.instance_type not in values:
                return False
        elif name == "tag-key":
            if not any(key in instance.tags for key in values):
                return False
        elif name.startswith("tag:"):
            key = name[4:]
            if instance.tags.get(key) not in values:
                return False
        elif name == "availability-zone":
            if instance.availability_zone not in values:
                return False
    return True


def _subnet_matches(subnet, filters: dict[str, list[str]]) -> bool:
    for name, values in filters.items():
        if name == "subnet-id":
            if subnet.subnet_id not in values:
                return False
        elif name == "availability-zone":
            if subnet.availability_zone not in values:
                return False
        elif name == "vpc-id":
            if subnet.vpc_id not in values:
                return False
        elif name == "state":
            if subnet.state not in values:
                return False
        elif name.startswith("tag:"):
            key = name[4:]
            if subnet.tags.get(key) not in values:
                return False
    return True


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_xml("AuthFailure", "AWS was not able to validate the provided access credentials", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_xml("AuthFailure", "Unknown account", 403)

    action = query_action(req)
    form = req.form()

    if not allows(caller, f"ec2:{action}"):
        return error_xml(
            "UnauthorizedOperation",
            f"You are not authorized to perform this operation: ec2:{action}",
            403,
        )

    if action == "DescribeInstances":
        filters = _filters(form)
        wanted = set(flatten_members(form, "InstanceId"))
        requested = int(form.get("MaxResults", "1000"))
        page_size = injector.page_size("ec2", "DescribeInstances", requested)
        token = form.get("NextToken", "")

        matching = [
            instance
            for instance in sorted(account.instances.values(), key=lambda i: i.instance_id)
            if (not wanted or instance.instance_id in wanted) and _instance_matches(instance, filters)
        ]
        start = 0
        if token:
            start = next((i for i, inst in enumerate(matching) if inst.instance_id > token), len(matching))
        page = matching[start : start + page_size]
        truncated = start + page_size < len(matching)

        reservations = []
        for instance in page:
            tags = "".join(
                f"<item>{tag('key', k)}{tag('value', v)}</item>" for k, v in sorted(instance.tags.items())
            )
            lifecycle = tag("instanceLifecycle", "spot") if instance.lifecycle == "spot" else ""
            reservations.append(
                "<item>"
                f"{tag('reservationId', 'r-' + instance.instance_id[2:])}"
                f"{tag('ownerId', account.account_id)}"
                "<instancesSet><item>"
                f"{tag('instanceId', instance.instance_id)}"
                f"{tag('instanceType', instance.instance_type)}"
                f"{tag('launchTime', iso(instance.launch_time))}"
                f"<instanceState>{tag('name', instance.state)}</instanceState>"
                f"<placement>{tag('availabilityZone', instance.availability_zone)}</placement>"
                f"{tag('privateIpAddress', instance.private_ip)}"
                f"{tag('privateDnsName', 'ip-' + instance.private_ip.replace('.', '-') + '.ec2.internal')}"
                f"{tag('platformDetails', instance.platform_details)}"
                f"<cpuOptions>{tag('coreCount', int(INSTANCE_TYPES.get(instance.instance_type, {}).get('vcpu', 2)))}"
                f"{tag('threadsPerCore', 2)}</cpuOptions>"
                f"{lifecycle}"
                f"<tagSet>{tags}</tagSet>"
                "</item></instancesSet>"
                "</item>"
            )
        next_token = tag("nextToken", page[-1].instance_id) if truncated and page else ""
        return _envelope("DescribeInstances", f"<reservationSet>{''.join(reservations)}</reservationSet>{next_token}")

    if action == "DescribeSubnets":
        wanted = set(flatten_members(form, "SubnetId"))
        filters = _filters(form)
        requested = int(form.get("MaxResults", "1000"))
        page_size = injector.page_size("ec2", "DescribeSubnets", requested)
        token = form.get("NextToken", "")

        matching = [
            subnet
            for subnet in sorted(account.subnets.values(), key=lambda s: s.subnet_id)
            if (not wanted or subnet.subnet_id in wanted) and _subnet_matches(subnet, filters)
        ]
        start = 0
        if token:
            start = next(
                (i for i, sub in enumerate(matching) if sub.subnet_id > token), len(matching)
            )
        page = matching[start : start + page_size]
        truncated = start + page_size < len(matching)

        entries = []
        for subnet in page:
            tags = "".join(
                f"<item>{tag('key', k)}{tag('value', v)}</item>" for k, v in sorted(subnet.tags.items())
            )
            entries.append(
                "<item>"
                f"{tag('subnetId', subnet.subnet_id)}"
                f"{tag('availabilityZone', subnet.availability_zone)}"
                f"{tag('availabilityZoneId', subnet.availability_zone_id)}"
                f"{tag('vpcId', subnet.vpc_id)}"
                f"{tag('cidrBlock', subnet.cidr_block)}"
                f"{tag('availableIpAddressCount', subnet.available_ip_address_count)}"
                f"{tag('state', subnet.state)}"
                f"{tag('ownerId', account.account_id)}"
                f"<tagSet>{tags}</tagSet>"
                "</item>"
            )
        next_token = tag("nextToken", page[-1].subnet_id) if truncated and page else ""
        return _envelope("DescribeSubnets", f"<subnetSet>{''.join(entries)}</subnetSet>{next_token}")

    if action == "DescribeReservedInstances":
        entries = []
        for ri in account.reserved_instances:
            entries.append(
                "<item>"
                f"{tag('reservedInstancesId', ri.reserved_instances_id)}"
                f"{tag('instanceType', ri.instance_type)}"
                f"{tag('availabilityZone', ri.availability_zone)}"
                f"{tag('instanceCount', ri.instance_count)}"
                f"{tag('start', iso(ri.start))}{tag('end', iso(ri.end))}"
                f"{tag('offeringClass', ri.offering_class)}{tag('scope', ri.scope)}"
                f"{tag('fixedPrice', ri.fixed_price)}{tag('usagePrice', ri.usage_price)}"
                f"{tag('state', 'active')}"
                "</item>"
            )
        return _envelope(
            "DescribeReservedInstances", f"<reservedInstancesSet>{''.join(entries)}</reservedInstancesSet>"
        )

    if action == "DescribeInstanceTypes":
        wanted = set(flatten_members(form, "InstanceType")) or set(INSTANCE_TYPES)
        entries = []
        for name in sorted(wanted):
            spec = INSTANCE_TYPES.get(name)
            if spec is None:
                continue
            entries.append(
                "<item>"
                f"{tag('instanceType', name)}"
                f"<vCpuInfo>{tag('defaultVCpus', int(spec['vcpu']))}</vCpuInfo>"
                f"<memoryInfo>{tag('sizeInMiB', int(spec['memory_gib'] * 1024))}</memoryInfo>"
                "</item>"
            )
        return _envelope("DescribeInstanceTypes", f"<instanceTypeSet>{''.join(entries)}</instanceTypeSet>")

    if action == "CreateTags":
        resources = flatten_members(form, "ResourceId")
        pairs = flatten_structs(form, "Tag")
        for resource_id in resources:
            instance = account.instances.get(resource_id)
            if instance is None:
                continue
            for pair in pairs:
                if "Key" in pair:
                    instance.tags[pair["Key"]] = pair.get("Value", "")
        return _envelope("CreateTags", "<return>true</return>")

    return error_xml("InvalidAction", f"Unsupported EC2 action: {action}", 400)
