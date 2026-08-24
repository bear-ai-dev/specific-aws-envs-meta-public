"""Per-service wire protocol implementations."""

from . import (
    autoscaling,
    cloudtrail,
    cloudwatch,
    costexplorer,
    ec2,
    eks,
    iam,
    pricing,
    s3,
    ses,
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
    "pricing",
    "s3",
    "ses",
    "sts",
]
