"""Per-service wire protocol implementations."""

from . import (
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

__all__ = [
    "auth0",
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
    "ssm",
    "sts",
]
