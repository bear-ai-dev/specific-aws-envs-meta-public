#!/bin/bash
# Reference solution. Applied to a pristine /app it produces a submission the
# verifier scores at full reward.
set -euo pipefail

APP_DIR="${1:-/app}"
HERE="$(cd "$(dirname "$0")" && pwd)"

cd "$APP_DIR"
patch -p1 --forward --batch < "$HERE/solution.patch"

echo "reference solution applied to $APP_DIR"
