#!/bin/bash
# Bring up the local endpoint the backend talks to, then idle.
#
# One process answers the configuration store, the tenant identity provider and
# the AWS wire protocols, so the box needs a single address configured. The
# agent-facing instance serves the sandbox world; the verifier stops it and
# starts its own against material the agent never sees.
set -euo pipefail

READY_DIR=/tmp/task-infra
SCENARIO=${MOCKAWS_SCENARIO:-/opt/meteringco-sandbox/public.json}
PORT=${MOCKAWS_PORT:-4566}
SEED=${MOCKAWS_SEED:-7}

mkdir -p "$READY_DIR"
rm -f "$READY_DIR/.ready"

# With no network namespace of its own the container hostname resolves nowhere,
# and sudo prints a resolver warning over the top of every command.
if ! getent hosts "$(hostname)" > /dev/null 2>&1; then
    printf '127.0.1.1\t%s\n' "$(hostname)" >> /etc/hosts 2>/dev/null || true
fi

PYTHONPATH=/opt/mockaws python3 -m mockaws \
    --scenario "$SCENARIO" \
    --host 127.0.0.1 \
    --port "$PORT" \
    --seed "$SEED" \
    > "$READY_DIR/mockaws.log" 2>&1 &

echo $! > "$READY_DIR/mockaws.pid"

for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then
        touch "$READY_DIR/.ready"
        break
    fi
    sleep 0.5
done

if [ ! -f "$READY_DIR/.ready" ]; then
    echo "local endpoint failed to start; see $READY_DIR/mockaws.log" >&2
    cat "$READY_DIR/mockaws.log" >&2 || true
    exit 1
fi

echo "local endpoint ready on port ${PORT} (world ${SCENARIO})"

# Runs as the image entrypoint, so hand control to whatever command the harness
# supplied. Harbor replaces the image CMD with its own keep-alive, so a script
# that idles here instead of exec'ing would strand the container.
if [ "${1:-}" = "--wait" ]; then
    exec tail -f /dev/null
fi

if [ "$#" -gt 0 ]; then
    exec "$@"
fi
