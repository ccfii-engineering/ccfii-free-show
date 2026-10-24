#!/usr/bin/env python3
"""Regression coverage for fresh, code-only Graphify rebuilds."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from build_code_graph import build_graph


class BuildCodeGraphTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="code-graph-test-")
        self.root = pathlib.Path(self.temp.name)
        (self.root / "src").mkdir()
        (self.root / "docs").mkdir()
        (self.root / "src" / "sample.ts").write_text(
            "export function beforeRename() { return 1 }\n", encoding="utf-8"
        )
        (self.root / "docs" / "guide.md").write_text(
            "# beforeRename\n", encoding="utf-8"
        )
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "src/sample.ts", "docs/guide.md"], check=True)
        subprocess.run(
            [
                "git", "-C", str(self.root), "-c", "user.name=Graph Test",
                "-c", "user.email=graph-test@example.invalid", "commit", "-qm", "fixture",
            ],
            check=True,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _graph(self) -> dict:
        return json.loads((self.root / "graphify-out" / "graph.json").read_text(encoding="utf-8"))

    def _labels(self) -> set[str]:
        return {str(node.get("label", "")) for node in self._graph().get("nodes", [])}

    def test_refresh_removes_renamed_and_deleted_symbols_and_excludes_docs(self) -> None:
        first = build_graph(self.root)
        self.assertTrue(any("beforeRename" in label for label in self._labels()))
        self.assertFalse(any(str(node.get("source_file", "")).endswith(".md") for node in self._graph()["nodes"]))

        source = self.root / "src" / "sample.ts"
        source.write_text("export function afterRename() { return 2 }\n", encoding="utf-8")
        second = build_graph(self.root)
        labels = self._labels()
        self.assertFalse(any("beforeRename" in label for label in labels))
        self.assertTrue(any("afterRename" in label for label in labels))

        (self.root / "docs" / "guide.md").write_text(
            "# document-only-change with newDocMarker\n", encoding="utf-8"
        )
        third = build_graph(self.root)
        self.assertEqual(second["source_sha256"], third["source_sha256"])
        self.assertEqual(third["tracked_code_file_count"], 1)
        self.assertFalse(any("newDocMarker" in label for label in self._labels()))
        self.assertFalse(any(str(node.get("source_file", "")).endswith(".md") for node in self._graph()["nodes"]))

        source.unlink()
        fourth = build_graph(self.root)
        self.assertFalse(any("afterRename" in label for label in self._labels()))
        self.assertEqual(fourth["tracked_code_file_count"], 0)


if __name__ == "__main__":
    unittest.main()
