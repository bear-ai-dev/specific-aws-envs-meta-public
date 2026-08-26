#!/bin/bash
# Verifier entry point.
#
# Trust model: the agent owns /app, so anything that loads /app code can
# fabricate its own success. This script therefore never derives the reward
# from an exit code or from stdout. It replays a fixed list of saves against
# businesses the box has never seen, then hands two things to compute_reward.py
# -- what the service answered, and what the configuration ledger actually
# ended up holding, read over an admin channel whose token is minted here and
# never leaves this process. The scorer runs as root and loads no submitted
# code.
#
# Two failure kinds are kept apart. A submission that answers wrongly scores
# zero, which is a verdict. A run whose ledger never came up, went away
# underneath it, or turned out not to be the one this process started is a
# harness failure: the reward still fails closed at zero, but it is recorded as
# a run that produced no verdict at all rather than as evidence about the
# submission.
set -uo pipefail

VERIFIER_DIR="/logs/verifier"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_DATA="/var/lib/task-data"
VERIFIER_DATA="$TASK_DATA/verifier"

# Inside its own container nothing else competes for this, so the default is
# correct for the shipped image. Builder-side runs share a machine with other
# tasks' emulators and override it.
PORT="${MOCKAWS_PORT:-4566}"

mkdir -p "$VERIFIER_DIR"
chmod 700 "$VERIFIER_DIR"
rm -f "$VERIFIER_DIR"/reward.json "$VERIFIER_DIR"/reward.txt "$VERIFIER_DIR"/harness-failure

# Fail closed: any unexpected exit below leaves a zero reward behind.
printf '{"reward": 0, "score": 0}\n' > "$VERIFIER_DIR/reward.json"
printf '0.0\n' > "$VERIFIER_DIR/reward.txt"

fail_with() {
    python3 "$TESTS_DIR/compute_reward.py" --fail "$1" --output-dir "$VERIFIER_DIR"
    echo "FAIL: $1"
    exit 0
}

harness_fail() {
    printf '%s\n' "$1" > "$VERIFIER_DIR/harness-failure"
    python3 "$TESTS_DIR/compute_reward.py" --harness "$1" --output-dir "$VERIFIER_DIR"
    echo "HARNESS FAILURE: $1"
    echo "This run produced no verdict about the submission. Re-run it."
    exit 0
}

if [ "$(id -u)" != "0" ]; then
    fail_with "verifier must run as root"
fi
if [ ! -r "$VERIFIER_DATA/holdout.json" ]; then
    fail_with "the held-out ledger is missing from the image"
fi
if [ ! -r "$VERIFIER_DATA/run-spec.json" ]; then
    fail_with "the list of saves to replay is missing from the image"
fi
if [ ! -d /app/src ]; then
    fail_with "/app/src is missing"
fi
if [ ! -x /app/node_modules/.bin/ts-node ]; then
    fail_with "the project's TypeScript runner is missing from /app"
fi

# Keep the graded deliverable next to the reward so a run can be audited long
# after the sandbox is gone. It is evidence, never an input to the verdict.
echo "=== Snapshot the deliverable for audit ==="
mkdir -p "$VERIFIER_DIR/deliverable"
cp -a /app/src/. "$VERIFIER_DIR/deliverable/" 2>/dev/null
for f in package.json tsconfig.json tsconfig.build.json nest-cli.json; do
    cp -a "/app/$f" "$VERIFIER_DIR/deliverable/$f" 2>/dev/null
done

# Only ever signal something this task started. A pattern match on the
# emulator's name would reach every other emulator running on the same machine,
# which is how a verifier ends up killing a neighbour's ledger halfway through
# their run -- and how a neighbour ends up killing this one.
who_holds_the_port() {
    if command -v lsof > /dev/null 2>&1; then
        lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null
    elif command -v fuser > /dev/null 2>&1; then
        fuser -n tcp "$PORT" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
    fi
}

stop_port_holder() {
    local signal="$1"
    local holders
    holders="$(who_holds_the_port)"
    if [ -n "$holders" ]; then
        echo "$holders" | xargs -r kill "$signal" 2>/dev/null
    fi
}

