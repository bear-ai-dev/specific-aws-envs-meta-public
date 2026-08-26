#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward
# from an exit code or from stdout. It replays one console session against a
# world the submission has never seen, and hands what actually changed -- the
# credentials the identity provider still holds and the configuration rows the
# store ended up with, both read from the endpoint's own admin plane with a
# token minted fresh for this run -- to compute_reward.py, which runs as root,
# loads no submitted code, and re-derives what each request should have done.
#
# Two ports are in play, the endpoint's and the application's. Both default to
# the values the shipped container uses and both can be overridden, so that a
# workstation running several of these side by side never has two runs sharing
# a socket. Nothing here signals a process it did not start.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="/var/lib/task-data"
VERIFIER_DATA="$TASK_DATA/verifier"
PORT="${MOCKAWS_PORT:-4566}"
APP_PORT="${METERINGCO_APP_PORT:-3946}"
AGENT_PID_FILE="${MOCKAWS_PID_FILE:-/tmp/task-infra/mockaws.pid}"
AUDIENCE="https://example1234.execute-api.us-east-1.amazonaws.com"

mkdir -p "$VERIFIER_DIR"
chmod 700 "$VERIFIER_DIR"
rm -f "$VERIFIER_DIR"/reward.json "$VERIFIER_DIR"/reward.txt

# Fail closed: any unexpected exit below leaves a zero reward behind. It is
# marked as a harness failure because that is what an unexpected exit is; every
# path that reaches a real verdict overwrites this.
printf '{"reward": 0, "score": 0, "harness_failure": true, "note": "harness: the verifier did not run to completion"}\n' \
    > "$VERIFIER_DIR/reward.json"

# Without this the two functions below cannot record anything, and a run that
# cannot record a verdict must not look like a run that recorded zero.
if [ ! -r "$TESTS_DIR/compute_reward.py" ]; then
    echo "HARNESS FAILURE: compute_reward.py is not next to test.sh"
    exit 0
fi

fail_with() {
    python3 "$TESTS_DIR/compute_reward.py" --fail "$1" --output-dir "$VERIFIER_DIR"
    echo "FAIL: $1"
    exit 0
}

# A harness failure is not a wrong answer. It is recorded as its own outcome so
# that a run which never got a fair chance is never mistaken for a submission
# that got the behaviour wrong.
harness_failure() {
    python3 "$TESTS_DIR/compute_reward.py" --harness-failure "$1" --output-dir "$VERIFIER_DIR"
    echo "HARNESS FAILURE: $1"
    exit 0
}

if [ "$(id -u)" != "0" ]; then
    fail_with "verifier must run as root"
fi
if [ ! -r "$VERIFIER_DATA/holdout.json" ]; then
    fail_with "the held-out world is missing from the image"
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

# Whoever is holding one of our two ports, by asking the kernel rather than by
# matching a command line: a pattern match would reach processes belonging to
# somebody else entirely.
port_holders() {
    if command -v lsof > /dev/null 2>&1; then
        lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null
    elif command -v fuser > /dev/null 2>&1; then
        fuser -n tcp "$1" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
    fi
}

