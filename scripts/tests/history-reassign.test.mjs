import assert from "node:assert/strict"
import { test } from "node:test"
import { applyReassignUpdate } from "../../src/frontend/components/helpers/historyReassign.ts"

// Helper: build a fresh fixture so tests don't share state.
const fixture = () => ({
    "style-1": {
        name: "Main",
        background: { type: "color", value: "#000000" },
        layers: ["background", "slide"],
        lines: [
            { text: "A", style: "bold" },
            { text: "B", style: "italic" }
        ]
    },
    "style-2": {
        name: "Other"
    }
})

// ============================================================
// Branch: plain key replace (no subkey, no index, no indexes, no keys)
// ============================================================

test("plain key replace — produces new refs at store, [id], and no key change elsewhere", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "Renamed", { id: "style-1", key: "name" })

    assert.notEqual(after, before, "top-level store ref must change")
    assert.notEqual(after["style-1"], before["style-1"], "[id] ref must change")
    assert.equal(after["style-1"].name, "Renamed")
    // untouched siblings keep their refs (no unnecessary churn)
    assert.equal(after["style-2"], before["style-2"])
    // original unchanged
    assert.equal(before["style-1"].name, "Main")
})

// ============================================================
// Branch: subkey (nested object replace)
// ============================================================

test("subkey replace — new refs all the way down to [id][key]", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "#ffffff", { id: "style-1", key: "background", subkey: "value" })

    assert.notEqual(after, before)
    assert.notEqual(after["style-1"], before["style-1"])
    assert.notEqual(after["style-1"].background, before["style-1"].background)
    assert.equal(after["style-1"].background.value, "#ffffff")
    assert.equal(after["style-1"].background.type, "color", "other subkeys preserved")
    // original unchanged
    assert.equal(before["style-1"].background.value, "#000000")
})

test("subkey replace on missing key creates empty object", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "bar", { id: "style-1", key: "newKey", subkey: "foo" })

    assert.equal(after["style-1"].newKey.foo, "bar")
    assert.notEqual(after["style-1"], before["style-1"])
})

// ============================================================
// Branch: index splice into array under key
// ============================================================

test("index splice insert — array is cloned, parent refs new", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "overlay", { id: "style-1", key: "layers", index: 1 })

    assert.notEqual(after["style-1"].layers, before["style-1"].layers)
    assert.deepEqual(after["style-1"].layers, ["background", "overlay", "slide"])
    assert.deepEqual(before["style-1"].layers, ["background", "slide"], "original untouched")
    assert.notEqual(after["style-1"], before["style-1"])
})

test("index = -1 pushes to end", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "top", { id: "style-1", key: "layers", index: -1 })

    assert.deepEqual(after["style-1"].layers, ["background", "slide", "top"])
    assert.deepEqual(before["style-1"].layers, ["background", "slide"])
})

// ============================================================
// Branch: subkey + index (push into nested array)
// ============================================================

test("subkey + index splice into nested array", () => {
    const before = {
        "group-1": {
            nested: { items: ["a", "c"] }
        }
    }
    const after = applyReassignUpdate(before, "b", { id: "group-1", key: "nested", subkey: "items", index: 1 })

    assert.deepEqual(after["group-1"].nested.items, ["a", "b", "c"])
    assert.notEqual(after["group-1"].nested, before["group-1"].nested)
    assert.notEqual(after["group-1"].nested.items, before["group-1"].nested.items)
    assert.deepEqual(before["group-1"].nested.items, ["a", "c"], "original untouched")
})

// ============================================================
// Branch: indexes (replace at specific positions in array)
// ============================================================

test("indexes replace — map over array replacing only specified positions", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, { text: "A*", style: "bold" }, { id: "style-1", key: "lines", indexes: [0] })

    assert.notEqual(after["style-1"].lines, before["style-1"].lines)
    assert.deepEqual(after["style-1"].lines[0], { text: "A*", style: "bold" })
    assert.equal(after["style-1"].lines[1], before["style-1"].lines[1], "unchanged entries keep refs")
    // original untouched
    assert.deepEqual(before["style-1"].lines[0], { text: "A", style: "bold" })
})

test("indexes with subkey — only overwrite subkey on selected entries (new entry refs)", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "underline", { id: "style-1", key: "lines", indexes: [1], subkey: "style" })

    assert.equal(after["style-1"].lines[1].style, "underline")
    assert.equal(after["style-1"].lines[1].text, "B")
    assert.notEqual(after["style-1"].lines[1], before["style-1"].lines[1], "updated entry has new ref")
    assert.equal(after["style-1"].lines[0], before["style-1"].lines[0], "untouched entry keeps ref")
    // original untouched
    assert.equal(before["style-1"].lines[1].style, "italic")
})

test("indexes replace whole empty array when newValue is non-empty array and current array empty", () => {
    const before = { x: { key: [] } }
    const after = applyReassignUpdate(before, [1, 2, 3], { id: "x", key: "key", indexes: [0] })

    assert.deepEqual(after.x.key, [1, 2, 3])
    assert.notEqual(after.x, before.x)
})

// ============================================================
// Branch: missing id (no-op, returns same ref)
// ============================================================

test("missing id — returns same ref (no churn)", () => {
    const before = fixture()
    const after = applyReassignUpdate(before, "whatever", { id: "nonexistent", key: "name" })

    assert.equal(after, before)
})

// ============================================================
// Branch: top-level entry replace (no key at all)
// ============================================================

test("no key — replaces entire [id] entry", () => {
    const before = fixture()
    const newEntry = { name: "Brand New", background: { type: "image", value: "/x.png" } }
    const after = applyReassignUpdate(before, newEntry, { id: "style-1" })

    assert.notEqual(after, before)
    assert.equal(after["style-1"], newEntry)
    assert.equal(after["style-2"], before["style-2"])
})