echo "=== Stop the agent-facing endpoint ==="
if [ -f /tmp/task-infra/mockaws.pid ]; then
    kill "$(cat /tmp/task-infra/mockaws.pid)" 2>/dev/null
fi
stop_port_holder -TERM

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
    stop_port_holder -KILL
    sleep 0.5
done
if ! port_can_bind; then
    harness_fail "port ${PORT} is held by something this run did not start and would not release"
fi

RUN_DIR="$(mktemp -d)"
chmod 777 "$RUN_DIR"

# Only this process knows the token, so a successful admin call is proof that
# the endpoint answering is the one this run started over the held-out ledger,
# rather than some other ledger that happened to take the port.
ADMIN_TOKEN="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PIDFILE="$RUN_DIR/holdout.pid"

admin_answers() {
    curl -s --max-time 5 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
        "http://127.0.0.1:${PORT}/_admin/health" 2>/dev/null | grep -q '"ok":true'
}

start_endpoint() {
    MOCKAWS_ADMIN_TOKEN="$ADMIN_TOKEN" PYTHONPATH=/opt/mockaws python3 -m mockaws \
        --scenario "$VERIFIER_DATA/holdout.json" --host 127.0.0.1 --port "$PORT" --seed 47 \
        > "$VERIFIER_DIR/mockaws-holdout.log" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PIDFILE"
    for _ in $(seq 1 60); do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 1; fi
        if admin_answers; then return 0; fi
        sleep 0.5
    done
    kill "$SERVER_PID" 2>/dev/null
    return 1
}

OBSERVED="$RUN_DIR/observed.json"
LEDGER="$RUN_DIR/ledger.json"
DRIVER_CONFIG="$(python3 -c '
import json, sys
spec = json.load(open(sys.argv[1]))
print(json.dumps({"steps": spec["steps"], "out": sys.argv[2]}))
' "$VERIFIER_DATA/run-spec.json" "$OBSERVED")"

if ! start_endpoint; then
    harness_fail "the ledger for the held-out businesses would not come up on port ${PORT}"
fi

# The runner is handed the target the project itself compiles at, because it
# does not otherwise arrive at one.
#
# `tsconfig.json` declares no `target`. Every path this tree actually uses
# supplies one anyway: `tsc` infers ESNext from `module: NodeNext`, so
# `nest build` and `nest start` emit native classes, and the repo's own API
# suite compiles at es2017 through `testTSConfig.json`. ts-node is the only
# loader that lands on its own es5 default, and at es5 a `class` that extends a
# call expression is emitted as `_super.apply(this, arguments)`. Nest's
# `PickType`/`PartialType`/`OmitType` return native ES2015 classes, which cannot
# be called that way, so a request DTO written in this tree's dominant idiom --
# `UpdateCustomerDto`, `UpdateServiceDto`, `UpdateOfferingDto` and a dozen more
# are all `extends PartialType(...)` -- throws inside ValidationPipe and answers
# 500. That is the harness lowering the submission into something the project
# never builds, then scoring the wreckage. es5 also silently mis-lowers
# `for...of` and spread over non-arrays, so the same defect had more shapes than
# the one it was caught in.
#
# es2017 is the repo's own declared test target: it emits native classes, and it
# keeps assignment semantics for class fields, which ES2022 and above would
# quietly change. Overriding here rather than editing /app leaves the target out
# of the submission's reach.
TS_TARGET_OVERRIDE='{"target":"es2017"}'

# An override that silently failed to apply would put the run straight back to
# judging the submission on an es5 emit, and the only symptom would look like a
# wrong answer. So the target is read back out of the runner first, and a run
# that cannot confirm it says nothing about the submission.
target_in_effect() {
    su agent -s /bin/bash -c "cd /app && env -i \
        PATH=/usr/local/bin:/usr/bin:/bin \
        HOME=/home/agent \
        TS_NODE_COMPILER_OPTIONS='$TS_TARGET_OVERRIDE' \
        /app/node_modules/.bin/ts-node --show-config" 2> /dev/null \
        | python3 -c 'import json,sys
try:
    print(((json.load(sys.stdin) or {}).get("compilerOptions") or {}).get("target") or "")
except Exception:
    print("")' 2> /dev/null
}