# Whether a port is free is decided by trying to take it the same way the
# server does, not by asking whether it answers: a stale process is perfectly
# capable of answering while still owning the socket, and the held-out server
# would then die on bind and leave the submission talking to somebody else's
# world.
port_can_bind() {
    python3 - "$1" <<'PY'
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

release_port() {
    local port="$1" signal="$2" pid
    for pid in $(port_holders "$port"); do
        kill "$signal" "$pid" 2>/dev/null
    done
}

echo "=== Stop the agent-facing endpoint ==="
if [ -f "$AGENT_PID_FILE" ]; then
    kill "$(cat "$AGENT_PID_FILE")" 2>/dev/null
fi

for _ in $(seq 1 60); do
    if port_can_bind "$PORT"; then break; fi
    release_port "$PORT" -TERM
    sleep 0.5
done
if ! port_can_bind "$PORT"; then
    release_port "$PORT" -KILL
    sleep 1
fi
if ! port_can_bind "$PORT"; then
    harness_failure "port ${PORT} is held by a process this run did not start"
fi

RUN_DIR="$(mktemp -d)"
chmod 777 "$RUN_DIR"

# Only this process knows the token, so a successful admin call is the first
# half of the proof that the endpoint answering is ours. The second half is
# that what it returns is the world we started it with.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

MANAGEMENT_CLIENT_ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["managementClientId"])' "$VERIFIER_DATA/run-spec.json")"
MANAGEMENT_CLIENT_SECRET="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["managementClientSecret"])' "$VERIFIER_DATA/run-spec.json")"

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" \
    PYTHONPATH=/opt/mockaws python3 -m mockaws \
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

# Answering with our token is necessary but not sufficient; the endpoint also
# has to be holding the world we handed it.
endpoint_is_ours() {
    curl -s --max-time 20 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
        "http://127.0.0.1:${PORT}/_admin/snapshot" > "$1" || return 1
    python3 - "$1" "$VERIFIER_DATA/holdout.json" <<'PY'
import json, sys

try:
    served = json.load(open(sys.argv[1]))
    expected = json.load(open(sys.argv[2]))
except Exception:
    raise SystemExit(1)
wanted = {client["client_id"] for client in expected["identity"]["clients"]}
held = set(served.get("identity", {}).get("clients", {}))
# Credentials are removed over the course of a run, so the test is that the
# endpoint is holding this world's credentials and nobody else's.
raise SystemExit(0 if held and held <= wanted else 1)
PY
}

OBSERVED="$RUN_DIR/observed.json"
DRIVER_CONFIG_PATH="$RUN_DIR/driver.json"
python3 - "$VERIFIER_DATA/run-spec.json" "$OBSERVED" "$APP_PORT" "$PORT" "$AUDIENCE" "$DRIVER_CONFIG_PATH" <<'PY'
import json, sys

# The driver receives only what a console would send: two sign-ins and the
# identifiers of the credentials somebody clicked on.
spec = json.load(open(sys.argv[1]))
spec["out"] = sys.argv[2]
spec["port"] = int(sys.argv[3])
spec["endpoint"] = f"http://127.0.0.1:{sys.argv[4]}"
spec["audience"] = sys.argv[5]
with open(sys.argv[6], "w") as handle:
    json.dump(spec, handle)
PY
chmod 644 "$DRIVER_CONFIG_PATH"

AGENT_ENV=(
    "PATH=/usr/local/bin:/usr/bin:/bin"
    "HOME=/home/agent"
    "TZ=Etc/UTC"
    "STAGE=local"
    "NODE_OPTIONS=--max-old-space-size=3072 --require /opt/meteringco-runtime/identity-shim.cjs"
    "IDENTITY_PROVIDER_PORT=${PORT}"
    "INFLUX_URL=http://127.0.0.1:${PORT}"
    "INFLUX_ORG=meteringco"
    "INFLUX_TOKEN=local-config-token"
    "AUTH0_AUDIENCE=${AUDIENCE}"
    "AUTH0_ISSUER_URL=https://auth.meteringco.example/"
    "SESSION_SECRET=local-session-secret"
    "METERINGCO_DASHBOARD_CLIENT_ID=${MANAGEMENT_CLIENT_ID}"
    "METERINGCO_DASHBOARD_CLIENT_SECRET=${MANAGEMENT_CLIENT_SECRET}"
    "APP_DIR=/app"
)

# The two commands below are strings handed to another shell, which will split
# them on whitespace before `env` ever sees them. One of these assignments has a
# space in its value, so it has to be quoted for that second parse: unquoted,
# the word after the space becomes the command name and the run dies with
# "command not found" before anything is compiled or driven.
AGENT_ENV_QUOTED=""
for assignment in "${AGENT_ENV[@]}"; do
    AGENT_ENV_QUOTED+="$(printf '%q ' "$assignment")"
