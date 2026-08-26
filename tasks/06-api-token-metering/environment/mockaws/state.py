"""In-memory world state for the mock AWS control plane.

The whole world is reconstructed from a single JSON scenario document so that a
run is reproducible from `(scenario, seed)` alone. Nothing here talks HTTP; the
wire protocols live in `mockaws.services.*`.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

UTC = timezone.utc


def parse_ts(value: str | int | float | None) -> datetime:
    if value is None:
        return datetime(2026, 1, 1, tzinfo=UTC)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC)
    text = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def rfc1123(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")


# Scenarios routinely declare multi-gibibyte objects to make storage bills
# realistic. Their bytes are never read, so anything above this is synthesized
# lazily and truncated on GET rather than held in memory.
MAX_MATERIALIZED_BODY = 1 << 20


@dataclass
class ObjectVersion:
    version_id: str
    body: bytes
    last_modified: datetime
    storage_class: str = "STANDARD"
    is_delete_marker: bool = False
    metadata: dict[str, str] = field(default_factory=dict)
    tags: dict[str, str] = field(default_factory=dict)
    sse: str | None = None
    # Wall-clock instant at which a LIST call is allowed to observe this
    # version. Drives the injected read-after-write lag.
    visible_at: float = 0.0
    # Set when the scenario declared a size without content; `body` then holds
    # only the prefix a GET would return.
    declared_size: int | None = None
    declared_etag: str | None = None

    @property
    def etag(self) -> str:
        if self.declared_etag is not None:
            return self.declared_etag
        return hashlib.md5(self.body).hexdigest()

    @property
    def size(self) -> int:
        return self.declared_size if self.declared_size is not None else len(self.body)


@dataclass
class TagPredicate:
    key: str
    value: str


@dataclass
class ObjectFilter:
    """The `Filter` element shared by lifecycle and intelligent-tiering rules."""

    prefix: str = ""
    tags: list[TagPredicate] = field(default_factory=list)

    @classmethod
    def from_raw(cls, raw: dict[str, Any] | None) -> "ObjectFilter":
        raw = raw or {}
        return cls(
            prefix=raw.get("prefix", ""),
            tags=[TagPredicate(key=t["key"], value=t["value"]) for t in raw.get("tags", [])],
        )


@dataclass
class LifecycleTransition:
    days: int
    storage_class: str


@dataclass
class LifecycleRule:
    rule_id: str
    status: str = "Enabled"
    filter: ObjectFilter = field(default_factory=ObjectFilter)
    transitions: list[LifecycleTransition] = field(default_factory=list)


@dataclass
class Tiering:
    days: int
    access_tier: str


@dataclass
class IntelligentTieringConfiguration:
    config_id: str
    status: str = "Enabled"
    filter: ObjectFilter = field(default_factory=ObjectFilter)
    tierings: list[Tiering] = field(default_factory=list)


@dataclass
class MultipartPart:
    part_number: int
    size: int
    last_modified: datetime
    etag: str = ""


@dataclass
class MultipartUpload:
    key: str
    upload_id: str
    initiated: datetime
    storage_class: str = "STANDARD"
    parts: list[MultipartPart] = field(default_factory=list)


@dataclass
class ReplicationRule:
    """One rule of a bucket's replication configuration (V2 shape)."""

    rule_id: str
    status: str = "Enabled"
    priority: int = 0
    filter: ObjectFilter = field(default_factory=ObjectFilter)
    destination_bucket: str = ""
    destination_storage_class: str | None = None

    @property
    def destination_arn(self) -> str:
        return f"arn:aws:s3:::{self.destination_bucket}"


@dataclass
class Bucket:
    name: str
    region: str = "us-east-1"
    versioning: str = "Disabled"
    encryption: str | None = None
    created: datetime = field(default_factory=lambda: datetime(2025, 6, 1, tzinfo=UTC))
    objects: dict[str, list[ObjectVersion]] = field(default_factory=dict)
    lifecycle_rules: list[LifecycleRule] = field(default_factory=list)
    intelligent_tiering: list[IntelligentTieringConfiguration] = field(default_factory=list)
    multipart_uploads: list[MultipartUpload] = field(default_factory=list)
    replication_role: str = ""
    replication_rules: list[ReplicationRule] = field(default_factory=list)
    request_payer: str = "BucketOwner"

    @property
    def versioning_enabled(self) -> bool:
        return self.versioning == "Enabled"

    def live_version(self, key: str) -> ObjectVersion | None:
        versions = self.objects.get(key)
        if not versions:
            return None
        newest = versions[-1]
        return None if newest.is_delete_marker else newest

    def put(self, key: str, version: ObjectVersion) -> None:
        chain = self.objects.setdefault(key, [])
        if self.versioning_enabled:
            chain.append(version)
        else:
            version.version_id = "null"
            chain.clear()
            chain.append(version)


