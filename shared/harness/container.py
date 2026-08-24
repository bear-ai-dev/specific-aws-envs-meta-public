"""Thin Docker wrapper used by the runner and the agent loop.

Containers are started with `--network none`, which leaves only loopback. The
mock AWS endpoint runs inside the container on 127.0.0.1, so the task is fully
exercised while the environment stays sealed: no task process can reach the
internet, and the model API is only ever called from the host.
"""

from __future__ import annotations

import json
import shlex
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


class DockerError(RuntimeError):
    pass


def _run(args: list[str], timeout: int = 600, check: bool = True) -> subprocess.CompletedProcess:
    completed = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and completed.returncode != 0:
        raise DockerError(f"{' '.join(args[:3])}... failed: {completed.stderr.strip()[:4000]}")
    return completed


@dataclass
class ExecResult:
    exit_code: int
    output: str
    timed_out: bool = False

    def render(self, limit: int = 20000) -> str:
        body = self.output
        if len(body) > limit:
            head = body[: limit // 2]
            tail = body[-limit // 2 :]
            omitted = len(body) - limit
            body = f"{head}\n\n... [{omitted} characters omitted] ...\n\n{tail}"
        suffix = "\n[command timed out]" if self.timed_out else ""
        return f"exit_code: {self.exit_code}\n{body}{suffix}"


class Container:
    def __init__(self, name: str, image: str) -> None:
        self.name = name
        self.image = image

    @classmethod
    def build(cls, context: Path, tag: str, dockerfile: Path | None = None, quiet: bool = True) -> str:
        args = ["docker", "build", "-t", tag]
        if dockerfile is not None:
            args += ["-f", str(dockerfile)]
        if quiet:
            args.append("-q")
        args.append(str(context))
        _run(args, timeout=2400)
        return tag

    @classmethod
    def start(
        cls,
        image: str,
        *,
        cpus: float = 2,
        memory_mb: int = 4096,
        prefix: str = "awsrl",
        network: str = "none",
    ) -> "Container":
        name = f"{prefix}-{uuid.uuid4().hex[:10]}"
        _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                name,
                f"--cpus={cpus}",
                f"--memory={memory_mb}m",
                f"--network={network}",
                image,
            ]
        )
        return cls(name, image)

    def exec(
        self,
        command: str,
        *,
        user: str = "root",
        workdir: str = "/app",
        timeout: int = 300,
        env: dict[str, str] | None = None,
    ) -> ExecResult:
        args = ["docker", "exec", "-u", user, "-w", workdir]
        for key, value in (env or {}).items():
            args += ["-e", f"{key}={value}"]
        args += [self.name, "bash", "-lc", command]
        try:
            completed = subprocess.run(
                args, capture_output=True, text=True, timeout=timeout, check=False
            )
        except subprocess.TimeoutExpired as exc:
            captured = (exc.stdout or b"") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            if isinstance(captured, bytes):
                captured = captured.decode("utf-8", "replace")
            return ExecResult(exit_code=124, output=captured, timed_out=True)
        return ExecResult(
            exit_code=completed.returncode,
            output=(completed.stdout or "") + (completed.stderr or ""),
        )

    def copy_in(self, source: Path, destination: str) -> None:
        _run(["docker", "cp", str(source), f"{self.name}:{destination}"])

    def copy_out(self, source: str, destination: Path) -> bool:
        destination.parent.mkdir(parents=True, exist_ok=True)
        completed = _run(
            ["docker", "cp", f"{self.name}:{source}", str(destination)], check=False
        )
        return completed.returncode == 0

    def write_file(self, path: str, content: str, *, user: str = "root") -> ExecResult:
        """Write a file without going through shell quoting."""
        heredoc = f"mkdir -p {shlex.quote(str(Path(path).parent))} && cat > {shlex.quote(path)} <<'__AWSRL_EOF__'\n{content}\n__AWSRL_EOF__"
        return self.exec(heredoc, user=user, workdir="/")

    def wait_healthy(self, marker: str = "/tmp/task-infra/.ready", timeout: int = 120) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.exec(f"test -f {marker}", timeout=30).exit_code == 0:
                return True
            time.sleep(1)
        return False

    def logs(self) -> str:
        completed = _run(["docker", "logs", self.name], check=False)
        return (completed.stdout or "") + (completed.stderr or "")

    def remove(self) -> None:
        _run(["docker", "rm", "-f", self.name], check=False, timeout=120)
