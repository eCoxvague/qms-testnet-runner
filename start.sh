#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22+ from https://nodejs.org first.' >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo 'Node.js 22 or newer is required.' >&2
  exit 1
fi
npm ci --no-fund
node scripts/start.mjs "$@"