@dataclass
class Role:
    name: str
    account_id: str
    trust_policy: dict[str, Any]
    attached_policy_arns: list[str] = field(default_factory=list)
    inline_policies: dict[str, dict[str, Any]] = field(default_factory=dict)
    external_id: str | None = None
    path: str = "/"
    created: datetime = field(default_factory=lambda: datetime(2025, 1, 1, tzinfo=UTC))

    @property
    def arn(self) -> str:
        return f"arn:aws:iam::{self.account_id}:role{self.path}{self.name}"


@dataclass
class Policy:
    arn: str
    name: str
    document: dict[str, Any]
    attachment_count: int = 0


@dataclass
class OidcProvider:
    """An IAM OpenID Connect provider, as EKS clusters register for IRSA."""

    arn: str
    url: str
    client_ids: list[str] = field(default_factory=lambda: ["sts.amazonaws.com"])
    thumbprints: list[str] = field(default_factory=list)
    created: datetime = field(default_factory=lambda: datetime(2025, 9, 1, tzinfo=UTC))


@dataclass
class Instance:
    instance_id: str
    instance_type: str
    availability_zone: str
    state: str = "running"
    lifecycle: str = "on-demand"
    launch_time: datetime = field(default_factory=lambda: datetime(2026, 1, 1, tzinfo=UTC))
    tags: dict[str, str] = field(default_factory=dict)
    private_ip: str = "10.0.0.10"
    platform_details: str = "Linux/UNIX"


@dataclass
class Subnet:
    """A VPC subnet. Nodegroups reference these by id, and the subnet's zone is
    the only way to tell which availability zone a nodegroup can place nodes in."""

    subnet_id: str
    availability_zone: str
    vpc_id: str = "vpc-mockaws"
    cidr_block: str = "10.0.0.0/24"
    available_ip_address_count: int = 250
    state: str = "available"
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def availability_zone_id(self) -> str:
        return self.availability_zone


@dataclass
class ReservedInstance:
    reserved_instances_id: str
    instance_type: str
    availability_zone: str
    instance_count: int
    start: datetime
    end: datetime
    offering_class: str = "standard"
    scope: str = "Availability Zone"
    fixed_price: float = 0.0
    usage_price: float = 0.0


@dataclass
class NodeGroup:
    cluster_name: str
    nodegroup_name: str
    instance_types: list[str]
    min_size: int
    max_size: int
    desired_size: int
    subnets: list[str] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)
    taints: list[dict[str, str]] = field(default_factory=list)
    capacity_type: str = "ON_DEMAND"
    status: str = "ACTIVE"
    node_role: str = ""
    created: datetime = field(default_factory=lambda: datetime(2025, 9, 1, tzinfo=UTC))


@dataclass
class Cluster:
    name: str
    version: str
    role_arn: str
    status: str = "ACTIVE"
    subnets: list[str] = field(default_factory=list)
    security_group_ids: list[str] = field(default_factory=list)
    endpoint_public_access: bool = True
    tags: dict[str, str] = field(default_factory=dict)
    created: datetime = field(default_factory=lambda: datetime(2025, 9, 1, tzinfo=UTC))
    nodegroups: dict[str, NodeGroup] = field(default_factory=dict)
    # `identity.oidc.issuer` on DescribeCluster; the IRSA trust anchor.
    oidc_issuer: str = ""

    def arn(self, account_id: str, region: str) -> str:
        return f"arn:aws:eks:{region}:{account_id}:cluster/{self.name}"


@dataclass
class AutoScalingGroup:
    name: str
    min_size: int
    max_size: int
    desired_capacity: int
    availability_zones: list[str] = field(default_factory=list)
    instance_ids: list[str] = field(default_factory=list)
    tags: dict[str, str] = field(default_factory=dict)


