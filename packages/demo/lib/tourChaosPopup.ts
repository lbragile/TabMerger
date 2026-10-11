// Shared setup for the feature tour's popup recordings: the demo-mode popup
// showing exactly the three chaos windows (CHAOS_WINDOW_URLS) in "Now Open",
// the same state scene 2's footage shows. record-tour-window.ts uses this;
// record-tour.ts (scene 2's clip) has the original inline copy of the same
// steps and was deliberately left untouched when scene 3 was added.
import type { BrowserContext, Page } from "@playwright/test";
import { runStepAction } from "./actions";
import { CHAOS_WINDOW_URLS } from "./chaosWindows";
import { launchDemoContext } from "./launchDemoContext";

export interface PopupCard {
    x: number;
    y: number;
    width: number;
    height: number;
    texts: string[];
}

export interface ChaosPopup {
    context: BrowserContext;
    /** The popup page, settled on "Now Open" with three window cards. */
    page: Page;
    cards: PopupCard[];
}

const hostOf = (url: string) => new URL(url).host.replace(/^www\./, "");

/** Opens the chaos windows, clears the setup window, and returns a settled popup page; null if the popup never settles cleanly. */
export async function openChaosPopup(
    theme: "light" | "dark",
    deviceScaleFactor: number,
): Promise<ChaosPopup | null> {
    const { context, page: setupPage } = await launchDemoContext(undefined, deviceScaleFactor, theme);
    const popupUrl = setupPage.url();
    await runStepAction(setupPage, "chaosHook", 0);
    // The setup window still holds the demo seed tabs: close all but this page's own tab.
    await setupPage.evaluate(
        () =>
            new Promise<void>((resolve) => {
                chrome.tabs.getCurrent((self) => {
                    chrome.tabs.query({ windowId: self!.windowId }, (tabs) => {
                        chrome.tabs.remove(
                            tabs.map((t) => t.id!).filter((id) => id !== self!.id),
                            () => resolve(),
                        );
                    });
                });
            }),
    );
    const urls = await setupPage.evaluate(
        () =>
            new Promise<string[][]>((resolve) =>
                chrome.windows.getAll({ populate: true }, (ws) =>
                    resolve(
                        ws
                            .filter((w) => w.tabs?.some((t) => t.url?.startsWith("http")))
                            .map((w) => (w.tabs ?? []).map((t) => t.url ?? "")),
                    ),
                ),
            ),
    );
    // Slow sites set their <title> late: wait for every chaos tab to load with a real title.
    await setupPage
        .waitForFunction(
            () =>
                new Promise<boolean>((resolve) =>
                    chrome.tabs.query({}, (tabs) =>
                        resolve(
                            tabs
                                .filter((t) => t.url?.startsWith("http"))
                                .every(
                                    (t) =>
                                        t.status === "complete" &&
                                        !!t.title &&
                                        t.title.replace(/^www\./, "") !== new URL(t.url!).host.replace(/^www\./, ""),
                                ),
                        ),
                    ),
                ),
            undefined,
            { timeout: 25000, polling: 500 },
        )
        .catch(() => null);

    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(popupUrl);
    await page.getByText("Now Open", { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(1500);

    const measureCards = (): Promise<PopupCard[]> =>
        page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
                (el) => el.children.length === 0 && /^\d+ tabs?$/.test(el.textContent?.trim() ?? ""),
            );
            return labels.map((label) => {
                let el: HTMLElement | null = label;
                while (el && !(getComputedStyle(el).borderTopWidth !== "0px" && el.querySelectorAll("img, svg").length > 3)) {
                    el = el.parentElement;
                }
                const r = (el ?? label).getBoundingClientRect();
                const texts = Array.from((el ?? label).querySelectorAll<HTMLElement>("*"))
                    .filter((n) => n.children.length === 0 && (n.textContent ?? "").trim().length > 0)
                    .map((n) => (n.textContent ?? "").trim());
                return { x: r.x, y: r.y, width: r.width, height: r.height, texts };
            });
        });
    // A stale extra card, or a title that is only the host (read before the page set
    // its <title>), is cleared by a reload.
    const hostTitles = (cs: PopupCard[]) =>
        cs.flatMap((c, w) =>
            c.texts
                .slice(2)
                .filter((_, i) => i % 2 === 0)
                .filter((t, ti) => !!urls[w]?.[ti] && t === hostOf(urls[w][ti])),
        );
    let cards = await measureCards();
    for (let i = 0; i < 4 && (cards.length !== CHAOS_WINDOW_URLS.length || hostTitles(cards).length > 0); i++) {
        await page.reload();
        await page.getByText("Now Open", { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
        await page.waitForTimeout(3000);
        cards = await measureCards();
    }
    if (cards.length !== CHAOS_WINDOW_URLS.length || hostTitles(cards).length > 0) {
        await context.close().catch(() => null);
        return null;
    }
    return { context, page, cards };
}
