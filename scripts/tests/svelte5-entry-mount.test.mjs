import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Svelte 5 components are no longer classes: `new App({ target })` throws at runtime.
// Entry points must use mount().
const entries = ["src/frontend/main.ts", "src/server/cam/main.ts", "src/server/controller/main.ts", "src/server/remote/main.ts", "src/server/output_stream/main.ts", "src/server/stage/main.ts"]

for (const entry of entries) {
    test(`${entry} mounts App with Svelte 5 mount()`, () => {
        const source = readFileSync(entry, "utf8")
        assert.match(source, /import \{ mount \} from "svelte"/)
        assert.match(source, /mount\(App, \{/)
        assert.doesNotMatch(source, /new App\(/)
    })
}
