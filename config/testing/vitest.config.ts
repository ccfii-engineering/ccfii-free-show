import { fileURLToPath } from "node:url"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vitest/config"

// Unit tests live alongside source as *.test.ts under src/.
// The Playwright e2e (config/testing/start.test.ts) is excluded — it uses @playwright/test.
// This config sits in config/testing/, so point the root back at the project root.
export default defineConfig({
    // compiles *.svelte.ts rune modules. Tests that need working effects use ./svelteClientEnvironment.ts.
    plugins: [svelte({ compilerOptions: { dev: true } })],
    resolve: { conditions: ["browser"] },
    root: fileURLToPath(new URL("../../", import.meta.url)),
    test: {
        include: ["src/**/*.test.ts", "scripts/tests/video-player*.test.ts"],
        environment: "./config/testing/svelteClientEnvironment.ts",
        // svelte must go through Vite so the client environment picks its client build (effects run)
        server: { deps: { inline: [/node_modules\/svelte\//] } }
    }
})
