#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward from
# an exit code or from stdout. It submits API traffic to the submitted service
# for a tenant it has never seen, reads the resulting rows straight off the
# emulator over an admin channel the agent has no token for, and hands the
# snapshot to compute_reward.py, which runs as root, loads no submitted code,
# and works out for itself what should have been written.
#
# The traffic is specified as offsets from a base this script pins once. Both
# the driver and the scorer are given the same base, so neither has to be
# trusted with the clock.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="${TASK45_TASK_DATA:-/var/lib/task-data}"
VERIFIER_DATA="$TASK_DATA/verifier"
APP_DIR="${TASK45_APP_DIR:-/app}"
MOCKAWS_HOME="${TASK45_MOCKAWS:-/opt/mockaws}"
# Inside the task's own container there is no contention and 4566 is correct,
# which is what the image configures the service with. Somewhere shared -- a
# workstation running several of these side by side -- MOCKAWS_PORT moves this
# run onto a port of its own so that no other run's emulator can be bound,
# connected to, or signalled by mistake.
PORT="${MOCKAWS_PORT:-4566}"
RUN_AS="agent"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --port) PORT="$2"; shift 2 ;;
        --logs) VERIFIER_DIR="$2"; shift 2 ;;
        --run-as) RUN_AS="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$VERIFIER_DIR"
chmod 700 "$VERIFIER_DIR"
rm -f "$VERIFIER_DIR"/reward.json "$VERIFIER_DIR"/reward.txt

# Fail closed: any unexpected exit below leaves a zero reward behind. It is
# marked as a harness failure rather than a bare zero, because this verifier
# hands out a genuine zero for a submission that meters nothing, and a run that
# was cut short should not be mistaken for one.
printf '{"reward": 0, "score": 0, "status": "harness_failure", "reason": "the verifier did not run to completion"}\n' > "$VERIFIER_DIR/reward.json"

fail_with() {
    python3 "$TESTS_DIR/compute_reward.py" --fail "$1" --output-dir "$VERIFIER_DIR"
    echo "FAIL: $1"
    exit 0
}

if [ "$(id -u)" != "0" ]; then
    fail_with "verifier must run as root"
fi
if [ ! -r "$VERIFIER_DATA/holdout.json" ]; then
    fail_with "the held-out account is missing from the image"
fi
if [ ! -r "$VERIFIER_DATA/run-spec.json" ]; then
    fail_with "the run spec is missing from the image"
fi
if [ ! -r "$VERIFIER_DATA/drive.ts" ]; then
    fail_with "the driver is missing from the image"
fi
if [ ! -d "$APP_DIR/src" ]; then
    fail_with "$APP_DIR/src is missing"
fi

# Keep the graded deliverable next to the reward so a run can be audited long
# after the sandbox is gone. It is evidence, never an input to the verdict.
echo "=== Snapshot the deliverable for audit ==="
mkdir -p "$VERIFIER_DIR/deliverable"
cp -a "$APP_DIR/src/." "$VERIFIER_DIR/deliverable/" 2>/dev/null
for f in package.json tsconfig.json tsconfig.build.json nest-cli.json; do
    cp -a "$APP_DIR/$f" "$VERIFIER_DIR/deliverable/$f" 2>/dev/null
done

echo "=== Stop the agent-facing endpoint ==="
# Only ever this run's own emulator: the pidfile the task's init script left, and
# failing that whatever is actually holding this run's port. A pattern kill on
# the process name would match every emulator on the machine, including ones
# belonging to other work, and killing someone else's store mid-run is
# indistinguishable from a submission that wrote nothing.
stop_own_endpoint() {
    if [ -f /tmp/task-infra/mockaws.pid ]; then
        kill "$(cat /tmp/task-infra/mockaws.pid)" 2>/dev/null
        rm -f /tmp/task-infra/mockaws.pid
    fi
    local holders
    holders="$(lsof -ti ":$PORT" 2>/dev/null)"
    if [ -n "$holders" ]; then
        echo "$holders" | xargs kill 2>/dev/null
    fi
}
stop_own_endpoint

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
    holders="$(lsof -ti ":$PORT" 2>/dev/null)"
    [ -n "$holders" ] && echo "$holders" | xargs kill -9 2>/dev/null
    sleep 0.5
done
if ! port_can_bind; then
    fail_with "the agent-facing endpoint would not release port ${PORT}"
fi

