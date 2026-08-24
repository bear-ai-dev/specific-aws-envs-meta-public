"""End-to-end smoke test: drive the mock control plane with real boto3 clients."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from mockaws.server import MockAws, _make_handler  # noqa: E402

HERE = Path(__file__).parent
ENDPOINT = "http://127.0.0.1:{port}"
FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        FAILURES.append(f"{label}: {detail}")
        print(f"  FAIL {label} {detail}")


def client(service: str, port: int, creds: dict[str, str] | None = None):
    creds = creds or {
        "aws_access_key_id": "LOCALMETERINGKEY00",
        "aws_secret_access_key": "bootstrap-secret",
    }
    return boto3.client(
        service,
        region_name="us-east-1",
        endpoint_url=ENDPOINT.format(port=port),
        config=Config(
            s3={"addressing_style": "path"},
            retries={"max_attempts": 6, "mode": "standard"},
        ),
        **creds,
    )


def main() -> int:
    os.environ["MOCKAWS_ADMIN_TOKEN"] = "smoke-token"
    scenario = json.loads((HERE / "smoke_scenario.json").read_text())
    engine = MockAws(scenario, seed=7)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(engine))
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.2)
    print(f"mockaws on port {port}")

    print("\nSTS")
    sts = client("sts", port)
    identity = sts.get_caller_identity()
    check("GetCallerIdentity account", identity["Account"] == "111111111111", identity)

    assumed = sts.assume_role(
        RoleArn="arn:aws:iam::111111111111:role/MeteringCoControlPlane",
        RoleSessionName="smoke",
    )
    creds = assumed["Credentials"]
    check("AssumeRole returns creds", creds["AccessKeyId"].startswith("ASIA"), creds["AccessKeyId"])

    try:
        sts.assume_role(RoleArn="arn:aws:iam::999999999999:role/Nope", RoleSessionName="smoke")
        check("AssumeRole denies unknown account", False, "no error raised")
    except ClientError as exc:
        check(
            "AssumeRole denies unknown account",
            exc.response["Error"]["Code"] == "AccessDenied",
            exc.response["Error"]["Code"],
        )

    print("\nS3")
    s3 = client("s3", port)
    buckets = s3.list_buckets()
    check("ListBuckets", [b["Name"] for b in buckets["Buckets"]] == ["meteringco-metering"], buckets)

    paginator = s3.get_paginator("list_objects_v2")
    keys = [obj["Key"] for page in paginator.paginate(Bucket="meteringco-metering") for obj in page.get("Contents", [])]
    # part-0 on 2026-01-04 is a delete marker, so 4 live keys remain, and the
    # injected page cap of 3 forces the paginator to make two calls.
    check("ListObjectsV2 paginates past the 3-key cap", len(keys) == 4, keys)

    versions = s3.list_object_versions(Bucket="meteringco-metering", Prefix="usage/2026-01-02/")
    check("ListObjectVersions returns both versions", len(versions.get("Versions", [])) == 2, versions.get("Versions"))

    body = s3.get_object(Bucket="meteringco-metering", Key="usage/2026-01-01/part-0.json")["Body"].read()
    check("GetObject body", json.loads(body) == {"records": 3}, body)

    s3.put_object(Bucket="meteringco-metering", Key="reports/out.json", Body=b'{"ok":true}', ServerSideEncryption="AES256")
    head = s3.head_object(Bucket="meteringco-metering", Key="reports/out.json")
    check("PutObject then HeadObject", head["ContentLength"] == 11, head["ContentLength"])
    check("SSE echoed back", head.get("ServerSideEncryption") == "AES256", head.get("ServerSideEncryption"))

    print("\nEKS")
    eks = client("eks", port)
    check("ListClusters", eks.list_clusters()["clusters"] == ["meteringco-prod"], eks.list_clusters())
    node_group = eks.describe_nodegroup(clusterName="meteringco-prod", nodegroupName="general")["nodegroup"]
    check("DescribeNodegroup desiredSize", node_group["scalingConfig"]["desiredSize"] == 3, node_group["scalingConfig"])
    eks.update_nodegroup_config(
        clusterName="meteringco-prod", nodegroupName="general", scalingConfig={"minSize": 2, "maxSize": 8, "desiredSize": 5}
    )
    node_group = eks.describe_nodegroup(clusterName="meteringco-prod", nodegroupName="general")["nodegroup"]
    check("UpdateNodegroupConfig applied", node_group["scalingConfig"]["desiredSize"] == 5, node_group["scalingConfig"])
    try:
        eks.update_nodegroup_config(
            clusterName="meteringco-prod", nodegroupName="general", scalingConfig={"minSize": 9, "desiredSize": 5}
        )
        check("UpdateNodegroupConfig rejects min>desired", False, "no error raised")
    except ClientError as exc:
        check(
            "UpdateNodegroupConfig rejects min>desired",
            exc.response["Error"]["Code"] == "InvalidParameterException",
            exc.response["Error"]["Code"],
        )

    print("\nEC2")
    ec2 = client("ec2", port)
    reservations = ec2.describe_instances(Filters=[{"Name": "instance-state-name", "Values": ["running"]}])
    instances = [i for r in reservations["Reservations"] for i in r["Instances"]]
    check("DescribeInstances", len(instances) == 1 and instances[0]["InstanceType"] == "m6i.xlarge", instances)
    check(
        "Instance tags decoded",
        instances[0]["Tags"] and any(t["Key"] == "eks:cluster-name" for t in instances[0]["Tags"]),
        instances[0].get("Tags"),
    )
    ris = ec2.describe_reserved_instances()["ReservedInstances"]
    check("DescribeReservedInstances", len(ris) == 1 and ris[0]["InstanceCount"] == 2, ris)

    print("\nCloudWatch")
    cw = client("cloudwatch", port)
    data = cw.get_metric_data(
        MetricDataQueries=[
            {
                "Id": "egress",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/EC2",
                        "MetricName": "NetworkOut",
                        "Dimensions": [{"Name": "InstanceId", "Value": "i-0aa11bb22cc33dd44"}],
                    },
                    "Period": 3600,
                    "Stat": "Sum",
                },
            }
        ],
        StartTime="2026-01-01T00:00:00Z",
        EndTime="2026-01-02T00:00:00Z",
    )
    values = data["MetricDataResults"][0]["Values"]
    check("GetMetricData returns 3 buckets", len(values) == 3, values)
    check("GetMetricData sums correctly", abs(sum(values) - 3670016.0) < 1e-6, sum(values))

    print("\nCost Explorer (throttled + paginated)")
    ce = client("ce", port)
    total = 0.0
    token = None
    pages = 0
    while True:
        kwargs = {
            "TimePeriod": {"Start": "2026-01-01", "End": "2026-03-01"},
            "Granularity": "MONTHLY",
            "Metrics": ["AmortizedCost"],
        }
        if token:
            kwargs["NextPageToken"] = token
        page = ce.get_cost_and_usage(**kwargs)
        pages += 1
        for result in page["ResultsByTime"]:
            total += float(result["Total"]["AmortizedCost"]["Amount"])
        token = page.get("NextPageToken")
        if not token:
            break
    check("GetCostAndUsage total across pages", abs(total - 15.75) < 1e-9, total)
    check("GetCostAndUsage actually paginated", pages == 2, pages)

    grouped = ce.get_cost_and_usage(
        TimePeriod={"Start": "2026-01-01", "End": "2026-02-01"},
        Granularity="MONTHLY",
        Metrics=["AmortizedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )
    groups = grouped["ResultsByTime"][0]["Groups"]
    check("GroupBy SERVICE", len(groups) == 1 and groups[0]["Keys"] == ["Amazon Elastic Compute Cloud - Compute"], groups)

    print("\nPricing")
    pricing = client("pricing", port)
    products = pricing.get_products(
        ServiceCode="AmazonEC2",
        Filters=[{"Type": "TERM_MATCH", "Field": "instanceType", "Value": "m6i.xlarge"}],
    )
    parsed = [json.loads(item) for item in products["PriceList"]]
    dimension = next(iter(next(iter(parsed[0]["terms"]["OnDemand"].values()))["priceDimensions"].values()))
    check("GetProducts on-demand price", dimension["pricePerUnit"]["USD"] == "0.1920000000", dimension)

    print("\nIAM")
    iam = client("iam", port)
    role = iam.get_role(RoleName="MeteringCoControlPlane")["Role"]
    check("GetRole trust policy decoded", role["AssumeRolePolicyDocument"]["Statement"][0]["Effect"] == "Allow", role)
    attached = iam.list_attached_role_policies(RoleName="MeteringCoControlPlane")["AttachedPolicies"]
    check("ListAttachedRolePolicies", len(attached) == 1, attached)
    iam.put_role_policy(
        RoleName="MeteringCoControlPlane",
        PolicyName="least-privilege",
        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "*"}]}),
    )
    inline = iam.get_role_policy(RoleName="MeteringCoControlPlane", PolicyName="least-privilege")
    check("PutRolePolicy round-trips", inline["PolicyDocument"]["Statement"][0]["Action"] == "s3:ListBucket", inline)

    print("\nCloudTrail")
    trail = client("cloudtrail", port)
    events = trail.lookup_events(
        StartTime="2026-01-05T00:00:00Z",
        EndTime="2026-01-06T00:00:00Z",
    )["Events"]
    check("LookupEvents", len(events) == 2, events)
    filtered = trail.lookup_events(
        LookupAttributes=[{"AttributeKey": "EventName", "AttributeValue": "GetObject"}]
    )["Events"]
    check("LookupEvents filtered by EventName", len(filtered) == 1, filtered)

    print("\nAdmin plane")
    import urllib.request

    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/_admin/snapshot", headers={"x-mockaws-admin-token": "smoke-token"}
    )
    snapshot = json.loads(urllib.request.urlopen(request).read())
    reports = snapshot["accounts"]["111111111111"]["buckets"]["meteringco-metering"]["objects"]
    check("Snapshot sees agent-written object", "reports/out.json" in reports, sorted(reports))

    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/_admin/snapshot")
        check("Admin plane rejects unauthenticated reads", False, "no error raised")
    except urllib.error.HTTPError as exc:
        check("Admin plane rejects unauthenticated reads", exc.code == 403, exc.code)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print("all smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
