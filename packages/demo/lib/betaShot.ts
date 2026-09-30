// Small helpers shared by the beta-guide screenshot scripts that were added
// after beta-screenshots.ts (which keeps its own private copies so it stays
// untouched): raw-CDP mouse (headless `--headless=new` can't start this
// popup's native HTML5 drag through page.mouse.*), 1600x1200 webp capture via
// CDP `clip.scale`, and a "settle" that blurs focus + parks the pointer.
import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Locator, Page } from "@playwright/test";

export const BETA_OUT_DIR = path.resolve(__dirname, "../../web/public/beta");

export class CdpMouse {
    private x = 0;
    private y = 0;
    private pressed = false;
    constructor(private readonly cdp: CDPSession) {}
    async move(x: number, y: number) {
        this.x = x;
        this.y = y;
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
            button: this.pressed ? "left" : "none",
            buttons: this.pressed ? 1 : 0,
        });
    }
    async down() {
        this.pressed = true;
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: this.x,
            y: this.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
        });
    }
    async up() {
        await this.cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: this.x,
            y: this.y,
            button: "left",
            buttons: 0,
            clickCount: 1,
        });
        this.pressed = false;
    }
}

export async function boxCenter(locator: Locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("boxCenter: could not resolve bounding box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags source -> target and leaves the mouse DOWN over the target (mid-gesture).
 * Callers never release it: a drop would commit (mutating IndexedDB); reloading the page cancels the drag. */
export async function dragTo(page: Page, source: Locator, target: Locator, offsetY = 0, offsetX = 0) {
    const from = await boxCenter(source);
    const to = await boxCenter(target);
    const mouse = new CdpMouse(await page.context().newCDPSession(page));
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x, from.y - 10);
    await page.waitForTimeout(150);
    const STEPS = 12;
    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        await mouse.move(from.x + (to.x + offsetX - from.x) * t, from.y + (to.y + offsetY - from.y) * t);
        await page.waitForTimeout(30);
    }
    await page.waitForTimeout(350);
    return mouse;
}

export async function saveWebp(page: Page, name: string, quality = 92) {
    const file = path.join(BETA_OUT_DIR, name);
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality,
        clip: { x: 0, y: 0, width: 800, height: 600, scale: 2 },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`[beta-extra] saved ${name} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

export async function settle(page: Page) {
    await page.evaluate("document.activeElement && document.activeElement.blur()");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
}
