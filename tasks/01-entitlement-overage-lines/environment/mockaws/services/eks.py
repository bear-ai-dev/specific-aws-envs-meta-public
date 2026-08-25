"""EKS (rest-json): clusters and managed node groups."""

from __future__ import annotations

from ..state import NodeGroup, Session, World, iso
from ..wire import Request, Response, decode_path, error_json, rest_json_response


def _cluster_payload(world: World, account_id: str, cluster) -> dict:
    return {
        "name": cluster.name,
        "arn": cluster.arn(account_id, world.region),
        "createdAt": iso(cluster.created),
        "version": cluster.version,
        "roleArn": cluster.role_arn,
        "status": cluster.status,
        "tags": cluster.tags,
        "identity": {"oidc": {"issuer": cluster.oidc_issuer}},
        "resourcesVpcConfig": {
            "subnetIds": cluster.subnets,
            "securityGroupIds": cluster.security_group_ids,
            "endpointPublicAccess": cluster.endpoint_public_access,
            "endpointPrivateAccess": not cluster.endpoint_public_access,
        },
    }


def _nodegroup_payload(world: World, account_id: str, ng: NodeGroup) -> dict:
    return {
        "nodegroupName": ng.nodegroup_name,
        "clusterName": ng.cluster_name,
        "nodegroupArn": (
            f"arn:aws:eks:{world.region}:{account_id}:nodegroup/"
            f"{ng.cluster_name}/{ng.nodegroup_name}/{ng.nodegroup_name}"
        ),
        "status": ng.status,
        "capacityType": ng.capacity_type,
        "createdAt": iso(ng.created),
        "scalingConfig": {"minSize": ng.min_size, "maxSize": ng.max_size, "desiredSize": ng.desired_size},
        "instanceTypes": ng.instance_types,
        "subnets": ng.subnets,
        "labels": ng.labels,
        "taints": ng.taints,
        "nodeRole": ng.node_role,
    }


def handle(world: World, req: Request, injector, caller: Session | None) -> Response:
    if caller is None:
        return error_json("UnrecognizedClientException", "The security token is invalid", 403)
    account = world.account(caller.account_id)
    if account is None:
        return error_json("AccessDeniedException", "Unknown account", 403)

    segments = [seg for seg in decode_path(req.path).split("/") if seg]

    if segments == ["clusters"] and req.method == "GET":
        return rest_json_response({"clusters": sorted(account.clusters)})

    if len(segments) == 2 and segments[0] == "clusters" and req.method == "GET":
        cluster = account.clusters.get(segments[1])
        if cluster is None:
            return error_json("ResourceNotFoundException", f"No cluster found for name: {segments[1]}", 404)
        return rest_json_response({"cluster": _cluster_payload(world, account.account_id, cluster)})

    if len(segments) == 3 and segments[0] == "clusters" and segments[2] == "node-groups":
        cluster = account.clusters.get(segments[1])
        if cluster is None:
            return error_json("ResourceNotFoundException", f"No cluster found for name: {segments[1]}", 404)
        if req.method == "GET":
            return rest_json_response({"nodegroups": sorted(cluster.nodegroups)})
        if req.method == "POST":
            payload = req.json()
            name = payload.get("nodegroupName", "")
            if not name:
                return error_json("InvalidParameterException", "nodegroupName is required", 400)
            if name in cluster.nodegroups:
                return error_json("ResourceInUseException", f"NodeGroup already exists: {name}", 409)
            scaling = payload.get("scalingConfig", {})
            node_group = NodeGroup(
                cluster_name=cluster.name,
                nodegroup_name=name,
                instance_types=list(payload.get("instanceTypes", ["t3.large"])),
                min_size=int(scaling.get("minSize", 1)),
                max_size=int(scaling.get("maxSize", 1)),
                desired_size=int(scaling.get("desiredSize", 1)),
                subnets=list(payload.get("subnets", cluster.subnets)),
                labels=dict(payload.get("labels", {})),
                taints=list(payload.get("taints", [])),
                capacity_type=payload.get("capacityType", "ON_DEMAND"),
                node_role=payload.get("nodeRole", ""),
            )
            cluster.nodegroups[name] = node_group
            return rest_json_response({"nodegroup": _nodegroup_payload(world, account.account_id, node_group)})

    if len(segments) == 4 and segments[0] == "clusters" and segments[2] == "node-groups":
        cluster = account.clusters.get(segments[1])
        if cluster is None:
            return error_json("ResourceNotFoundException", f"No cluster found for name: {segments[1]}", 404)
        node_group = cluster.nodegroups.get(segments[3])
        if node_group is None:
            return error_json("ResourceNotFoundException", f"No node group found for name: {segments[3]}", 404)
        if req.method == "GET":
            return rest_json_response({"nodegroup": _nodegroup_payload(world, account.account_id, node_group)})
        if req.method == "DELETE":
            node_group.status = "DELETING"
            payload = _nodegroup_payload(world, account.account_id, node_group)
            del cluster.nodegroups[segments[3]]
            return rest_json_response({"nodegroup": payload})

    if len(segments) == 5 and segments[0] == "clusters" and segments[2] == "node-groups" and segments[4] == "update-config":
        cluster = account.clusters.get(segments[1])
        if cluster is None:
            return error_json("ResourceNotFoundException", f"No cluster found for name: {segments[1]}", 404)
        node_group = cluster.nodegroups.get(segments[3])
        if node_group is None:
            return error_json("ResourceNotFoundException", f"No node group found for name: {segments[3]}", 404)
        payload = req.json()
        scaling = payload.get("scalingConfig", {})
        if "minSize" in scaling:
            node_group.min_size = int(scaling["minSize"])
        if "maxSize" in scaling:
            node_group.max_size = int(scaling["maxSize"])
        if "desiredSize" in scaling:
            node_group.desired_size = int(scaling["desiredSize"])
        if node_group.min_size > node_group.desired_size or node_group.desired_size > node_group.max_size:
            return error_json(
                "InvalidParameterException",
                "Invalid scalingConfig: require minSize <= desiredSize <= maxSize",
                400,
            )
        labels = payload.get("labels", {})
        for key, value in labels.get("addOrUpdateLabels", {}).items():
            node_group.labels[key] = value
        for key in labels.get("removeLabels", []):
            node_group.labels.pop(key, None)
        return rest_json_response(
            {"update": {"id": f"update-{node_group.nodegroup_name}", "status": "Successful", "type": "ConfigUpdate"}}
        )

    return error_json("ResourceNotFoundException", f"Unsupported EKS route: {req.method} {req.path}", 404)
