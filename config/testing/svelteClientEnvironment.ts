import type { Environment } from "vitest/environments"

// Node globals, but Vite's "client" transform pipeline. Svelte rune modules (*.svelte.ts) are then compiled
// for the client, so $effect and friends run (the default node environment compiles them for the server,
// where effects never run). Select it through `test.environment` in a vitest project config
// (config/testing/vitest.config.ts); a per-file `@vitest-environment` docblock does not switch the transform.
const environment: Environment = {
    name: "svelte-client-node",
    transformMode: "web",
    viteEnvironment: "client",
    setup() {
        return { teardown() {} }
    }
}

export default environment
