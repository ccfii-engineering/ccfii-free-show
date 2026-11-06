import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { resolveTypecheckCompiler, TYPECHECK_CONFIGS } from "../typecheck.mjs"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("typecheck runner resolves the TypeScript 7 native compiler, not the TS 6 tooling package", () => {
    const compiler = resolveTypecheckCompiler()
    const result = spawnSync(process.execPath, [compiler, "--version"], { encoding: "utf8" })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Version 7\./)
})

test("tooling API package stays on TypeScript 6", () => {
    assert.match(require("typescript/package.json").version, /^6\./)
})

test("typecheck covers the electron, server and frontend configs", () => {
    assert.deepEqual(Object.keys(TYPECHECK_CONFIGS).sort(), ["electron", "frontend", "server"])
})

test("electron config type-checks cleanly with TypeScript 7", () => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/typecheck.mjs"), "electron"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("main-process emit scripts use the TypeScript 7 compiler", () => {
    const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts
    for (const name of ["build:electron:dev", "build:electron:dev:watch", "build:electron:prod:tsc"]) {
        assert.match(scripts[name], /node node_modules\/typescript7\/bin\/tsc /, name)
    }
})
