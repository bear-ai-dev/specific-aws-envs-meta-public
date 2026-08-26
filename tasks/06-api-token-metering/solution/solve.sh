#!/bin/bash
# Reference solution. Applies the oracle to the deliverable in place.
set -euo pipefail

APP_DIR="${1:-/app}"
PATCH="$(cd "$(dirname "$0")" && pwd)/solution.patch"

cd "$APP_DIR"
patch -p1 --forward --batch < "$PATCH"
echo "oracle applied"
