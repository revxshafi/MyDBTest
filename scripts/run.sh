#!/usr/bin/env bash
// entry point for Linux/macOS, finds node and execs index.js

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="2.0.0"
NODE_MIN=20

G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; D='\033[2m'; X='\033[0m'

ok()   { echo -e "  [${G}  OK  ${X}] $*"; }
fail() { echo -e "  [${R} FAIL ${X}] $*"; }
run()  { echo -e "  [${C}  >>  ${X}] $*"; }
warn() { echo -e "  [${Y} WARN ${X}] $*"; }
info() { echo -e "  [${D} INFO ${X}] $*"; }

if [[ "${1:-}" == "--version" || "${1:-}" == "-v" ]]; then
  echo "MyDBTest v${VERSION}"
  exit 0
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo ""
  echo -e "  ${C}MyDBTest  v${VERSION}${X}"
  echo ""
  echo "  Test your MongoDB, PostgreSQL, or Redis connection with a structured"
  echo "  suite of 10 database operations. No config files required."
  echo ""
  echo -e "  ${C}Usage${X}"
  echo "    ./scripts/run.sh [--help | -h]"
  echo "    ./scripts/run.sh [--version | -v]"
  echo "    ./scripts/run.sh [--update]"
  echo "    ./scripts/run.sh --json <mongodb|postgresql|redis> <url>"
  echo "    ./scripts/run.sh [--private-node | --system-node]"
  echo "    ./scripts/run.sh [--private-python | --system-python]"
  echo "    ./scripts/run.sh [--yes]"
  echo "    ./scripts/run.sh uninstall"
  echo ""
  echo -e "  ${C}Supports${X}"
  echo "    Databases   MongoDB, PostgreSQL, Redis"
  echo "    Languages   JavaScript (Node.js), Python"
  echo ""
  echo -e "  ${C}Requirements${X}"
  echo -e "    Node.js v${NODE_MIN}+   required"
  echo -e "    Python 3.8+    optional  ${D}(only needed for the Python test path)${X}"
  echo ""
  exit 0
fi

if [[ "${1:-}" == "--update" ]]; then
  if [ ! -d ".git" ]; then
    fail "--update only works inside a git checkout"
    exit 1
  fi
  run "pulling latest changes"
  if ! git pull --ff-only 2>/dev/null; then
    warn "could not fast-forward, you may have local changes blocking the update"
    info "check your internet connection and try again"
    exit 1
  fi
  ok "up to date"
  echo ""
  exit 0
fi

# read_json_runtime_path <json_file> <key>
# returns .key.path from runtime.json
# python3 handles pretty-printed json, sed fallback handles indent=2 format
_read_json_runtime_path() {
  local json_file="$1" key="$2"
  if command -v python3 &>/dev/null; then
    python3 - "$json_file" "$key" 2>/dev/null <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    entry = d.get(sys.argv[2], {})
    if isinstance(entry, dict):
        v = entry.get('path') or ''
        print(v)
except Exception:
    pass
PYEOF
    return
  fi
  // fallback: strip whitespace, pull path field
  tr -d '\n\r ' < "$json_file" \
    | grep -o "\"${key}\":{[^}]*}" \
    | grep -o '"path":"[^"]*"' \
    | sed 's/^"path":"//;s/"$//'
}

// 1. check for private runtime MyDBTest installed
RUNTIME_JSON="$HOME/.mydbtest/runtime.json"
NODE_BIN=""

if [ -f "$RUNTIME_JSON" ]; then
  PRIVATE_NODE_PATH="$(_read_json_runtime_path "$RUNTIME_JSON" node)"
  if [ -n "$PRIVATE_NODE_PATH" ] && [ -x "$PRIVATE_NODE_PATH" ]; then
    NODE_BIN="$PRIVATE_NODE_PATH"
    info "using private node runtime"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  if command -v node &>/dev/null; then
    NODE_BIN="node"
  else
    echo ""
    fail "node is not installed"
    info "run 'mydbtest --private-node' to install a private runtime"
    info "or visit https://nodejs.org to install it manually"
    echo ""
    exit 1
  fi
fi

// report system node (private already announced above)
if [ "$NODE_BIN" = "node" ]; then
  set +e
  NODE_MAJOR="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
  set -e
  NODE_MAJOR="${NODE_MAJOR:-0}"
  if [ "${NODE_MAJOR}" -ge "${NODE_MIN}" ]; then
    ok "node $(node -v) detected"
  else
    warn "node $(node -v) found  (v${NODE_MIN}+ required, runtime.js will handle upgrade)"
  fi
fi

if [ ! -d "node_modules" ]; then
  run "installing dependencies"
  NODE_DIR="$(dirname "$NODE_BIN")"
  NPM_BIN="$NODE_DIR/npm"
  set +e
  if [ -x "$NPM_BIN" ]; then
    "$NPM_BIN" install --silent 2>/dev/null || "$NPM_BIN" install 2>&1 | tail -5
  else
    npm install --silent 2>/dev/null || npm install 2>&1 | tail -5
  fi
  set -e
fi

if command -v python3 &>/dev/null; then
  set +e
  PY_VER="$(python3 --version 2>&1 | awk '{print $2}')"
  PY_MAJOR="$(echo "$PY_VER" | cut -d. -f1)"
  PY_MINOR="$(echo "$PY_VER" | cut -d. -f2)"
  set -e
  if [[ "${PY_MAJOR:-0}" -ge 3 && "${PY_MINOR:-0}" -ge 8 ]]; then
    info "python ${PY_VER} also available"
  else
    warn "python ${PY_VER} found — v3.8+ required for the python test path"
  fi
elif command -v python &>/dev/null; then
  PY_VER="$(python --version 2>&1 | awk '{print $2}')"
  info "python ${PY_VER} also available"
else
  if [ -f "$RUNTIME_JSON" ]; then
    PRIVATE_PYTHON_PATH="$(_read_json_runtime_path "$RUNTIME_JSON" python)"
    if [ -n "$PRIVATE_PYTHON_PATH" ] && [ -x "$PRIVATE_PYTHON_PATH" ]; then
      info "private python runtime available"
    else
      info "python 3 not found — python test path will be unavailable"
    fi
  else
    info "python 3 not found — python test path will be unavailable"
  fi
fi

echo ""
exec "$NODE_BIN" src/index.js "$@"
