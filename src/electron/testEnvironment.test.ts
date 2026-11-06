import { describe, expect, it } from "vitest"

// Main-process tests must resolve packages like the Electron main process does (node conditions), not like a browser.
// svelte ships a server build under the default condition and a client build under "browser": the server build's
// onMount is a no-op, the client build throws outside a component.
describe("main-process test environment", () => {
    it("resolves packages with node conditions, not browser conditions", async () => {
        const { onMount } = await import("svelte")
        expect(() => onMount(() => {})).not.toThrow()
    })
})
