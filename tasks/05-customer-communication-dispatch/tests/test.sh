#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward
# from an exit code or from stdout. It publishes customer communications the
# submission has never seen onto the bus, lets the submission do whatever it
# does, and hands the endpoint's own record of what left the process to
# compute_reward.py, which runs as root, loads no submitted code, and
# re-derives the expected messages from the held-out documents.
#
# The outbox is written by the emulator, which runs as root out of a read-only
# directory, into a run directory the agent cannot reach. Nothing the
# submission can write to is an input to the verdict.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="/var/lib/task-data"
VERIFIER_DATA="$TASK_DATA/verifier"
PORT=4566

mkdir -p "$VERIFIER_DIR"
chmod 700 "$VERIFIER_DIR"
rm -f "$VERIFIER_DIR"/reward.json "$VERIFIER_DIR"/reward.txt

# Fail closed: any unexpected exit below leaves a zero reward behind.
printf '{"reward": 0, "score": 0}\n' > "$VERIFIER_DIR/reward.json"

fail_with() {
    python3 "$TESTS_DIR/compute_reward.py" --fail "$1" --output-dir "$VERIFIER_DIR"
    echo "FAIL: $1"
    exit 0
}

if [ "$(id -u)" != "0" ]; then
    fail_with "verifier must run as root"
fi
if [ ! -r "$VERIFIER_DATA/holdout.json" ]; then
    fail_with "held-out account document is missing from the image"
fi
if [ ! -r "$VERIFIER_DATA/run-spec.json" ]; then
    fail_with "held-out communications are missing from the image"
fi
if [ ! -d /app/src ]; then
    fail_with "/app/src is missing"
fi

# Keep the graded deliverable next to the reward so a run can be audited long
# after the sandbox is gone. It is evidence, never an input to the verdict.
echo "=== Snapshot the deliverable for audit ==="
mkdir -p "$VERIFIER_DIR/deliverable"
cp -a /app/src/. "$VERIFIER_DIR/deliverable/" 2>/dev/null
for f in package.json tsconfig.json tsconfig.build.json nest-cli.json; do
    cp -a "/app/$f" "$VERIFIER_DIR/deliverable/$f" 2>/dev/null
done

echo "=== Stop the agent-facing endpoint ==="
if [ -f /tmp/task-infra/mockaws.pid ]; then
    kill "$(cat /tmp/task-infra/mockaws.pid)" 2>/dev/null
fi
pkill -f "mockaws" 2>/dev/null

# Whether the port is free is decided by trying to take it the same way the
# emulator does, not by asking whether it answers: a stale server is perfectly
# capable of answering while still owning the socket, and the held-out server
# would then die on bind and leave the submission talking to the sandbox.
port_can_bind() {
    python3 - "$PORT" <<'PY'
import socket, sys

probe = socket.socket()
probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    probe.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(1)
finally:
    probe.close()
raise SystemExit(0)
PY
}

for _ in $(seq 1 60); do
    if ! pgrep -f "python3 -m mockaws" > /dev/null 2>&1 && port_can_bind; then
        break
    fi
    pkill -9 -f "mockaws" 2>/dev/null
    sleep 0.5
done
if ! port_can_bind; then
    fail_with "the agent-facing endpoint would not release port ${PORT}"
fi

RUN_DIR="$(mktemp -d)"
# Traversable but not writable by the agent, so the graded artefact inside it
# cannot be replaced by the process being graded. The driver gets a writable
# corner of its own for diagnostics.
chmod 711 "$RUN_DIR"
DIAG_DIR="$RUN_DIR/diagnostics"
mkdir -p "$DIAG_DIR"
chmod 777 "$DIAG_DIR"

# The graded artefact. Root writes it and root reads it; the driver may count
# its lines to decide when the run has gone quiet and can do nothing else.
OUTBOX="$RUN_DIR/ses-outbox.jsonl"
: > "$OUTBOX"
chmod 644 "$OUTBOX"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one serving the held-out account.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" MOCKAWS_SES_OUTBOX="$OUTBOX" PYTHONPATH=/opt/mockaws python3 -m mockaws \
        --scenario "$VERIFIER_DATA/holdout.json" --host 127.0.0.1 --port "$PORT" --seed 41 \
        > "$VERIFIER_DIR/mockaws-holdout.log" 2>&1 &
    SERVER_PID=$!
    for _ in $(seq 1 60); do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 1; fi
        if curl -s --max-time 2 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
            "http://127.0.0.1:${PORT}/_admin/health" | grep -q '"ok":true'; then return 0; fi
        sleep 0.5
    done
    kill "$SERVER_PID" 2>/dev/null
    return 1
}

OBSERVED="$DIAG_DIR/observed.json"
DRIVER_CONFIG="$(python3 - "$VERIFIER_DATA/run-spec.json" "$OBSERVED" "$OUTBOX" <<'PY'
import json, sys

# The driver receives only what a publisher of these communications would have:
# the communications themselves. The outbox path is there so it can tell when
# the run has gone quiet, and the diagnostics path so a run can be read
# afterwards; neither is scored.
spec = json.load(open(sys.argv[1]))
spec["out"] = sys.argv[2]
spec["outbox"] = sys.argv[3]
print(json.dumps(spec))
PY
)"
DRIVER_CONFIG_PATH="$(mktemp)"
printf '%s' "$DRIVER_CONFIG" > "$DRIVER_CONFIG_PATH"
chmod 644 "$DRIVER_CONFIG_PATH"

if start_endpoint; then
    # Everything below loads submitted code, so its exit status is a diagnostic
    # only. `env -i` keeps every verifier path and secret out of that process.
    install -m 0644 -o agent -g agent "$VERIFIER_DATA/drive.ts" /app/.verifier-drive.ts
    su agent -s /bin/bash -c "cd /app && env -i \
        PATH=/usr/local/bin:/usr/bin:/bin \
        HOME=/home/agent \
        TZ=Etc/UTC \
        NODE_OPTIONS=--max-old-space-size=2048 \
        AWS_ENDPOINT_URL=http://127.0.0.1:${PORT} \
        AWS_ACCESS_KEY_ID=LOCALMETERINGKEY02 \
        AWS_SECRET_ACCESS_KEY=metering-secret \
        AWS_REGION=us-east-1 \
        AWS_DEFAULT_REGION=us-east-1 \
        timeout 900 tsx /app/.verifier-drive.ts '$DRIVER_CONFIG_PATH'" \
        > "$VERIFIER_DIR/driver.log" 2>&1
    echo "driver diagnostic exit: $?"
    rm -f /app/.verifier-drive.ts
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
else
    echo "endpoint for the held-out account failed to start"
fi

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --scenario "$VERIFIER_DATA/holdout.json" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --outbox "$OUTBOX"

cp -a "$OUTBOX" "$VERIFIER_DIR/ses-outbox.jsonl" 2>/dev/null
cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
rm -rf "$RUN_DIR"