TS_TARGET="$(target_in_effect)"
if [ "$TS_TARGET" != "es2017" ]; then
    harness_fail "the TypeScript runner reports target '${TS_TARGET:-unknown}' rather than the project's es2017, so the submission would be judged on an emit this project never builds"
fi

# Everything below loads submitted code, so its exit status is a diagnostic
# only. `env -i` keeps every verifier path and secret out of that process.
install -m 0644 -o agent -g agent "$VERIFIER_DATA/drive.ts" /app/.verifier-drive.ts
install -m 0644 -o agent -g agent "$VERIFIER_DATA/resolve-hook.js" /app/.verifier-resolve.js
su agent -s /bin/bash -c "cd /app && env -i \
    PATH=/usr/local/bin:/usr/bin:/bin \
    HOME=/home/agent \
    TZ=Etc/UTC \
    NODE_OPTIONS=--max-old-space-size=2048 \
    TS_NODE_COMPILER_OPTIONS='$TS_TARGET_OVERRIDE' \
    STAGE=qa \
    INFLUX_URL=http://127.0.0.1:${PORT} \
    INFLUX_ORG=meteringco \
    INFLUX_TOKEN=holdout-ledger-token \
    AWS_ENDPOINT_URL=http://127.0.0.1:${PORT} \
    AWS_ACCESS_KEY_ID=LOCALMETERINGKEY01 \
    AWS_SECRET_ACCESS_KEY=billing-secret \
    AWS_REGION=us-east-1 \
    AWS_DEFAULT_REGION=us-east-1 \
    timeout 900 /app/node_modules/.bin/ts-node --transpile-only \
        -r /app/.verifier-resolve.js -r tsconfig-paths/register \
        /app/.verifier-drive.ts '$DRIVER_CONFIG'" \
    > "$VERIFIER_DIR/driver.log" 2>&1
echo "driver diagnostic exit: $?"
rm -f /app/.verifier-drive.ts /app/.verifier-resolve.js

# The ledger the saves landed in has to still be the one this run started, and
# it has to still be answering to this run's token. If it is not, the run says
# nothing about the submission and must not be read as a verdict.
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    harness_fail "the held-out ledger went away while the saves were being replayed"
fi
if ! admin_answers; then
    harness_fail "the endpoint on port ${PORT} no longer answers to this run's admin token"
fi

# The ledger is the part of the verdict the submission cannot narrate: it is
# read from the emulator, not from anything the submission returned.
curl -s --max-time 20 -H "x-mockaws-admin-token: ${ADMIN_TOKEN}" \
    "http://127.0.0.1:${PORT}/_admin/snapshot" \
    | python3 -c 'import json,sys; json.dump((json.load(sys.stdin) or {}).get("influx") or {}, open(sys.argv[1], "w"))' \
    "$LEDGER" 2>/dev/null

kill "$(cat "$PIDFILE")" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null

if [ ! -s "$LEDGER" ]; then
    harness_fail "the held-out ledger could not be read back over the admin channel"
fi
if [ ! -s "$OBSERVED" ]; then
    harness_fail "the run recorded nothing at all, so there is no verdict to give"
fi

echo "=== Compute reward (root, no submitted code loaded) ==="
python3 "$TESTS_DIR/compute_reward.py" \
    --output-dir "$VERIFIER_DIR" \
    --scenario "$VERIFIER_DATA/holdout.json" \
    --spec "$VERIFIER_DATA/run-spec.json" \
    --observed "$OBSERVED" \
    --ledger "$LEDGER"

cp -a "$OBSERVED" "$VERIFIER_DIR/observed.json" 2>/dev/null
cp -a "$LEDGER" "$VERIFIER_DIR/ledger.json" 2>/dev/null
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
