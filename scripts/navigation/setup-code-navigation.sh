#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="$repo_root/.cache/code-navigation"
graphify_env="$runtime_dir/graphify-venv"
serena_env="$runtime_dir/serena-venv"

command -v uv >/dev/null 2>&1 || {
    echo "uv is required; see https://docs.astral.sh/uv/" >&2
    exit 1
}

mkdir -p "$runtime_dir"
if [[ ! -x "$graphify_env/bin/python" ]]; then
    uv venv --python 3.13 "$graphify_env"
fi
uv pip install --python "$graphify_env/bin/python" 'graphifyy[mcp]==0.8.31'
# Graphify 0.8.31 imports mcp.types.AnyUrl, which is absent from MCP SDK 2.x.
uv pip install --python "$graphify_env/bin/python" 'mcp==1.30.0'
if [[ ! -x "$serena_env/bin/python" ]]; then
    uv venv --python 3.13 "$serena_env"
fi
uv pip install --python "$serena_env/bin/python" 'serena-agent==2.1.0'

if [[ ! -f "$repo_root/.serena/project.yml" ]]; then
    "$serena_env/bin/serena" project create "$repo_root" \
        --name ccfii-free-show --ls svelte --ls typescript
fi

if [[ ! -f "$repo_root/.serena/memories/memory_maintenance.md" ]]; then
    "$serena_env/bin/serena" memories initialize "$repo_root"
fi

echo "Code navigation runtimes are ready. Run scripts/navigation/update-code-graph.sh to build the Graphify index."
