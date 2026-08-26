"""Per-service wire protocol implementations."""

from . import (
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
    sts,
)

__all__ = [
    "autoscaling",
    "cloudtrail",
    "cloudwatch",
    "costexplorer",
    "ec2",
    "eks",
    "iam",
    "influx",
    "pricing",
    "s3",
    "sts",
]
