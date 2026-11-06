import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { areObjectsEqual, clone, getFileName, getItemText, removeExtension } from "./pureHelpers"

const readHelper = (file: string) => readFileSync(resolve(process.cwd(), "src/frontend/components/helpers", file), "utf8")

describe("pure helpers", () => {
    it("clone copies deeply and passes primitives through", () => {
        const source = { a: { b: 1 } }
        const copy = clone(source)
        expect(copy).toEqual(source)
        expect(copy.a).not.toBe(source.a)
        expect(clone(5)).toBe(5)
    })

    it("areObjectsEqual ignores key order", () => {
        expect(areObjectsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
        expect(areObjectsEqual({ a: 1 }, { a: 2 })).toBe(false)
    })

    it("getItemText joins the text values of every line", () => {
        const item: any = { lines: [{ text: [{ value: "Hel" }, { value: "lo" }] }, { text: [{ value: " you" }] }] }
        expect(getItemText(item)).toBe("Hello you")
        expect(getItemText(null)).toBe("")
    })

    it("removeExtension and getFileName handle both separators", () => {
        expect(removeExtension("song.final.mp4")).toBe("song.final")
        expect(removeExtension("plain")).toBe("plain")
        expect(getFileName("C:\\media\\a.png")).toBe("a.png")
        expect(getFileName("/media/a.png")).toBe("a.png")
    })

    it("the original helper files re-export from the shared module instead of defining copies", () => {
        const originals: [string, string[]][] = [
            ["array.ts", ["clone", "areObjectsEqual"]],
            ["media.ts", ["removeExtension", "getFileName"]],
            ["../edit/scripts/textStyle.ts", ["getItemText"]]
        ]
        for (const [file, names] of originals) {
            const source = readHelper(file)
            expect(source, file).toMatch(/from "[./]+(?:components\/helpers\/|helpers\/)?pureHelpers"/)
            for (const name of names) expect(source, `${file} ${name}`).not.toMatch(new RegExp(`^export function ${name}\\b`, "m"))
        }
    })

    it("has no store imports and the template module has no local copies", () => {
        const here = readHelper("pureHelpers.ts")
        expect(here).not.toMatch(/from "\.\.?\/(?!\.\.\/\.\.\/types)/)
        const template = readHelper("slideTemplateMerge.ts")
        expect(template).not.toMatch(/^function (clone|areObjectsEqual|getItemText|removeExtension|getFileName)\b/m)
    })
})
