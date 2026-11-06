// Type-check with the TypeScript 7 native compiler (npm alias "typescript7").
// `typescript` (6.x) stays the tooling API for svelte-check, svelte-preprocess,
// eslint and rollup; its `tsc` bin is NOT used here. TS 7 ships no classic
// compiler API, so it is invoked by path instead of through node_modules/.bin.
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const TYPECHECK_CONFIGS = {
    electron: "config/typescript/tsconfig.electron.json",
    server: "config/typescript/tsconfig.server.json",
    frontend: "config/typescript/tsconfig.svelte.json"
}

export function resolveTypecheckCompiler() {
    return path.join(path.dirname(require.resolve("typescript7/package.json")), "bin", "tsc")
}

function run(names) {
    let status = 0
    for (const name of names) {
        const config = TYPECHECK_CONFIGS[name]
        if (!config) {
            console.error(`Unknown config "${name}". Use: ${Object.keys(TYPECHECK_CONFIGS).join(", ")}`)
            return 2
        }
        console.info(`> typecheck:${name} (TypeScript 7)`)
        const result = spawnSync(process.execPath, [resolveTypecheckCompiler(), "--noEmit", "-p", config], { cwd: root, stdio: "inherit" })
        if (result.status) status = result.status
    }
    return status
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const names = process.argv.slice(2)
    process.exit(run(names.length ? names : Object.keys(TYPECHECK_CONFIGS)))
}
