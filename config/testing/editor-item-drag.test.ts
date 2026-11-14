import { expect, test } from "@playwright/test"
import { _electron as electron, type Page } from "playwright"
import tmp from "tmp"
import { delay, findMainWindow, finishFirstRun, launchArgs, seedWindowConfig } from "./electronTestHelpers"

// Dragging an item handle must follow the pointer for the whole drag, not stop after the first mousemove.
// Regression: the editors applied Snaplines' newStyles from a `$:` block that did not read newStyles,
// so Svelte 5 legacy mode only reran it on selection changes and a 200px drag moved the box ~20px.

type Box = { x: number; y: number; w: number; h: number }

let itemSelector = ".editArea .slide .item"

async function itemBox(page: Page): Promise<Box> {
    return page.evaluate((selector) => {
        const rect = (document.querySelector(selector) as HTMLElement).getBoundingClientRect()
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    }, itemSelector)
}

async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number, modifier?: string) {
    if (modifier) await page.keyboard.down(modifier)
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++) {
        await page.mouse.move(x + (dx * step) / 10, y + (dy * step) / 10)
        await delay(30)
    }
    await page.mouse.up()
    if (modifier) await page.keyboard.up(modifier)
    await delay(400)
}

async function handleCenter(page: Page, selector: string, along = 0.5) {
    const box = await page.locator(itemSelector).first().locator(selector).first().boundingBox()
    if (!box) throw new Error(`Handle ${selector} is not visible`)
    return { x: box.x + box.width * along, y: box.y + box.height * along }
}

async function expectDragFollowsPointer(page: Page) {
    await page
        .locator(itemSelector)
        .first()
        .click({ position: { x: 5, y: 5 } })
    await delay(300)

    // resize from the south-east corner: size changes by the full pointer distance
    let before = await itemBox(page)
    let handle = await handleCenter(page, ".square.se")
    await dragFrom(page, handle.x, handle.y, -200, -100)
    let after = await itemBox(page)
    expect(after.w - before.w).toBeCloseTo(-200, -1)
    expect(after.h - before.h).toBeCloseTo(-100, -1)
    expect(after.x - before.x).toBeCloseTo(0, 0)

    // resize from the north-west corner: the opposite corner stays put
    before = after
    handle = await handleCenter(page, ".square.nw")
    await dragFrom(page, handle.x, handle.y, 60, 40)
    after = await itemBox(page)
    expect(after.x - before.x).toBeCloseTo(60, -1)
    expect(after.w - before.w).toBeCloseTo(-60, -1)
    expect(after.x + after.w).toBeCloseTo(before.x + before.w, 0)

    // move by Ctrl-dragging the item body: position changes by the full pointer distance
    before = after
    await dragFrom(page, before.x + before.w / 2, before.y + before.h / 2, -40, 30, "Control")
    after = await itemBox(page)
    expect(after.x - before.x).toBeCloseTo(-40, -1)
    expect(after.y - before.y).toBeCloseTo(30, -1)
    expect(after.w).toBeCloseTo(before.w, 0)
}

test("editor item handles follow the pointer in the slide, template, overlay and stage editors", async () => {
    test.setTimeout(180_000)
    const userData = tmp.dirSync({ unsafeCleanup: true })
    const dataFolder = tmp.dirSync({ unsafeCleanup: true })
    seedWindowConfig(userData.name)
    const app = await electron.launch({ args: launchArgs(userData.name), env: { ...process.env, NODE_ENV: "production" } })
    try {
        await app.evaluate(({ dialog }, folder) => {
            dialog.showOpenDialogSync = () => [folder]
        }, dataFolder.name)
        const page = await findMainWindow(app)
        await finishFirstRun(page)

        await page.getByText("New project").first().click()
        await page.getByText("New show").first().click()
        await page.locator("#name").fill("Drag Test")
        await page.getByText("Quick Lyrics").click()
        await page.getByPlaceholder("[Verse]").fill("[Verse 1]\nLine one\nLine two")
        await page.getByTestId("create.show.popup.new.show").click()
        await delay(1000)

        await page.locator(".top").getByText("Edit", { exact: true }).first().click()
        await page.locator(".editArea .slide .item").first().waitFor()
        await expectDragFollowsPointer(page)

        // template editor: create an editable template (the default ones are protected)
        await page.getByText("Templates", { exact: true }).last().click()
        await page.getByText("New template", { exact: true }).first().click()
        await delay(500)
        // the new template is the only one outside the protected default categories
        await page.getByText("Unlabeled", { exact: true }).first().click()
        await delay(300)
        await page.locator(".drawer .card").first().click({ button: "right" })
        await page.locator(".contextMenu").getByText("Edit", { exact: true }).first().click()
        // a new template is empty: double-clicking the add button inserts a textbox
        await page.locator(".addButton").first().dblclick()
        await page.locator(".editArea .slide .item").first().waitFor()
        await expectDragFollowsPointer(page)

        // overlay editor: create an overlay and give it a textbox
        await page.getByText("Overlays", { exact: true }).last().click()
        await page.getByText("New overlay", { exact: true }).first().click()
        await delay(500)
        await page.getByText("Unlabeled", { exact: true }).first().click()
        await delay(300)
        await page.locator(".drawer .card").first().click({ button: "right" })
        await page.locator(".contextMenu").getByText("Edit", { exact: true }).first().click()
        await page.locator(".addButton").first().dblclick()
        await page.locator(".editArea .slide .item").first().waitFor()
        await expectDragFollowsPointer(page)

        // stage layout editor: the built-in Default layout has items
        await page.locator(".top").getByText("Stage", { exact: true }).first().click()
        await page.getByText("Default", { exact: true }).first().click()
        await delay(500)
        itemSelector = ".stageArea .slide .stage_item"
        await page.locator(itemSelector).first().waitFor()
        await expectDragFollowsPointer(page)

        // moving two selected stage items keeps their distance apart (they used to stack on one spot)
        const stageItems = page.locator(itemSelector)
        const boxes = async () =>
            page.evaluate(
                (selector) =>
                    Array.from(document.querySelectorAll(selector))
                        .slice(0, 2)
                        .map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
                itemSelector
            )
        await stageItems.nth(0).click({ position: { x: 5, y: 5 } })
        await page.keyboard.down("Shift")
        await stageItems.nth(1).click({ position: { x: 5, y: 5 } })
        await page.keyboard.up("Shift")
        const [firstBefore, secondBefore] = await boxes()
        const line = await handleCenter(page, ".line.wl", 0.25)
        await dragFrom(page, line.x, line.y, 30, 20, "Shift")
        const [firstAfter, secondAfter] = await boxes()
        expect(firstAfter.x - firstBefore.x).toBeCloseTo(30, -1)
        expect(secondAfter.x - secondBefore.x).toBeCloseTo(firstAfter.x - firstBefore.x, 0)
        expect(secondAfter.y - secondBefore.y).toBeCloseTo(firstAfter.y - firstBefore.y, 0)
    } finally {
        await app.close()
    }
})