done

echo "=== Compile the deliverable ==="
# Compiled rather than transpiled on the fly, because the framework this tree
# uses resolves its dependencies from type metadata that only a real
# TypeScript build emits. A submission that will not compile is a wrong answer,
# not a crash: the driver simply finds nothing to talk to.
su agent -s /bin/bash -c "cd /app && env -i $AGENT_ENV_QUOTED timeout 900 npm run build" \
    > "$VERIFIER_DIR/build.log" 2>&1
BUILD_EXIT=$?
echo "build diagnostic exit: $BUILD_EXIT"

# 126 and 127 mean the shell could not execute what it was handed, which is a
# statement about this script rather than about the submission. A submission
# that merely fails to compile exits with something else and is graded as the
# wrong answer it is.
if [ "$BUILD_EXIT" = 127 ] || [ "$BUILD_EXIT" = 126 ]; then
    harness_failure "the build command could not be executed (exit ${BUILD_EXIT}); see build.log"
fi

if ! port_can_bind "$PORT"; then
    harness_failure "port ${PORT} was taken while the deliverable was compiling"
fi

if ! start_endpoint; then
    harness_failure "the endpoint for the held-out world would not start on port ${PORT}"
fi

if ! endpoint_is_ours "$RUN_DIR/precheck.json"; then
    kill "$SERVER_PID" 2>/dev/null
    harness_failure "the endpoint answering on port ${PORT} is not serving this run's world"
fi

# Checked here rather than earlier because it is used here: a port that was free
# when the run started is not necessarily free by the time the deliverable has
# finished compiling, and an application port held by somebody else produces an
# authentication failure indistinguishable from a graded rule firing correctly.
if ! port_can_bind "$APP_PORT"; then
    kill "$SERVER_PID" 2>/dev/null
    harness_failure "port ${APP_PORT} is held by a process this run did not start"
fi

# Everything below loads submitted code, so its exit status is a diagnostic
# only. `env -i` keeps every verifier path and secret out of that process.
install -m 0644 -o agent -g agent "$VERIFIER_DATA/drive.cjs" /app/.verifier-drive.cjs
su agent -s /bin/bash -c "cd /app && env -i $AGENT_ENV_QUOTED \
    timeout 900 node /app/.verifier-drive.cjs '$DRIVER_CONFIG_PATH'" \
    > "$VERIFIER_DIR/driver.log" 2>&1
DRIVER_EXIT=$?
echo "driver diagnostic exit: $DRIVER_EXIT"
rm -f /app/.verifier-drive.cjs

# The driver records a refusal as an exchange and returns zero; it returns zero
# even when the deliverable throws on load. So a non-zero exit here is never the
# submission's answer -- it is the driver not having run, or having been killed.
if [ "$DRIVER_EXIT" != 0 ]; then
    kill "$SERVER_PID" 2>/dev/null
    harness_failure "the driver did not complete (exit ${DRIVER_EXIT}); see driver.log"
fi

# The wrong answer is a transcript full of refusals, never the absence of one.
if [ ! -s "$OBSERVED" ]; then
    kill "$SERVER_PID" 2>/dev/null
    harness_failure "the driver left no transcript behind; see driver.log"
fi

if ! endpoint_is_ours "$RUN_DIR/snapshot.json"; then
    kill "$SERVER_PID" 2>/dev/null
    harness_failure "the endpoint stopped being ours part way through the run"
fi
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --scenario "$VERIFIER_DATA/holdout.json" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --observed "$OBSERVED" \
    --snapshot "$RUN_DIR/snapshot.json"

cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
cp -a "$RUN_DIR/snapshot.json" "$VERIFIER_DIR/endpoint-snapshot.json" 2>/dev/null
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
