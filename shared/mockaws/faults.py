"""Deterministic fault injection.

Real AWS misbehaves in ways that separate a correct integration from one that
merely worked once: throttling, read-after-write lag, short pages, and
transient 5xx. Every decision here is a pure function of the scenario seed and
a per-(service, action) call counter, so a given agent behaviour always
reproduces the same fault sequence.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FaultRule:
    service: str
    action: str = "*"
    # Throttle every Nth call (0 disables).
    throttle_every: int = 0
    # Return an internal error every Nth call (0 disables).
    server_error_every: int = 0
    # Cap page sizes, forcing correct pagination.
    max_page_size: int = 0
    # Seconds a freshly written object stays invisible to LIST.
    list_lag_seconds: float = 0.0
    # Extra latency in seconds.
    latency_seconds: float = 0.0

    def matches(self, service: str, action: str) -> bool:
        if self.service not in (service, "*"):
            return False
        return self.action in (action, "*")


class Throttled(Exception):
    def __init__(self, service: str, action: str) -> None:
        super().__init__(f"Rate exceeded for {service}:{action}")
        self.service = service
        self.action = action


class TransientServerError(Exception):
    def __init__(self, service: str, action: str) -> None:
        super().__init__(f"We encountered an internal error processing {service}:{action}")
        self.service = service
        self.action = action


class FaultInjector:
    def __init__(self, config: dict[str, Any] | None, seed: int = 0) -> None:
        config = config or {}
        self.seed = seed
        self.enabled: bool = bool(config.get("enabled", True))
        self.rules: list[FaultRule] = [
            FaultRule(
                service=raw.get("service", "*"),
                action=raw.get("action", "*"),
                throttle_every=int(raw.get("throttle_every", 0)),
                server_error_every=int(raw.get("server_error_every", 0)),
                max_page_size=int(raw.get("max_page_size", 0)),
                list_lag_seconds=float(raw.get("list_lag_seconds", 0.0)),
                latency_seconds=float(raw.get("latency_seconds", 0.0)),
            )
            for raw in config.get("rules", [])
        ]
        self._counts: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()
        self.counters_snapshot: dict[str, int] = field(default_factory=dict)  # type: ignore[assignment]

    def _rules_for(self, service: str, action: str) -> list[FaultRule]:
        return [rule for rule in self.rules if rule.matches(service, action)]

    def _bump(self, service: str, action: str) -> int:
        with self._lock:
            key = (service, action)
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]

    def _phase(self, service: str, action: str, modulus: int) -> int:
        """Stable per-(seed, service, action) offset so different actions do not
        all fail on the same call index."""
        if modulus <= 0:
            return 0
        raw = f"{self.seed}:{service}:{action}".encode()
        return int(hashlib.sha256(raw).hexdigest(), 16) % modulus

    def before_call(self, service: str, action: str) -> float:
        """Raise if this call should fail; return the latency to sleep."""
        if not self.enabled:
            return 0.0
        rules = self._rules_for(service, action)
        if not rules:
            return 0.0
        count = self._bump(service, action)
        latency = 0.0
        for rule in rules:
            latency = max(latency, rule.latency_seconds)
            if rule.server_error_every > 0:
                offset = self._phase(service, action, rule.server_error_every)
                if (count + offset) % rule.server_error_every == 0:
                    raise TransientServerError(service, action)
            if rule.throttle_every > 0:
                offset = self._phase(service, action, rule.throttle_every)
                if (count + offset) % rule.throttle_every == 0:
                    raise Throttled(service, action)
        return latency

    def page_size(self, service: str, action: str, requested: int) -> int:
        if not self.enabled:
            return requested
        caps = [rule.max_page_size for rule in self._rules_for(service, action) if rule.max_page_size > 0]
        if not caps:
            return requested
        return min(requested, min(caps))

    def list_lag_seconds(self, service: str, action: str) -> float:
        if not self.enabled:
            return 0.0
        lags = [rule.list_lag_seconds for rule in self._rules_for(service, action) if rule.list_lag_seconds > 0]
        return max(lags) if lags else 0.0

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {f"{service}:{action}": count for (service, action), count in sorted(self._counts.items())}
