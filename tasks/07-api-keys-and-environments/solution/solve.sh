#!/bin/bash
# Reference solution: apply the recorded patch to a pristine workspace.
set -euo pipefail

APP_DIR="${1:-/app}"
PATCH="$(cd "$(dirname "$0")" && pwd)/solution.patch"

cd "$APP_DIR"
patch -p1 --forward --no-backup-if-mismatch < "$PATCH"
echo "reference solution applied to $APP_DIR"