RUN_DIR="$(mktemp -d)"
chmod 777 "$RUN_DIR"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one serving the held-out account, and the rows
# read back through it cannot have come from anywhere else.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# A value this run invents and writes into the store before the driver touches
# it. The scorer refuses to grade a snapshot that does not contain it, which
# rules out reading a store that belongs to something else, and rules out reading
# one that was killed and restarted underneath the run. That matters more here
# than it would elsewhere: the graded property is a row count, and a store that
# was replaced part-way through produces exactly the kind of wrong count the
# rules exist to detect.
RUN_MARKER="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# The clock is pinned here, once, by root. Every call time and every window
# bound in the run spec is an offset from it.
BASE="$(python3 -c 'from datetime import datetime,timezone; print(datetime.now(timezone.utc).isoformat().replace("+00:00","Z"))')"
echo "base instant: $BASE"

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" PYTHONPATH="$MOCKAWS_HOME" python3 -m mockaws \
        --scenario "$VERIFIER_DATA/holdout.json" --host 127.0.0.1 --port "$PORT" --seed 45 \
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
SNAPSHOT="$RUN_DIR/snapshot.json"
CALLS="$RUN_DIR/calls.json"

# The driver receives only what a caller would need: the traffic, the base it is
# measured from, and where to leave its notes.
DRIVER_CONFIG="$(python3 - "$VERIFIER_DATA/run-spec.json" "$OBSERVED" "$BASE" <<'PY'
import json, sys

print(json.dumps({"spec": json.load(open(sys.argv[1])), "out": sys.argv[2], "base": sys.argv[3]}))
PY
)"

# The organisation and token the store is configured with are part of the
# held-out setup: they are not the ones the sandbox advertises.
DRIVER_ENV="$(python3 - "$VERIFIER_DATA/run-spec.json" <<'PY'
import json, shlex, sys

spec = json.load(open(sys.argv[1]))
print(" ".join(f"{key}={shlex.quote(str(value))}" for key, value in spec["environment"].items()))
PY
)"

endpoint_is_ours() {
    kill -0 "$SERVER_PID" 2>/dev/null &&
        curl -s --max-time 5 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
            "http://127.0.0.1:${PORT}/_admin/health" | grep -q '"ok":true'
}

if start_endpoint; then
    if ! curl -sf --max-time 10 -o /dev/null -XPOST \
        "http://127.0.0.1:${PORT}/api/v2/write?bucket=verifier-marker&org=meteringco&precision=ns" \
        --data-binary "runMarker,run=${RUN_MARKER} present=1i 1000000000000000000"; then
        fail_with "could not seed this run's marker into the store"
    fi

    # Everything below loads submitted code, so its exit status is a diagnostic
    # only. `env -i` keeps every verifier path and secret out of that process.
    install -m 0644 -o "$RUN_AS" -g "$RUN_AS" "$VERIFIER_DATA/drive.ts" "$APP_DIR/.verifier-drive.ts"
    CONFIG_PATH="${TASK45_RUNDIR:-/run}/verifier-drive-config.json"
    printf '%s' "$DRIVER_CONFIG" > "$CONFIG_PATH"
    chown root:root "$CONFIG_PATH"
    chmod 0444 "$CONFIG_PATH"
    su "$RUN_AS" -s /bin/bash -c "cd $APP_DIR && env -i \
        PATH=/usr/local/bin:/usr/bin:/bin \
        HOME=/home/$RUN_AS \
        TZ=Etc/UTC \
        NODE_OPTIONS=--max-old-space-size=2048 \
        INFLUX_URL=http://127.0.0.1:${PORT} \
        AWS_ENDPOINT_URL=http://127.0.0.1:${PORT} \
        AWS_ACCESS_KEY_ID=AKIAMETERINGCOMETERING1 \
        AWS_SECRET_ACCESS_KEY=metering-secret \
        AWS_REGION=us-east-1 \
        AWS_DEFAULT_REGION=us-east-1 \
        ${DRIVER_ENV} \
        timeout 900 tsx $APP_DIR/.verifier-drive.ts $CONFIG_PATH" \
        > "$VERIFIER_DIR/driver.log" 2>&1
    echo "driver diagnostic exit: $?"
    rm -f "$APP_DIR/.verifier-drive.ts" "$CONFIG_PATH"

    # Nothing is read back until the endpoint answering has been shown to be the
    # one this run started, on a token only this process knows.
    if ! endpoint_is_ours; then
        kill "$SERVER_PID" 2>/dev/null
        fail_with "the endpoint serving the held-out account did not survive the run"
    fi

    curl -s --max-time 30 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
        "http://127.0.0.1:${PORT}/_admin/snapshot" -o "$SNAPSHOT"
    curl -s --max-time 30 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
        "http://127.0.0.1:${PORT}/_admin/calls" -o "$CALLS"

    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
else
    echo "endpoint for the held-out account failed to start"
fi

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --snapshot "$SNAPSHOT" \
    --base "$BASE" \
    --require-marker "$RUN_MARKER"

cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
cp -a "$SNAPSHOT" "$VERIFIER_DIR/snapshot.json" 2>/dev/null
cp -a "$CALLS" "$VERIFIER_DIR/calls.json" 2>/dev/null
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
