#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
serena="$repo_root/.cache/code-navigation/serena-venv/bin/serena"

if [[ ! -x "$serena" || ! -f "$repo_root/.serena/project.yml" ]]; then
    echo "Run scripts/navigation/setup-code-navigation.sh first." >&2
    exit 1
fi

exec "$serena" start-mcp-server --project "$repo_root" --open-web-dashboard false
