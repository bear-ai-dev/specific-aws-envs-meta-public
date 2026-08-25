#!/usr/bin/env python3
"""Render deterministic text views from Task 4 native mini-SWE trajectories."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TASK_ROOT = ROOT / "sample-run" / "trajectories" / "04-iam-role-validation"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def format_observation(content: str) -> str:
    try:
        data = json.loads(content)
    except (TypeError, json.JSONDecodeError):
        return str(content)
    if not isinstance(data, dict) or "returncode" not in data:
        return str(content)
    lines: list[str] = []
    for key, value in data.items():
        lines.extend((f"<{key}>", str(value)))
    return "\n".join(lines)


def format_tool_call(name: str, arguments: object) -> str:
    parsed = arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            parsed = arguments
    if isinstance(parsed, dict) and "command" in parsed:
        return f"Tool call: {name}\n```bash\n{parsed['command']}\n```"
    if not isinstance(parsed, str):
        parsed = json.dumps(parsed, indent=2, sort_keys=True)
    return f"Tool call: {name}\n```json\n{parsed}\n```"


def message_role(message: dict) -> str:
    if role := message.get("role"):
        return str(role)
    if message.get("object") == "response":
        return "assistant"
    if message.get("type") in {"function_call_output", "tool_result"}:
        return "tool"
    return str(message.get("type") or "message")


def visible_parts(message: dict) -> list[str]:
    parts: list[str] = []
    role = message_role(message)
    content = message.get("content")
    if isinstance(content, str) and content:
        parts.append(format_observation(content) if role == "tool" else content)
    elif isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use":
                parts.append(format_tool_call(str(item.get("name") or "tool"), item.get("input", {})))
            elif item.get("type") == "tool_result":
                value = item.get("content", "")
                if isinstance(value, str):
                    parts.append(format_observation(value))
            elif text := item.get("text"):
                parts.append(str(text))

    for tool_call in message.get("tool_calls") or []:
        function = tool_call.get("function") or {}
        parts.append(
            format_tool_call(
                str(function.get("name") or "tool"),
                function.get("arguments", {}),
            )
        )

    output = message.get("output")
    if isinstance(output, str) and output:
        parts.append(format_observation(output) if role == "tool" else output)
    elif isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                for block in item.get("content") or []:
                    if isinstance(block, dict) and (text := block.get("text")):
                        parts.append(str(text))
            elif item.get("type") == "function_call":
                parts.append(
                    format_tool_call(
                        str(item.get("name") or "tool"),
                        item.get("arguments", {}),
                    )
                )
    return [
        "\n".join(line.rstrip() for line in part.splitlines()).rstrip()
        for part in parts
        if part and part.strip()
    ]


def render(source: Path) -> str:
    trajectory = json.loads(source.read_text())
    lines = [
        "Rendered mini-SWE-agent transcript",
        "",
        "This deterministic text view is derived from the public native JSON trajectory.",
        f"Source: {source.name}",
        f"Source SHA256: {sha256(source)}",
        f"Mini-SWE-agent version: {(trajectory.get('info') or {}).get('mini_version', 'unknown')}",
        f"Trajectory format: {trajectory.get('trajectory_format', 'unknown')}",
    ]
    assistant_step = 0
    for message in trajectory.get("messages") or []:
        role = message_role(message)
        if role == "assistant":
            assistant_step += 1
            label = f"Assistant (step {assistant_step})"
        else:
            label = role.capitalize()
        parts = visible_parts(message)
        lines.extend(("", "-" * 80, "", f"{label}:"))
        if parts:
            lines.extend(("", "\n\n".join(parts)))
    return "\n".join(lines).rstrip() + "\n"


def generate_outputs() -> dict[Path, str]:
    outputs: dict[Path, str] = {}
    for source in sorted(TASK_ROOT.glob("*/trial-*/mini-swe-agent.trajectory.json")):
        outputs[source.with_name("mini-swe-agent.txt")] = render(source)
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = generate_outputs()
    if len(outputs) != 16:
        raise SystemExit(f"expected 16 Task 4 trajectories, found {len(outputs)}")
    stale = [path for path, text in outputs.items() if not path.is_file() or path.read_text() != text]
    if args.check:
        if stale:
            raise SystemExit(f"stale or missing Task 4 text trajectories: {len(stale)}")
        print("Task 4 text trajectory validation passed: files=16")
        return
    for path, text in outputs.items():
        path.write_text(text)
    print(f"rendered Task 4 text trajectories: files={len(outputs)}")


if __name__ == "__main__":
    main()
