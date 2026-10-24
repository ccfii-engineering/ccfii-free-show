#!/usr/bin/env python3
"""Build a fresh Graphify graph from tracked source-code files only."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

from graphify.detect import detect
from networkx.readwrite import json_graph


def _tracked_paths(repo_root: pathlib.Path) -> set[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=repo_root, check=True, capture_output=True
    )
    return {
        path.decode("utf-8", errors="surrogateescape")
        for path in result.stdout.split(b"\0")
        if path
    }


def _tracked_code_sources(repo_root: pathlib.Path) -> list[tuple[pathlib.Path, str]]:
    tracked = _tracked_paths(repo_root)
    sources: dict[str, pathlib.Path] = {}
    for candidate in detect(repo_root)["files"]["code"]:
        source = pathlib.Path(candidate).resolve()
        try:
            relative = source.relative_to(repo_root).as_posix()
        except ValueError:
            continue
        if relative in tracked and source.is_file():
            sources[relative] = source
    return [(sources[name], name) for name in sorted(sources)]


def _source_fingerprint(sources: list[tuple[pathlib.Path, str]]) -> str:
    digest = hashlib.sha256()
    for path, relative in sources:
        digest.update(relative.encode("utf-8", errors="surrogateescape"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _graph_object(graph_data: dict[str, Any]):
    if "links" not in graph_data and "edges" in graph_data:
        graph_data = {**graph_data, "links": graph_data["edges"]}
    graph_data["directed"] = True
    try:
        return json_graph.node_link_graph(graph_data, edges="links")
    except TypeError:
        return json_graph.node_link_graph(graph_data)


def build_graph(repo_root: pathlib.Path, output_dir: pathlib.Path | None = None) -> dict[str, Any]:
    """Build and atomically publish a fresh graph, returning its metadata."""
    repo_root = repo_root.resolve()
    output_dir = (output_dir or repo_root / "graphify-out").resolve()
    sources = _tracked_code_sources(repo_root)
    source_sha256 = _source_fingerprint(sources)

    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = repo_root / ".cache" / "code-navigation"
    cache_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="graphify-source-", dir=cache_dir) as temp_name:
        stage_root = pathlib.Path(temp_name) / "source"
        for source, relative in sources:
            staged = stage_root / pathlib.Path(relative)
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, staged)

        if sources:
            subprocess.run(
                [sys.executable, "-m", "graphify", "update", str(stage_root), "--no-cluster"],
                cwd=repo_root,
                check=True,
            )
            candidate_path = stage_root / "graphify-out" / "graph.json"
            graph_bytes = candidate_path.read_bytes()
            graph_data = json.loads(graph_bytes)
        else:
            graph_data = {"nodes": [], "links": [], "directed": True, "hyperedges": []}
            graph_bytes = (json.dumps(graph_data, indent=2) + "\n").encode("utf-8")

    graph = _graph_object(graph_data)
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_root, check=True, capture_output=True, text=True
    ).stdout.strip()
    metadata = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "graphify_version": importlib.metadata.version("graphifyy"),
        "git_commit": commit,
        "tracked_code_file_count": len(sources),
        "source_sha256": source_sha256,
        "graph_sha256": hashlib.sha256(graph_bytes).hexdigest(),
        "graph_node_count": graph.number_of_nodes(),
        "graph_edge_count": graph.number_of_edges(),
        "graph_json_node_entry_count": len(graph_data.get("nodes", [])),
        "scope": "Fresh Graphify AST graph from tracked files classified as code; documents, media, ignored, and untracked files excluded",
    }

    token = uuid.uuid4().hex
    graph_tmp = output_dir / f".graph-{token}.tmp"
    metadata_tmp = output_dir / f".metadata-{token}.tmp"
    graph_path = output_dir / "graph.json"
    metadata_path = output_dir / "code-graph-metadata.json"
    try:
        graph_tmp.write_bytes(graph_bytes)
        metadata_tmp.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        os.replace(graph_tmp, graph_path)
        os.replace(metadata_tmp, metadata_path)
    finally:
        graph_tmp.unlink(missing_ok=True)
        metadata_tmp.unlink(missing_ok=True)

    print(
        f"Fresh Graphify graph: {metadata['tracked_code_file_count']} tracked code files, "
        f"{metadata['graph_node_count']} nodes, {metadata['graph_edge_count']} edges."
    )
    print(f"Source fingerprint: {metadata['source_sha256']}")
    return metadata


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: build_code_graph.py <repository-root>", file=sys.stderr)
        return 2
    build_graph(pathlib.Path(argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
