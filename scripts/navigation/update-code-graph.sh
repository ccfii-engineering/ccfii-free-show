#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
graphify_python="$repo_root/.cache/code-navigation/graphify-venv/bin/python"

if [[ ! -x "$graphify_python" ]]; then
    echo "Run scripts/navigation/setup-code-navigation.sh first." >&2
    exit 1
fi

exec "$graphify_python" "$repo_root/scripts/navigation/build_code_graph.py" "$repo_root"
