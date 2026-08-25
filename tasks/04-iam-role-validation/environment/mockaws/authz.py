"""Whether a credential set is allowed to perform an action.

The static bootstrap identity carries `Action: *`, so it is unaffected. A
session minted by `sts:AssumeRole` carries whatever the role's attached and
inline policies grant, which is how a role that can be assumed but cannot read
anything is told apart from one that can do the job.
"""

from __future__ import annotations

import fnmatch

from .state import Session


def _statement_allows(statement: dict, action: str) -> bool:
    if statement.get("Effect") != "Allow":
        return False
    actions = statement.get("Action", [])
    if isinstance(actions, str):
        actions = [actions]
    return any(fnmatch.fnmatchcase(action, pattern) for pattern in actions)


def _statement_denies(statement: dict, action: str) -> bool:
    if statement.get("Effect") != "Deny":
        return False
    actions = statement.get("Action", [])
    if isinstance(actions, str):
        actions = [actions]
    return any(fnmatch.fnmatchcase(action, pattern) for pattern in actions)


def allows(caller: Session | None, action: str) -> bool:
    """`action` is the fully qualified name, e.g. `ec2:DescribeInstances`."""
    if caller is None:
        return False
    statements = caller.permissions or []
    if any(_statement_denies(statement, action) for statement in statements):
        return False
    return any(_statement_allows(statement, action) for statement in statements)
