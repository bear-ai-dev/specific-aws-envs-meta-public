#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward
# from an exit code or from stdout. It hands the submitted intake a set of
# messages it has never seen, then reads the resulting object store off the
# emulator itself, as root, once the submission's process has exited.
# compute_reward.py loads no submitted code and re-derives which of those
# messages had to be dead-lettered and what each record had to contain.
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
if [ ! -r "$VERIFIER_DATA/run-spec.json" ]; then
    fail_with "the held-out intake spec is missing from the image"
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

DLQ_BUCKET="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['dlqBucket'])" "$VERIFIER_DATA/run-spec.json")"
INGESTION_BUCKET="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['ingestionBucket'])" "$VERIFIER_DATA/run-spec.json")"
PHASES="$(python3 -c "import json,sys; print(' '.join(p['label'] for p in json.load(open(sys.argv[1]))['phases']))" "$VERIFIER_DATA/run-spec.json")"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one serving the held-out world.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

attempt_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" PYTHONPATH=/opt/mockaws python3 -m mockaws \
        --scenario "$VERIFIER_DATA/$1" --host 127.0.0.1 --port "$PORT" --seed 41 \
        >> "$VERIFIER_DIR/mockaws-$2.log" 2>&1 &
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

# A phase that never came up would score a correct submission zero, so the
# start is retried rather than trusted once. The admin token is minted by this
# process alone, so an endpoint that answers the health call is the one serving
# the held-out world and not a survivor from the sandbox.
start_endpoint() {
    for attempt in 1 2 3; do
        for _ in $(seq 1 40); do
            port_can_bind && break
            pkill -9 -f "python3 -m mockaws" 2>/dev/null
            sleep 0.5
        done
        if attempt_endpoint "$1" "$2"; then return 0; fi
        echo "endpoint attempt ${attempt} for $2 did not come up"
        pkill -9 -f "python3 -m mockaws" 2>/dev/null
        sleep 1
    done
    return 1
}

stop_endpoint() {
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 40); do
        port_can_bind && return 0
        sleep 0.25
    done
    return 1
}

for PHASE in $PHASES; do
    echo "=== Phase ${PHASE} ==="
    SCENARIO="$(python3 - "$VERIFIER_DATA/run-spec.json" "$PHASE" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1]))
print(next(p["scenario"] for p in spec["phases"] if p["label"] == sys.argv[2]))
PY
)"
    OBSERVED="$RUN_DIR/observed-$PHASE.json"
    DRIVER_CONFIG="$(python3 - "$VERIFIER_DATA/run-spec.json" "$PHASE" "$OBSERVED" <<'PY'
import json, sys

# The driver receives only what a caller of the endpoint would supply: the
# request bodies, and where to write down what it was told in reply.
spec = json.load(open(sys.argv[1]))
phase = next(p for p in spec["phases"] if p["label"] == sys.argv[2])
print(json.dumps({"cases": phase["cases"], "out": sys.argv[3]}))
PY
)"
    DRIVER_CONFIG_PATH="$(mktemp)"
    printf '%s' "$DRIVER_CONFIG" > "$DRIVER_CONFIG_PATH"
    chmod 644 "$DRIVER_CONFIG_PATH"

    if start_endpoint "$SCENARIO" "$PHASE"; then
        # Everything below loads submitted code, so its exit status is a
        # diagnostic only. `env -i` keeps every verifier path and secret out of
        # that process, and the bucket names it is given are not the ones the
        # sandbox used.
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
            DB_MEASUREMENT_BUCKET_NAME=${INGESTION_BUCKET} \
            DB_MEASUREMENT_DLQ_BUCKET_NAME=${DLQ_BUCKET} \
            timeout 600 tsx /app/.verifier-drive.ts '$DRIVER_CONFIG_PATH'" \
            > "$VERIFIER_DIR/driver-$PHASE.log" 2>&1
        echo "driver diagnostic exit: $?"
        rm -f /app/.verifier-drive.ts

        # Read the store the way an auditor would, as root, after the
        # submission's process is gone. Nothing the submission wrote to disk
        # is consulted.
        python3 - "http://127.0.0.1:${PORT}" "$DLQ_BUCKET" "$RUN_DIR/dlq-$PHASE.json" <<'PY'
import json, sys, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

endpoint, bucket, out = sys.argv[1], sys.argv[2], sys.argv[3]
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


def fetch(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.read()


keys, token, state = [], "", {}
try:
    while len(keys) < 5000:
        query = {"list-type": "2", "max-keys": "1000"}
        if token:
            query["continuation-token"] = token
        payload = fetch(f"{endpoint}/{bucket}?{urllib.parse.urlencode(query)}")
        root = ET.fromstring(payload)
        keys.extend(node.text or "" for node in root.iter(f"{NS}Key"))
        truncated = (root.findtext(f"{NS}IsTruncated") or "false") == "true"
        token = root.findtext(f"{NS}NextContinuationToken") or ""
        if not truncated or not token:
            break
    objects = {}
    for key in keys:
        try:
            objects[key] = fetch(
                f"{endpoint}/{bucket}/{urllib.parse.quote(key, safe='/')}"
            ).decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as error:
            objects[key] = ""
            print(f"could not read {key}: {error}")
    state = {"objects": objects}
except (urllib.error.URLError, ET.ParseError, OSError) as error:
    state = {"missing": True, "reason": str(error)}

with open(out, "w", encoding="utf-8") as handle:
    json.dump(state, handle, indent=2)
print(f"{bucket}: {len(state.get('objects', {}))} object(s)")
PY
        stop_endpoint || echo "warning: endpoint for ${PHASE} was slow to release the port"
    else
        echo "endpoint for phase ${PHASE} failed to start"
    fi
done

echo "=== Assemble the observations ==="
python3 - "$RUN_DIR" "$PHASES" <<'PY'
import json, os, sys

run_dir, phases = sys.argv[1], sys.argv[2].split()
results = {}
for phase in phases:
    entry = {}
    for name, path in (
        ("observed", os.path.join(run_dir, f"observed-{phase}.json")),
        ("dlq", os.path.join(run_dir, f"dlq-{phase}.json")),
    ):
        try:
            with open(path, encoding="utf-8") as handle:
                entry[name] = json.load(handle)
        except (OSError, ValueError):
            entry[name] = {}
    results[phase] = entry
with open(os.path.join(run_dir, "results.json"), "w", encoding="utf-8") as handle:
    json.dump(results, handle, indent=2)
PY

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --results "$RUN_DIR/results.json"

cp -a "$RUN_DIR/results.json" "$VERIFIER_DIR/results.json" 2>/dev/null
rm -rf "$RUN_DIR"
