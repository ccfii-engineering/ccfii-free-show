#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
graphify_python="$repo_root/.cache/code-navigation/graphify-venv/bin/python"
graph_path="$repo_root/graphify-out/graph.json"

if [[ ! -x "$graphify_python" || ! -f "$graph_path" ]]; then
    echo "Build the navigation tools and graph with scripts/navigation/setup-code-navigation.sh and scripts/navigation/update-code-graph.sh." >&2
    exit 1
fi

exec "$graphify_python" -m graphify.serve "$graph_path"
