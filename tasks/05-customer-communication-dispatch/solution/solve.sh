#!/bin/bash
# Reference solution. Applied to a pristine /app it produces a submission the
# verifier scores at full reward. It restores the code that was taken out: the
# SES send wrapper, the processor that drafts a message from a published
# communication, and the module hook that puts the processor on the mail
# channel.
set -euo pipefail

APP_DIR="${1:-/app}"
HERE="$(cd "$(dirname "$0")" && pwd)"

cd "$APP_DIR"
patch -p1 --forward --batch < "$HERE/solution.patch"

echo "reference solution applied to $APP_DIR"
