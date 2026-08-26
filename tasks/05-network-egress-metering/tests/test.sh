#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward from
# an exit code or from stdout. It drives the submitted collector against an
# estate it has never seen and hands the raw usage rows to compute_reward.py,
# which runs as root, loads no submitted code, and re-derives the correct rows
# from the held-out estate document.
#
# Isolation: the port is overridable and every signal this script sends goes to
# a process it owns, identified by pidfile or by holding this port. Nothing here
# ever signals a process by name, because on a shared machine a name matches
# somebody else's emulator as readily as ours. And no score is trusted until an
# authenticated admin call proves the endpoint that answered is the one this run
# started: a zero earned by a wrong answer and a zero caused by a dead endpoint
# are indistinguishable afterwards, so the second is reported as a harness
# failure instead.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="/var/lib/task-data"
VERIFIER_DATA="$TASK_DATA/verifier"
PRISTINE="$TASK_DATA/pristine_app"
# Inside its own container nothing contends for this, so the default is right
# for the shipped image. Local verification overrides it.
PORT="${MOCKAWS_PORT:-4566}"

mkdir -p "$VERIFIER_DIR"
chmod 700 "$VERIFIER_DIR"
rm -f "$VERIFIER_DIR"/reward.json "$VERIFIER_DIR"/reward.txt "$VERIFIER_DIR"/harness-failure.txt

# Fail closed: any unexpected exit below leaves a zero reward behind.
printf '{"reward": 0, "score": 0}\n' > "$VERIFIER_DIR/reward.json"
printf '0.0\n' > "$VERIFIER_DIR/reward.txt"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one this run started against the held-out
# estate, rather than some other emulator that happens to hold the port.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SERVER_PID=""

fail_with() {
    python3 "$TESTS_DIR/compute_reward.py" --fail "$1" --output-dir "$VERIFIER_DIR"
    echo "FAIL: $1"
    exit 0
}

# A zero that is not a verdict. Anything that means "this run could not be
# measured" lands here rather than in the reward, so it can never be mistaken
# for a submission that answered wrongly.
harness_failure() {
    python3 "$TESTS_DIR/compute_reward.py" --harness-failure "$1" --output-dir "$VERIFIER_DIR"
    echo "$1" > "$VERIFIER_DIR/harness-failure.txt"
    echo "HARNESS FAILURE (not a score): $1"
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    exit 0
}

if [ "$(id -u)" != "0" ]; then
    fail_with "verifier must run as root"
fi
if [ ! -r "$VERIFIER_DATA/holdout.json" ]; then
    fail_with "the held-out estate is missing from the image"
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

# ---------------------------------------------------------------------------
# Stop the agent-facing endpoint, and nothing else
# ---------------------------------------------------------------------------

# Processes holding our port, by lsof where it exists and by reading the process
# table for our own port otherwise. Both are scoped to this port: neither can
# name a process that merely looks like ours.
port_holders() {
    if command -v lsof > /dev/null 2>&1; then
        lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null
        return
    fi
    python3 - "$PORT" <<'PY'
import os, sys

port = sys.argv[1]
for entry in os.listdir("/proc"):
    if not entry.isdigit():
        continue
    try:
        with open(f"/proc/{entry}/cmdline", "rb") as handle:
            argv = handle.read().split(b"\0")
    except OSError:
        continue
    text = [piece.decode("utf-8", "replace") for piece in argv if piece]
    if "mockaws" in " ".join(text) and port in text:
        print(entry)
PY
}

signal_port_holders() {
    port_holders | while read -r pid; do
        [ -n "$pid" ] && kill "$1" "$pid" 2>/dev/null
    done
}

echo "=== Stop the agent-facing endpoint (port ${PORT}) ==="
if [ -f /tmp/task-infra/mockaws.pid ]; then
    kill "$(cat /tmp/task-infra/mockaws.pid)" 2>/dev/null
fi
signal_port_holders -TERM

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
    if port_can_bind; then
        break
    fi
    signal_port_holders -KILL
    sleep 0.5
done
if ! port_can_bind; then
    harness_failure "port ${PORT} was still held by another process after 30s, so this run could not be isolated"
fi

RUN_DIR="$(mktemp -d)"
chmod 777 "$RUN_DIR"

# What the box started with, so the driver can tell the submission's own code
# from the tree it was handed. Hashes of files the agent already owns; nothing
# held back is revealed by them.
BASELINE="$RUN_DIR/baseline.json"
python3 - "$PRISTINE" "$BASELINE" <<'PY'
import hashlib, json, os, sys

root, out = sys.argv[1], sys.argv[2]
files = {}
src = os.path.join(root, "src")
for directory, subdirs, names in os.walk(src):
    subdirs[:] = [d for d in subdirs if d != "node_modules" and not d.startswith(".")]
    for name in names:
        if not name.endswith(".ts") or name.endswith(".d.ts"):
            continue
        path = os.path.join(directory, name)
        key = os.path.relpath(path, root).replace(os.sep, "/")
        with open(path, "rb") as handle:
            files[key] = hashlib.sha256(handle.read()).hexdigest()