@dataclass
class MetricSeries:
    namespace: str
    metric_name: str
    dimensions: dict[str, str]
    # (timestamp, value) sorted ascending.
    points: list[tuple[datetime, float]] = field(default_factory=list)

    def matches(self, namespace: str, metric_name: str, dimensions: dict[str, str]) -> bool:
        if namespace != self.namespace or metric_name != self.metric_name:
            return False
        return all(self.dimensions.get(k) == v for k, v in dimensions.items())


@dataclass
class CostRecord:
    """One row of the Cost Explorer fact table."""

    start: datetime
    end: datetime
    keys: dict[str, str]
    amortized_cost: float
    unblended_cost: float
    usage_quantity: float = 0.0


@dataclass
class PriceItem:
    sku: str
    service_code: str
    attributes: dict[str, str]
    terms: dict[str, Any]


@dataclass
class TrailEvent:
    event_id: str
    event_time: datetime
    event_name: str
    event_source: str
    username: str
    resources: list[dict[str, str]] = field(default_factory=list)
    request_parameters: dict[str, Any] = field(default_factory=dict)
    response_elements: dict[str, Any] | None = None
    error_code: str | None = None


@dataclass
class Account:
    account_id: str
    alias: str = ""
    roles: dict[str, Role] = field(default_factory=dict)
    policies: dict[str, Policy] = field(default_factory=dict)
    oidc_providers: dict[str, OidcProvider] = field(default_factory=dict)
    buckets: dict[str, Bucket] = field(default_factory=dict)
    clusters: dict[str, Cluster] = field(default_factory=dict)
    instances: dict[str, Instance] = field(default_factory=dict)
    subnets: dict[str, Subnet] = field(default_factory=dict)
    reserved_instances: list[ReservedInstance] = field(default_factory=list)
    auto_scaling_groups: dict[str, AutoScalingGroup] = field(default_factory=dict)
    metrics: list[MetricSeries] = field(default_factory=list)
    costs: list[CostRecord] = field(default_factory=list)
    trail: list[TrailEvent] = field(default_factory=list)

    def find_role_by_arn(self, arn: str) -> Role | None:
        for role in self.roles.values():
            if role.arn == arn:
                return role
        return None


@dataclass
class Session:
    """A credential set handed out by STS (or the static bootstrap identity)."""

    access_key_id: str
    secret_access_key: str
    session_token: str
    account_id: str
    role_name: str | None
    expiration: datetime
    permissions: list[dict[str, Any]] = field(default_factory=list)

    @property
    def arn(self) -> str:
        if self.role_name is None:
            return f"arn:aws:iam::{self.account_id}:user/bootstrap"
        return f"arn:aws:sts::{self.account_id}:assumed-role/{self.role_name}/session"


