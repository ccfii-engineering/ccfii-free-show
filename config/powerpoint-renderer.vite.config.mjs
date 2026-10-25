import { defineConfig } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export default defineConfig({
    root: path.join(projectRoot, "src/powerpointRenderer"),
    base: "./",
    build: {
        target: "chrome138",
        outDir: path.join(projectRoot, "build/electron/powerpointRenderer/site"),
        emptyOutDir: true
    }
})
