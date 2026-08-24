#!/bin/bash
# Measure pass@k for every task against both models under test.
#
# Runs one (task, model) combination at a time so the parallel trials inside a
# run get the whole Docker memory budget. Usage:
#
#   ./shared/harness/calibrate.sh                    # everything
#   ./shared/harness/calibrate.sh tasks/03-*         # selected tasks
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1091
[ -f .env ] && source .env
set +a

PYTHON=${PYTHON:-.venv/bin/python}
MODELS=("${OPUS_MODEL:-anthropic/claude-opus-5}" "${GROK_MODEL:-x-ai/grok-4.6}")
TASKS=("$@")
if [ ${#TASKS[@]} -eq 0 ]; then
    TASKS=(tasks/*/)
fi

for task in "${TASKS[@]}"; do
    task="${task%/}"
    [ -f "$task/task.toml" ] || continue

    echo "=== $task: oracle and noop gates ==="
    PYTHONPATH=shared $PYTHON -m harness.run_task --task "$task" --agent oracle \
        --cpus 1 --artifacts "/tmp/gate-oracle-$(basename "$task")" | tail -3
    PYTHONPATH=shared $PYTHON -m harness.run_task --task "$task" --agent noop \
        --cpus 1 --artifacts "/tmp/gate-noop-$(basename "$task")" | tail -3

    for model in "${MODELS[@]}"; do
        echo "=== $task: $model (k=${PASS_AT_K:-8}) ==="
        PYTHONPATH=shared $PYTHON -m harness.run_task \
            --task "$task" \
            --agent model \
            --model "$model" \
            --cpus 1
    done
done

echo "=== summary ==="
PYTHONPATH=shared $PYTHON -m harness.pass_at_k --traces traces
