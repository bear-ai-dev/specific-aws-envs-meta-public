# Per-trial metrics

This folder contains plot-ready metrics for all 48 valid trials in the matched
three-task cohort.

- [`per-trial-metrics.csv`](per-trial-metrics.csv): one flat row per trial
- [`per-trial-metrics.json`](per-trial-metrics.json): the same rows with native JSON types
- [`summary.json`](summary.json): cohort distributions and task-model cell medians

Regenerate all three files from the indexed result, native trajectory,
normalized ATIF trajectory, and verifier artifacts:

```sh
python3 harness/export_trial_metrics.py
```

Verify that the committed exports exactly match those sources:

```sh
python3 harness/export_trial_metrics.py --check
```

## Definitions

| Field | Definition |
| --- | --- |
| `attempt` | Chronological attempt number within a task-model cell, ordered by the recorded trial start timestamp. |
| `agent_seconds` | Time between Harbor's agent-execution start and finish timestamps. |
| `full_trial_seconds` | Time from the trial start through its finish, including setup and verification. |
| `model_api_calls` | Exact mini-SWE-agent `api_calls` count, recorded independently from serialized messages. |
| `assistant_messages` | Assistant-role messages retained in the native mini-SWE-agent trajectory. |
| `atif_steps` | Step count in the normalized ATIF trajectory. |
| `tool_calls_requested` | Tool-call envelopes emitted by retained model responses. One model call may request multiple tools. |
| `tool_calls_executed` | Requested tools with a recorded response that was not marked “action was not executed.” |
| `tool_calls_not_executed` | Calls explicitly recorded with return code `-1` or “action was not executed,” including submission-boundary calls. |
| `tool_nonzero_exit_count` | Executed tool responses with a nonzero shell return code. This is diagnostic and does not by itself mean the trial failed. |
| `tool_exception_count` | Executed tool responses carrying a harness exception. |
| `input_tokens` | Total prompt tokens reported by the agent. |
| `cached_input_tokens` | Cached subset of input tokens. |
| `uncached_input_tokens` | `input_tokens - cached_input_tokens`. |
| `output_tokens` | Total completion tokens reported by the agent. |
| `total_tokens` | `input_tokens + output_tokens`; cached tokens are not added again. |
| `cost_usd` | Agent-reported model cost in US dollars; it is not a normalized cross-provider price estimate. |
| `task_digest` | SHA-256 digest of the normalized public task package. |
| `result_task_checksum` | Task checksum stored by the original recorded Harbor result. |

The exporter verifies that index, result, and verifier rewards agree; ATIF and
Harbor token and cost totals agree; every requested tool call has a recorded
response; all 48 trials are valid; and every task-model cell has eight trials.
API-call and assistant-message counts are reported independently because the
model client and retained trajectory record them at different layers; equality
is not assumed.

These metrics describe recorded effort and execution. They do not, on their
own, establish why a model passed or failed; verifier-backed claims remain in
the [cohort analysis](../analysis.md).