with open(out, "w", encoding="utf-8") as handle:
    json.dump({"files": files}, handle)
print(f"baseline manifest: {len(files)} source files")
PY
chmod 644 "$BASELINE"

# ---------------------------------------------------------------------------
# The held-out endpoint, and proof that it is ours
# ---------------------------------------------------------------------------

# The role only the held-out estate grants. Read from the document rather than
# written down here, so it cannot drift from what is served.
EXPECTED_ROLE="$(python3 -c '
import json, sys
estate = json.load(open(sys.argv[1]))
print(next(role["name"] for account in estate["accounts"] for role in account.get("roles", [])))
' "$VERIFIER_DATA/holdout.json")"

admin() {
    curl -s --max-time 10 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" "http://127.0.0.1:${PORT}/_admin/$1"
}

# Two questions, both of which have to answer yes: is this endpoint the one this
# run started (only it knows the token), and is it serving the estate this run
# is grading (only it grants that role)?
endpoint_is_ours() {
    admin health | grep -q '"ok":true' || return 1
    admin snapshot | grep -q "\"${EXPECTED_ROLE}\"" || return 1
    return 0
}

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" PYTHONPATH=/opt/mockaws python3 -m mockaws \
        --scenario "$VERIFIER_DATA/holdout.json" --host 127.0.0.1 --port "$PORT" --seed 41 \
        > "$VERIFIER_DIR/mockaws-holdout.log" 2>&1 &
    SERVER_PID=$!
    for _ in $(seq 1 60); do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 1; fi
        if endpoint_is_ours; then return 0; fi
        sleep 0.5
    done
    kill "$SERVER_PID" 2>/dev/null
    return 1
}

if ! start_endpoint; then
    harness_failure "the held-out endpoint on port ${PORT} never answered as ours, so no score can be trusted"
fi
echo "endpoint on port ${PORT} confirmed ours (pid ${SERVER_PID}, estate role ${EXPECTED_ROLE})"

# The driver receives only what a scheduled run would carry: which business,
# which dimension, and the role to read the estate through.
OBSERVED="$RUN_DIR/observed.json"
DRIVER_CONFIG="$(python3 -c '
import json, sys
spec = json.load(open(sys.argv[1]))
spec["out"] = sys.argv[2]
spec["baseline"] = sys.argv[3]
spec["appRoot"] = sys.argv[4]
print(json.dumps(spec))
' "$VERIFIER_DATA/run-spec.json" "$OBSERVED" "$BASELINE" /app)"

# Everything below loads submitted code, so its exit status is a diagnostic
# only. `env -i` keeps every verifier path and secret out of that process.
install -m 0644 -o agent -g agent "$VERIFIER_DATA/drive.ts" /app/.verifier-drive.ts
su agent -s /bin/bash -c "cd /app && env -i \
    PATH=/usr/local/bin:/usr/bin:/bin \
    HOME=/home/agent \
    TZ=Etc/UTC \
    NODE_OPTIONS=--max-old-space-size=2048 \
    AWS_ENDPOINT_URL=http://127.0.0.1:${PORT} \
    AWS_ACCESS_KEY_ID=LOCALMETERINGKEY01 \
    AWS_SECRET_ACCESS_KEY=billing-secret \
    AWS_REGION=us-east-1 \
    AWS_DEFAULT_REGION=us-east-1 \
    timeout 900 tsx /app/.verifier-drive.ts '$DRIVER_CONFIG'" \
    > "$VERIFIER_DIR/driver.log" 2>&1
echo "driver diagnostic exit: $?"
rm -f /app/.verifier-drive.ts

# The endpoint has to still be ours now that the run is over. If it died or was
# replaced partway through, whatever the submission saw was not the held-out
# estate and the rows it produced mean nothing either way.
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    harness_failure "the held-out endpoint died during the run, so the rows observed cannot be scored"
fi
if ! endpoint_is_ours; then
    harness_failure "the endpoint on port ${PORT} stopped being ours during the run, so the rows observed cannot be scored"
fi
echo "endpoint still confirmed ours after the run"

kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --scenario "$VERIFIER_DATA/holdout.json" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --observed "$OBSERVED"

cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
rm -rf "$RUN_DIR"

# --- Harbor reward.json contract -------------------------------------------
# Harbor loads the whole of reward.json as `rewards: dict[str, float | int]`,
# so a dict, list, string or bool anywhere in it fails validation and the trial
# is recorded as an exception with no score at all. Four tasks lost every trial
# this way while grading correctly. Keep the numbers in reward.json and move
# everything else beside it.
python3 - <<'SANITISE_REWARD' 2>/dev/null || true
import json, pathlib

for path in pathlib.Path("/logs").rglob("reward.json"):
    try:
        payload = json.loads(path.read_text())
    except Exception:
        continue
    if not isinstance(payload, dict):
        continue
    numeric = {
        key: value
        for key, value in payload.items()
        # bool is an int in Python but pydantic rejects it for float|int.
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }
    if numeric == payload:
        continue
    path.with_name("reward-detail.json").write_text(
        json.dumps(payload, indent=2, default=str)
    )
    path.write_text(json.dumps(numeric))
SANITISE_REWARD