class World:
    """Mutable world state, guarded by a single lock.

    The server is deliberately single-threaded-ish: every request takes the
    lock. Determinism matters far more than throughput here.
    """

    def __init__(self, scenario: dict[str, Any], seed: int = 0) -> None:
        self.lock = threading.RLock()
        self.seed = seed
        self.scenario = scenario
        self.region: str = scenario.get("region", "us-east-1")
        self.pricing: list[PriceItem] = []
        self.accounts: dict[str, Account] = {}
        self.sessions: dict[str, Session] = {}
        self.request_log: list[dict[str, Any]] = []
        self.clock_offset = timedelta(0)
        # The billing platform stores its configuration documents in an
        # append-only time-series bucket rather than in AWS, so the emulated
        # world carries that ledger alongside the AWS accounts. Imported here
        # rather than at module scope because every other service module
        # imports this one.
        from .services.influx import Ledger

        self.influx = Ledger.from_scenario(scenario.get("influx"))
        self._load(scenario)

    # ---- construction -------------------------------------------------

    def _load(self, scenario: dict[str, Any]) -> None:
        for raw in scenario.get("accounts", []):
            account = Account(account_id=str(raw["account_id"]), alias=raw.get("alias", ""))
            for role_raw in raw.get("roles", []):
                role = Role(
                    name=role_raw["name"],
                    account_id=account.account_id,
                    trust_policy=role_raw.get("trust_policy", {}),
                    attached_policy_arns=list(role_raw.get("attached_policy_arns", [])),
                    inline_policies=dict(role_raw.get("inline_policies", {})),
                    external_id=role_raw.get("external_id"),
                    path=role_raw.get("path", "/"),
                )
                account.roles[role.name] = role
            for pol_raw in raw.get("policies", []):
                policy = Policy(
                    arn=pol_raw["arn"],
                    name=pol_raw.get("name", pol_raw["arn"].rsplit("/", 1)[-1]),
                    document=pol_raw.get("document", {}),
                    attachment_count=pol_raw.get("attachment_count", 0),
                )
                account.policies[policy.arn] = policy
            for oidc_raw in raw.get("oidc_providers", []):
                url = oidc_raw["url"]
                host = url.split("://", 1)[-1]
                provider = OidcProvider(
                    arn=oidc_raw.get("arn", f"arn:aws:iam::{account.account_id}:oidc-provider/{host}"),
                    url=url,
                    client_ids=list(oidc_raw.get("client_ids", ["sts.amazonaws.com"])),
                    thumbprints=list(oidc_raw.get("thumbprints", ["9e99a48a9960b14926bb7f3b02e22da2b0ab7280"])),
                )
                account.oidc_providers[provider.arn] = provider
            for bucket_raw in raw.get("buckets", []):
                bucket = Bucket(
                    name=bucket_raw["name"],
                    region=bucket_raw.get("region", self.region),
                    versioning=bucket_raw.get("versioning", "Disabled"),
                    encryption=bucket_raw.get("encryption"),
                    request_payer=bucket_raw.get("request_payer", "BucketOwner"),
                )
                for obj_raw in bucket_raw.get("objects", []):
                    body, declared_size, declared_etag = self._materialize_body(obj_raw)
                    version = ObjectVersion(
                        version_id=obj_raw.get("version_id")
                        or self._version_id(
                            bucket.name, obj_raw["key"], len(bucket.objects.get(obj_raw["key"], []))
                        ),
                        body=body,
                        last_modified=parse_ts(obj_raw.get("last_modified")),
                        storage_class=obj_raw.get("storage_class", "STANDARD"),
                        is_delete_marker=bool(obj_raw.get("delete_marker", False)),
                        metadata=dict(obj_raw.get("metadata", {})),
                        tags=dict(obj_raw.get("tags", {})),
                        sse=obj_raw.get("sse"),
                        declared_size=declared_size,
                        declared_etag=declared_etag,
                    )
                    bucket.objects.setdefault(obj_raw["key"], []).append(version)
                self._load_bucket_policies(bucket, bucket_raw)
                account.buckets[bucket.name] = bucket
            for cluster_raw in raw.get("clusters", []):
                cluster = Cluster(
                    name=cluster_raw["name"],
                    version=cluster_raw.get("version", "1.29"),
                    role_arn=cluster_raw.get("role_arn", ""),
                    subnets=list(cluster_raw.get("subnets", [])),
                    security_group_ids=list(cluster_raw.get("security_group_ids", [])),
                    tags=dict(cluster_raw.get("tags", {})),
                    oidc_issuer=cluster_raw.get("oidc_issuer", ""),
                )
                for ng_raw in cluster_raw.get("nodegroups", []):
                    node_group = NodeGroup(
                        cluster_name=cluster.name,
                        nodegroup_name=ng_raw["name"],
                        instance_types=list(ng_raw.get("instance_types", ["t3.large"])),
                        min_size=int(ng_raw.get("min_size", 1)),
                        max_size=int(ng_raw.get("max_size", 5)),
                        desired_size=int(ng_raw.get("desired_size", 1)),
                        subnets=list(ng_raw.get("subnets", cluster.subnets)),
                        labels=dict(ng_raw.get("labels", {})),
                        taints=list(ng_raw.get("taints", [])),
                        capacity_type=ng_raw.get("capacity_type", "ON_DEMAND"),
                        node_role=ng_raw.get("node_role", ""),
                    )
                    cluster.nodegroups[node_group.nodegroup_name] = node_group
                account.clusters[cluster.name] = cluster
            for inst_raw in raw.get("instances", []):
                instance = Instance(
                    instance_id=inst_raw["instance_id"],
                    instance_type=inst_raw["instance_type"],
                    availability_zone=inst_raw.get("availability_zone", f"{self.region}a"),
                    state=inst_raw.get("state", "running"),
                    lifecycle=inst_raw.get("lifecycle", "on-demand"),
                    launch_time=parse_ts(inst_raw.get("launch_time")),
                    tags=dict(inst_raw.get("tags", {})),
                    private_ip=inst_raw.get("private_ip", "10.0.0.10"),
                    platform_details=inst_raw.get("platform_details", "Linux/UNIX"),
                )
                account.instances[instance.instance_id] = instance
            for subnet_raw in raw.get("subnets", []):
                subnet = Subnet(
                    subnet_id=subnet_raw["subnet_id"],
                    availability_zone=subnet_raw.get("availability_zone", f"{self.region}a"),
                    vpc_id=subnet_raw.get("vpc_id", "vpc-mockaws"),
                    cidr_block=subnet_raw.get("cidr_block", "10.0.0.0/24"),
                    available_ip_address_count=int(
                        subnet_raw.get("available_ip_address_count", 250)
                    ),
                    state=subnet_raw.get("state", "available"),
                    tags=dict(subnet_raw.get("tags", {})),
                )
                account.subnets[subnet.subnet_id] = subnet
            for ri_raw in raw.get("reserved_instances", []):
                account.reserved_instances.append(
                    ReservedInstance(
                        reserved_instances_id=ri_raw["id"],
                        instance_type=ri_raw["instance_type"],
                        availability_zone=ri_raw.get("availability_zone", f"{self.region}a"),
                        instance_count=int(ri_raw.get("instance_count", 1)),
                        start=parse_ts(ri_raw.get("start")),
                        end=parse_ts(ri_raw.get("end")),
                        offering_class=ri_raw.get("offering_class", "standard"),
                        scope=ri_raw.get("scope", "Availability Zone"),
                        fixed_price=float(ri_raw.get("fixed_price", 0.0)),
                        usage_price=float(ri_raw.get("usage_price", 0.0)),
                    )
                )
            for asg_raw in raw.get("auto_scaling_groups", []):
                asg = AutoScalingGroup(
                    name=asg_raw["name"],
                    min_size=int(asg_raw.get("min_size", 0)),
                    max_size=int(asg_raw.get("max_size", 10)),
                    desired_capacity=int(asg_raw.get("desired_capacity", 1)),
                    availability_zones=list(asg_raw.get("availability_zones", [])),
                    instance_ids=list(asg_raw.get("instance_ids", [])),
                    tags=dict(asg_raw.get("tags", {})),
                )
                account.auto_scaling_groups[asg.name] = asg
            for metric_raw in raw.get("metrics", []):
                series = MetricSeries(
                    namespace=metric_raw["namespace"],
                    metric_name=metric_raw["metric_name"],
                    dimensions=dict(metric_raw.get("dimensions", {})),
                    points=[(parse_ts(p[0]), float(p[1])) for p in metric_raw.get("points", [])],
                )
                series.points.sort(key=lambda item: item[0])
                account.metrics.append(series)
            for cost_raw in raw.get("costs", []):
                account.costs.append(
                    CostRecord(
                        start=parse_ts(cost_raw["start"]),
                        end=parse_ts(cost_raw["end"]),
                        keys=dict(cost_raw.get("keys", {})),
                        amortized_cost=float(cost_raw.get("amortized_cost", 0.0)),
                        unblended_cost=float(cost_raw.get("unblended_cost", cost_raw.get("amortized_cost", 0.0))),
                        usage_quantity=float(cost_raw.get("usage_quantity", 0.0)),
                    )
                )
            for event_raw in raw.get("trail", []):
                account.trail.append(
                    TrailEvent(
                        event_id=event_raw["event_id"],
                        event_time=parse_ts(event_raw["event_time"]),
                        event_name=event_raw["event_name"],
                        event_source=event_raw["event_source"],
                        username=event_raw.get("username", "unknown"),
                        resources=list(event_raw.get("resources", [])),
                        request_parameters=dict(event_raw.get("request_parameters", {})),
                        response_elements=event_raw.get("response_elements"),
                        error_code=event_raw.get("error_code"),
                    )
                )
            account.trail.sort(key=lambda e: e.event_time)
            self.accounts[account.account_id] = account

        for price_raw in scenario.get("pricing", []):
            self.pricing.append(
                PriceItem(
                    sku=price_raw["sku"],
                    service_code=price_raw.get("service_code", "AmazonEC2"),
                    attributes=dict(price_raw.get("attributes", {})),
                    terms=dict(price_raw.get("terms", {})),
                )
            )

        bootstrap = scenario.get("bootstrap_identity", {})
        account_id = str(bootstrap.get("account_id", next(iter(self.accounts), "000000000000")))
        session = Session(
            access_key_id=bootstrap.get("access_key_id", "LOCALMETERINGKEY00"),
            secret_access_key=bootstrap.get("secret_access_key", "bootstrap-secret"),
            session_token="",
            account_id=account_id,
            role_name=None,
            expiration=datetime(2030, 1, 1, tzinfo=UTC),
            permissions=[{"Effect": "Allow", "Action": ["*"], "Resource": ["*"]}],
        )
        self.sessions[session.access_key_id] = session
        self.bootstrap_access_key = session.access_key_id

    def _load_bucket_policies(self, bucket: Bucket, bucket_raw: dict[str, Any]) -> None:
        """Lifecycle, intelligent-tiering, replication and in-flight uploads.

        All of them are optional; a scenario that omits one yields a bucket
        whose corresponding S3 API reports "not configured", exactly as a fresh
        bucket would.
        """
        bucket.replication_role = bucket_raw.get(
            "replication_role", f"arn:aws:iam::{bucket_raw.get('owner', '334455667788')}:role/s3-replication"
        )
        for repl_raw in bucket_raw.get("replication", []):
            bucket.replication_rules.append(
                ReplicationRule(
                    rule_id=repl_raw["id"],
                    status=repl_raw.get("status", "Enabled"),
                    priority=int(repl_raw.get("priority", 0)),
                    filter=ObjectFilter.from_raw(repl_raw.get("filter")),
                    destination_bucket=repl_raw.get("destination_bucket", ""),
                    destination_storage_class=repl_raw.get("destination_storage_class"),
                )
            )
        for rule_raw in bucket_raw.get("lifecycle_rules", []):
            bucket.lifecycle_rules.append(
                LifecycleRule(
                    rule_id=rule_raw["id"],
                    status=rule_raw.get("status", "Enabled"),
                    filter=ObjectFilter.from_raw(rule_raw.get("filter")),
                    transitions=[
                        LifecycleTransition(days=int(t["days"]), storage_class=t["storage_class"])
                        for t in rule_raw.get("transitions", [])
                    ],
                )
            )
        for config_raw in bucket_raw.get("intelligent_tiering", []):
            bucket.intelligent_tiering.append(
                IntelligentTieringConfiguration(
                    config_id=config_raw["id"],
                    status=config_raw.get("status", "Enabled"),
                    filter=ObjectFilter.from_raw(config_raw.get("filter")),
                    tierings=[
                        Tiering(days=int(t["days"]), access_tier=t["access_tier"])
                        for t in config_raw.get("tierings", [])
                    ],
                )
            )
        for upload_raw in bucket_raw.get("multipart_uploads", []):
            parts = [
                MultipartPart(
                    part_number=int(part["part_number"]),
                    size=int(part["size"]),
                    last_modified=parse_ts(part.get("last_modified")),
                    etag=part.get(
                        "etag",
                        hashlib.md5(
                            f"{upload_raw['upload_id']}:{part['part_number']}".encode()
                        ).hexdigest(),
                    ),
                )
                for part in upload_raw.get("parts", [])
            ]
            parts.sort(key=lambda item: item.part_number)
            bucket.multipart_uploads.append(
                MultipartUpload(
                    key=upload_raw["key"],
                    upload_id=upload_raw["upload_id"],
                    initiated=parse_ts(upload_raw.get("initiated")),
                    storage_class=upload_raw.get("storage_class", "STANDARD"),
                    parts=parts,
                )
            )
        bucket.multipart_uploads.sort(key=lambda item: (item.key, item.upload_id))

    def _materialize_body(self, obj_raw: dict[str, Any]) -> tuple[bytes, int | None, str | None]:
        """Return `(body, declared_size, declared_etag)`.

        `declared_size` is set only for size-only objects too large to hold in
        memory; callers must then read `ObjectVersion.size` rather than
        `len(body)`.
        """
        if "body_b64" in obj_raw:
            import base64

            return base64.b64decode(obj_raw["body_b64"]), None, None
        if "body_json" in obj_raw:
            return json.dumps(obj_raw["body_json"], separators=(",", ":")).encode(), None, None
        if "body_ndjson" in obj_raw:
            lines = [json.dumps(row, separators=(",", ":")) for row in obj_raw["body_ndjson"]]
            payload = ("\n".join(lines) + "\n").encode()
            if obj_raw.get("gzip"):
                import gzip

                payload = gzip.compress(payload, mtime=0)
            return payload, None, None
        if "body_size" in obj_raw:
            # Deterministic filler; content is irrelevant, size is not.
            size = int(obj_raw["body_size"])
            digest = hashlib.sha256(obj_raw["key"].encode()).digest()
            materialized = min(size, MAX_MATERIALIZED_BODY)
            body = (digest * (materialized // len(digest) + 1))[:materialized]
            if size <= MAX_MATERIALIZED_BODY:
                return body, None, None
            etag = hashlib.md5(f"{obj_raw['key']}:{size}".encode()).hexdigest()
            return body, size, etag
        return obj_raw.get("body", "").encode(), None, None

    def _version_id(self, bucket: str, key: str, index: int) -> str:
        raw = f"{self.seed}:{bucket}:{key}:{index}".encode()
        return hashlib.sha1(raw).hexdigest()[:32]

    # ---- accessors ----------------------------------------------------

    def account(self, account_id: str) -> Account | None:
        return self.accounts.get(str(account_id))

    def session_for_key(self, access_key_id: str) -> Session | None:
        return self.sessions.get(access_key_id)

    def register_session(self, session: Session) -> None:
        self.sessions[session.access_key_id] = session

    def find_bucket(self, name: str) -> tuple[Account, Bucket] | None:
        for account in self.accounts.values():
            bucket = account.buckets.get(name)
            if bucket is not None:
                return account, bucket
        return None

    def snapshot(self) -> dict[str, Any]:
        """A JSON-serializable projection used by verifiers to read final state."""
        out: dict[str, Any] = {"accounts": {}}
        for account_id, account in self.accounts.items():
            buckets = {}
            for name, bucket in account.buckets.items():
                keys = {}
                for key, versions in bucket.objects.items():
                    keys[key] = [
                        {
                            "version_id": v.version_id,
                            "size": v.size,
                            "etag": v.etag,
                            "storage_class": v.storage_class,
                            "delete_marker": v.is_delete_marker,
                            "last_modified": iso(v.last_modified),
                            "sse": v.sse,
                            "metadata": v.metadata,
                        }
                        for v in versions
                    ]
                buckets[name] = {"versioning": bucket.versioning, "encryption": bucket.encryption, "objects": keys}
            out["accounts"][account_id] = {
                "buckets": buckets,
                "clusters": {
                    name: {
                        "version": cluster.version,
                        "nodegroups": {
                            ng_name: {
                                "min_size": ng.min_size,
                                "max_size": ng.max_size,
                                "desired_size": ng.desired_size,
                                "instance_types": ng.instance_types,
                                "capacity_type": ng.capacity_type,
                                "labels": ng.labels,
                                "taints": ng.taints,
                                "status": ng.status,
                            }
                            for ng_name, ng in cluster.nodegroups.items()
                        },
                    }
                    for name, cluster in account.clusters.items()
                },
                "roles": {
                    name: {
                        "attached_policy_arns": role.attached_policy_arns,
                        "inline_policies": role.inline_policies,
                        "trust_policy": role.trust_policy,
                    }
                    for name, role in account.roles.items()
                },
                "policies": {arn: policy.document for arn, policy in account.policies.items()},
                "oidc_providers": {
                    arn: {"url": provider.url, "client_ids": provider.client_ids}
                    for arn, provider in account.oidc_providers.items()
                },
                "auto_scaling_groups": {
                    name: {
                        "min_size": asg.min_size,
                        "max_size": asg.max_size,
                        "desired_capacity": asg.desired_capacity,
                        "tags": asg.tags,
                    }
                    for name, asg in account.auto_scaling_groups.items()
                },
            }
        out["influx"] = self.influx.snapshot()
        return out
