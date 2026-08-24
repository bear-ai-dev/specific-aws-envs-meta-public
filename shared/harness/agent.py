"""A minimal terminal agent driven through OpenRouter.

Deliberately plain: one system prompt, a `bash` tool and a `write_file` tool,
and a bounded step budget. Every model under comparison gets byte-identical
tooling and prompting so a pass-rate gap reflects the model, not the harness.

Reasoning content is preserved verbatim in the trajectory when the provider
returns it, which is what makes the captured traces useful for failure
analysis.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .container import Container, ExecResult

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are an autonomous software engineer working directly in a Linux container.

You interact with the machine only through the tools provided. There is no human \
to answer questions: decide, act, and verify your own work.

Guidance:
- Read before you write. Understand the existing code and any specification \
documents before changing anything.
- Verify empirically. Run the code, inspect real output, and re-run after each change.
- The task is complete only when you have evidence it is complete, not when the \
change looks right.
- You have a limited number of tool calls. Spend them on progress, not on \
re-reading things you already know.

When you are finished, reply with a plain message (no tool call) that summarises \
what you changed and how you verified it."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "bash",
            "description": (
                "Run a bash command in the container. Returns the exit code and combined "
                "stdout/stderr. State persists between calls (the filesystem), but each call "
                "runs in a fresh shell, so `cd` does not carry over."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to run."},
                    "timeout_sec": {
                        "type": "integer",
                        "description": "Seconds to allow before killing the command (default 120, max 900).",
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Write UTF-8 text to a path, creating parent directories and overwriting any "
                "existing file. Use this instead of heredocs for anything non-trivial."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to write."},
                    "content": {"type": "string", "description": "Full file content."},
                },
                "required": ["path", "content"],
            },
        },
    },
]


@dataclass
class Step:
    step_id: int
    source: str
    message: str = ""
    reasoning: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    observation: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentRun:
    model: str
    steps: list[Step] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0
    stop_reason: str = "unknown"
    wall_seconds: float = 0.0
    error: str | None = None

    def to_atif(self, session_id: str) -> dict[str, Any]:
        return {
            "schema_version": "ATIF-v1.0",
            "session_id": session_id,
            "agent": {
                "name": "awsrl-terminal-agent",
                "version": "1.0",
                "model_name": self.model,
                "tool_definitions": TOOLS,
            },
            "steps": [
                {
                    "step_id": str(step.step_id),
                    "source": step.source,
                    "message": step.message,
                    "reasoning": step.reasoning,
                    "tool_calls": step.tool_calls,
                    "observation": step.observation,
                    "metrics": step.metrics,
                }
                for step in self.steps
            ],
            "final_metrics": {
                "total_prompt_tokens": self.prompt_tokens,
                "total_completion_tokens": self.completion_tokens,
                "total_reasoning_tokens": self.reasoning_tokens,
                "total_cost_usd": self.cost_usd,
                "agent_steps": sum(1 for step in self.steps if step.source == "agent"),
                "stop_reason": self.stop_reason,
                "wall_seconds": self.wall_seconds,
            },
        }


def _cacheable(messages: list[dict[str, Any]], model: str) -> list[dict[str, Any]]:
    """Add prompt-cache breakpoints for providers that honour them.

    Only Anthropic reads `cache_control` through OpenRouter, so other models get
    the messages untouched. Caching changes what an input token costs, never
    what the model emits, so a cached run and an uncached one are the same
    measurement at different prices.

    Three breakpoints: the system prompt and the instruction, which never
    change, and a rolling one just behind the head of the conversation so the
    turns accumulated so far are read from cache rather than re-billed.
    """
    if not model.startswith("anthropic/"):
        return messages

    def mark(message: dict[str, Any]) -> dict[str, Any]:
        content = message.get("content")
        if not isinstance(content, str) or not content:
            return message
        marked = dict(message)
        marked["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
        return marked

    prepared = list(messages)
    for index in (0, 1):
        if index < len(prepared):
            prepared[index] = mark(prepared[index])
    # Anthropic allows four breakpoints; two are spent above. Place the rolling
    # one far enough back that the prefix it covers is stable across the next
    # few requests, otherwise every turn writes a fresh cache entry.
    rolling = len(prepared) - 3
    if rolling > 1:
        prepared[rolling] = mark(prepared[rolling])
    return prepared


def _post(payload: dict[str, Any], api_key: str, timeout: int = 900) -> dict[str, Any]:
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/meteringco/aws-rl-envs",
            "X-Title": "aws-rl-envs",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def complete(payload: dict[str, Any], api_key: str, attempts: int = 5) -> dict[str, Any]:
    delay = 5.0
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return _post(payload, api_key)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:600]
            last_error = RuntimeError(f"HTTP {exc.code}: {body}")
            # 4xx other than rate limiting will not fix themselves.
            if exc.code not in (408, 409, 429) and exc.code < 500:
                raise last_error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt < attempts - 1:
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise RuntimeError(f"OpenRouter request failed after {attempts} attempts: {last_error}")


def _tool_result(container: Container, name: str, arguments: dict[str, Any]) -> ExecResult:
    if name == "bash":
        timeout = int(arguments.get("timeout_sec") or 120)
        timeout = max(5, min(timeout, 900))
        return container.exec(
            arguments.get("command", ""), user="agent", workdir="/app", timeout=timeout
        )
    if name == "write_file":
        path = arguments.get("path", "")
        if not path:
            return ExecResult(exit_code=2, output="write_file requires a path")
        result = container.write_file(path, arguments.get("content", ""), user="agent")
        if result.exit_code == 0:
            return ExecResult(exit_code=0, output=f"wrote {path}")
        return result
    return ExecResult(exit_code=2, output=f"unknown tool: {name}")


def run_agent(
    container: Container,
    instruction: str,
    *,
    model: str,
    api_key: str,
    max_steps: int = 90,
    wall_clock_limit: int = 5400,
    temperature: float | None = None,
    reasoning_effort: str | None = None,
) -> AgentRun:
    run = AgentRun(model=model)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": instruction},
    ]
    run.steps.append(Step(step_id=0, source="system", message=SYSTEM_PROMPT))
    run.steps.append(Step(step_id=1, source="user", message=instruction))

    started = time.time()
    step_id = 2

    for _ in range(max_steps):
        if time.time() - started > wall_clock_limit:
            run.stop_reason = "wall_clock_limit"
            break

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "tools": TOOLS,
            "tool_choice": "auto",
            "max_tokens": 8192,
            "usage": {"include": True},
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if reasoning_effort is not None:
            payload["reasoning"] = {"effort": reasoning_effort}

        try:
            response = complete(payload, api_key)
        except RuntimeError as exc:
            run.error = str(exc)
            run.stop_reason = "provider_error"
            break

        usage = response.get("usage") or {}
        run.prompt_tokens += int(usage.get("prompt_tokens") or 0)
        run.completion_tokens += int(usage.get("completion_tokens") or 0)
        details = usage.get("completion_tokens_details") or {}
        run.reasoning_tokens += int(details.get("reasoning_tokens") or 0)
        run.cost_usd += float(usage.get("cost") or 0.0)

        choices = response.get("choices") or []
        if not choices:
            run.error = f"no choices in response: {json.dumps(response)[:500]}"
            run.stop_reason = "provider_error"
            break

        choice = choices[0]
        message = choice.get("message") or {}
        content = message.get("content") or ""
        reasoning = message.get("reasoning") or ""
        tool_calls = message.get("tool_calls") or []

        run.steps.append(
            Step(
                step_id=step_id,
                source="agent",
                message=content,
                reasoning=reasoning,
                tool_calls=[
                    {
                        "id": call.get("id"),
                        "name": (call.get("function") or {}).get("name"),
                        "arguments": (call.get("function") or {}).get("arguments"),
                    }
                    for call in tool_calls
                ],
                metrics={
                    "prompt_tokens": usage.get("prompt_tokens"),
                    "completion_tokens": usage.get("completion_tokens"),
                    "reasoning_tokens": details.get("reasoning_tokens"),
                    "finish_reason": choice.get("finish_reason"),
                },
            )
        )
        step_id += 1

        assistant_message: dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_message["tool_calls"] = tool_calls
        messages.append(assistant_message)

        if not tool_calls:
            run.stop_reason = "agent_finished"
            break

        for call in tool_calls:
            function = call.get("function") or {}
            name = function.get("name", "")
            raw_arguments = function.get("arguments") or "{}"
            try:
                arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
            except json.JSONDecodeError:
                arguments = {}
                observation = f"could not parse tool arguments as JSON: {raw_arguments[:400]}"
                result = ExecResult(exit_code=2, output=observation)
            else:
                result = _tool_result(container, name, arguments)

            rendered = result.render()
            run.steps.append(
                Step(
                    step_id=step_id,
                    source="tool",
                    message=f"{name}({json.dumps(arguments)[:2000]})",
                    observation=rendered,
                    metrics={"exit_code": result.exit_code, "timed_out": result.timed_out},
                )
            )
            step_id += 1
            messages.append(
                {"role": "tool", "tool_call_id": call.get("id"), "content": rendered}
            )
    else:
        run.stop_reason = "max_steps"

    run.wall_seconds = time.time() - started
    return run
