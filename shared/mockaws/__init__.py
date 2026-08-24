"""Deterministic, sealed mock AWS control plane for RL environments.

Speaks enough of the real AWS wire protocols that `boto3` and the AWS CLI work
unmodified against it via `--endpoint-url`, while keeping every response a pure
function of `(scenario, seed, call ordering)`.

Run it with `python -m mockaws --scenario <file> --port 4566`.

`server` is deliberately not imported here: `python -m mockaws.server` would
otherwise import the module twice and warn about it.
"""

from .faults import FaultInjector, Throttled, TransientServerError
from .state import World

__all__ = ["FaultInjector", "Throttled", "TransientServerError", "World"]
