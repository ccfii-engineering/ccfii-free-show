import { fileURLToPath } from "node:url"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vitest/config"

// Unit tests live alongside source as *.test.ts under src/.
// The Playwright e2e (config/testing/start.test.ts) is excluded: it uses @playwright/test.
// This config sits in config/testing/, so point the root back at the project root.
const root = fileURLToPath(new URL("../../", import.meta.url))

// Two projects: main-process code (src/electron) runs with node resolution like Electron's main process.
// Everything else (renderer, svelte runes, web servers) runs with browser conditions and the client environment.
export default defineConfig({
    root,
    test: {
        projects: [
            {
                root,
                test: {
                    name: "electron",
                    include: ["src/electron/**/*.test.ts"],
                    environment: "node"
                }
            },
            {
                root,
                // compiles *.svelte.ts rune modules; the client environment makes their effects run
                plugins: [svelte({ compilerOptions: { dev: true } })],
                resolve: { conditions: ["browser"] },
                test: {
                    name: "frontend",
                    include: ["src/frontend/**/*.test.ts", "src/server/**/*.test.ts", "src/common/**/*.test.ts", "scripts/tests/video-player*.test.ts"],
                    environment: "./config/testing/svelteClientEnvironment.ts",
                    // svelte must go through Vite so the client environment picks its client build (effects run)
                    server: { deps: { inline: [/node_modules\/svelte\//] } }
                }
            }
        ]
    }
})
