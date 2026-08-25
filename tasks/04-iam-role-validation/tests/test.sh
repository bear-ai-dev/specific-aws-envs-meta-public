#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward from
# an exit code or from stdout. It stands the submitted settings API up against a
# set of AWS accounts it has never seen, replays a fixed sequence of saves
# through it, and hands the raw answers to compute_reward.py, which runs as root,
# loads no submitted code, and re-derives from the held-out document which of
# those saves should have been accepted.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="/var/lib/task-data"
VERIFIER_DATA="$TASK_DATA/verifier"
PORT=4566
BUILD_DIR=/tmp/verifier-build

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
    fail_with "held-out world document is missing from the image"
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
chmod 777 "$RUN_DIR"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one serving the held-out accounts.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" PYTHONPATH=/opt/mockaws python3 -m mockaws \
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

OBSERVED="$RUN_DIR/observed.json"
DRIVER_CONFIG="$(python3 - "$VERIFIER_DATA/run-spec.json" "$OBSERVED" <<'PY'
import json, sys

# The driver receives only what the console would send: which business is
# signed in and the body of each settings save, in order.
spec = json.load(open(sys.argv[1]))
spec["out"] = sys.argv[2]
print(json.dumps(spec))
PY
)"
DRIVER_CONFIG_PATH="$(mktemp)"
printf '%s' "$DRIVER_CONFIG" > "$DRIVER_CONFIG_PATH"
chmod 644 "$DRIVER_CONFIG_PATH"

# The settings API only stands up with the decorator metadata a real compile
# emits, so the tree is built with the image's own compiler under settings this
# script owns. Compiling submitted sources is not the same as trusting them: the
# result still only transports what the endpoint answered.
echo "=== Build the submitted tree ==="
install -m 0644 -o root -g root "$VERIFIER_DATA/drive.ts" /app/.verifier-drive.ts
install -m 0644 -o root -g root "$VERIFIER_DATA/tsconfig.verifier.json" /app/.verifier-tsconfig.json
rm -rf "$BUILD_DIR"
/usr/local/bin/tsc -p /app/.verifier-tsconfig.json > "$VERIFIER_DIR/tsc.log" 2>&1
echo "compiler diagnostic exit: $?"
rm -f /app/.verifier-drive.ts /app/.verifier-tsconfig.json
chmod -R a+rX "$BUILD_DIR" 2>/dev/null

if [ ! -f "$BUILD_DIR/.verifier-drive.js" ]; then
    fail_with "the submitted tree did not compile far enough to stand the settings API up"
fi

if start_endpoint; then
    # Everything below loads submitted code, so its exit status is a diagnostic
    # only. `env -i` keeps every verifier path and secret out of that process.
    su agent -s /bin/bash -c "cd /app && env -i \
        PATH=/usr/local/bin:/usr/bin:/bin \
        HOME=/home/agent \
        TZ=Etc/UTC \
        NODE_PATH=/app/node_modules \
        NODE_OPTIONS=--max-old-space-size=2048 \
        AWS_ENDPOINT_URL=http://127.0.0.1:${PORT} \
        AWS_ACCESS_KEY_ID=LOCALMETERINGKEY14 \
        AWS_SECRET_ACCESS_KEY=metering-secret \
        AWS_REGION=us-east-1 \
        AWS_DEFAULT_REGION=us-east-1 \
        timeout 900 node ${BUILD_DIR}/.verifier-drive.js '$DRIVER_CONFIG_PATH'" \
        > "$VERIFIER_DIR/driver.log" 2>&1
    echo "driver diagnostic exit: $?"
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
else
    echo "endpoint for the held-out accounts failed to start"
fi

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --scenario "$VERIFIER_DATA/holdout.json" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --observed "$OBSERVED"

cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
rm -rf "$RUN_DIR" "$BUILD_DIR"
