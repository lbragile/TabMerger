// Maps demo-script.ts `step.action` names to real Playwright interactions
// against the built extension popup. Selectors confirmed against
// packages/extension/src/components/{Header,SidePanel,Windows}/*.tsx.
//
// Shared by record.ts and screenshots.ts so both drive identical UI state.
import type { Page } from "@playwright/test";

// ponytail: group/tab names hardcoded against demoData.ts seed content
// (Work/Research/Shopping/Reading List groups). If the seed data changes,
// update these strings too — no dynamic lookup, it's a fixed script.
const actions: Record<string, (page: Page) => Promise<void>> = {
    async openPopup(page) {
        // ponytail: a blind waitForTimeout let the recording's first frames
        // capture the popup mid-load (blank/white flash) — wait for real
        // content instead so the video segment starts once something is
        // actually on screen.
        await page.getByText("Now Open", { exact: true }).first().waitFor({ state: "visible" });
        await page.waitForTimeout(500);
    },

    async enableDarkMode(page) {
        await page.getByRole("button", { name: "Settings" }).click();
        await page.waitForTimeout(250);
        // ponytail: Radix SelectTrigger here has no accessible name (Label
        // is a visual sibling, not htmlFor-linked) — General tab is the
        // default active tab, and it's the only combobox on it.
        await page.getByRole("combobox").first().click();
        await page.waitForTimeout(250);
        await page.getByRole("option", { name: "Dark" }).click();
        await page.waitForTimeout(250);
        // ponytail: Escape on the nested Select popover doesn't propagate to
        // close the outer Dialog (Radix nested-portal behavior) — use the
        // Dialog's real close button (sr-only "Close" text) instead.
        // screenshots.ts reuses one page across all steps, so a left-open
        // dialog would block every later click.
        await page.getByRole("button", { name: "Close" }).click();
    },

    async viewGroups(page) {
        // ponytail: group name text can appear in both the sidebar row and
        // an active-group header — .first() is always the sidebar row.
        await page.getByText("Work", { exact: true }).first().click();
        await page.waitForTimeout(800);
        await page.getByText("Research", { exact: true }).first().click();
    },

    async dragTabBetweenGroups(page) {
        // ponytail: context-menu "Copy/Move to group" instead of raw
        // pointer-drag simulation — @dnd-kit drag needs precise intermediate
        // mousemoves to trigger sensors reliably; the menu is the same user
        // outcome and far less flaky to script.
        // Each step gets a fresh page (clean uiStore, activeGroupIndex
        // resets to 0/"Now Open" — not persisted), so activate "Work" first
        // rather than assume a prior step already did.
        await page.getByText("Work", { exact: true }).first().click();
        await page.waitForTimeout(250);
        // Actual seed title (demoData.ts): "Inbox (14) — user@example.com — Gmail"
        const tab = page.getByText("Gmail", { exact: false }).first();
        await tab.click({ button: "right" });
        await page.getByText(/move to group|copy to group/i).first().hover();
        // ponytail: Radix DropdownMenuSub re-renders the submenu item on
        // open (briefly detaching/reattaching) — small settle wait avoids a
        // race against that instead of retrying the click blindly.
        await page.waitForTimeout(300);
        await page.getByRole("menuitem", { name: "Research" }).click();
    },

    async renameGroup(page) {
        const groupName = page.getByText("Shopping", { exact: true }).first();
        await groupName.dblclick();
        // ponytail: firing keyboard.press("Control+a") and the first type()
        // keystroke back-to-back raced the rename input's just-mounted
        // select-all-on-focus behavior, sometimes eating the first character
        // ("Wishlist" -> "ishlist"). A short settle wait after the select-all
        // before typing fixed it.
        await page.keyboard.press("Control+a");
        await page.waitForTimeout(150);
        // ponytail: pressSequentially (not keyboard.type with no delay) so
        // the rename is visibly typed character-by-character in the recording.
        await page.keyboard.type("Wishlist", { delay: 110 });
        await page.waitForTimeout(200);
        await page.keyboard.press("Enter");
    },

    async tabPreview(page) {
        // Navigate to Work group so the seeded tabs are in view.
        await page.getByText("Work", { exact: true }).first().click();
        await page.waitForTimeout(300);
        // Hover over a seeded tab title to trigger TabPreview's 400ms Radix Tooltip.
        // Saved tabs have no live tabId so ogImage fetch returns null — the "No preview"
        // placeholder renders, which is the feature we want to show.
        // "Gmail" is a real title from demoData.ts's Work group.
        await page.getByText("Gmail", { exact: false }).first().hover();
        // 400ms Radix delay + render time; waitForTimeout does not move the mouse so
        // the hover persists and the tooltip stays visible in the recording.
        await page.waitForTimeout(1800);
    },

    async starWindow(page) {
        await page.getByText("Work", { exact: true }).first().click();
        await page.waitForTimeout(300);
        // ponytail: window cards are .bg-card; sidebar group items are not.
        // Clicking the star inside the first .bg-card targets the window-level star
        // (h-5 w-5 Button) rather than any sidebar group star (no explicit h/w class).
        await page.locator(".bg-card").first().locator("button:has(.lucide-star)").click();
        // Give the UI time to apply the group-color left border before the clip ends.
        await page.waitForTimeout(800);
    },

    async starGroup(page) {
        // ponytail: the pin/star button has no aria-label (only a Tooltip that
        // says "Pin group" / "Unpin group", not an a11y name) — target lucide-react's
        // rendered class on the Star <svg> instead. first() picks the sidebar's
        // first non-permanent group row (Now Open is permanent and has no star button,
        // so first() reliably lands on the first saved group).
        await page.locator("button:has(svg.lucide-star)").first().click();
    },

    async toggleSelectionMode(page) {
        // Fresh page defaults to "Now Open" (no seeded tabs) — activate a
        // seeded group first so there are tab checkboxes to select.
        await page.getByText("Work", { exact: true }).first().click();
        await page.waitForTimeout(300);
        await page.getByRole("button", { name: "Select items" }).click();
        await page.waitForTimeout(300);
        // ponytail: these are plain <button aria-label="Select tab"> with no
        // role="checkbox" override — accessible role is "button", not "checkbox".
        await page.getByRole("button", { name: "Select tab" }).first().click();
        await page.waitForTimeout(300);
        await page.getByRole("button", { name: "Select tab" }).nth(1).click();
    },

    async searchTabs(page) {
        // ponytail: demonstrate the `in:"Group"` scoped-search syntax (see
        // parseSearchQuery in lib/utils.ts, hinted at in the search
        // placeholder itself) rather than a bare keyword — "search" on its
        // own doesn't show that groups can be filtered. "react" is a real
        // match: demoData.ts's Research group has a tab titled
        // "React Docs — useEffect", so the query actually returns a result
        // instead of an empty list.
        await page.getByPlaceholder(/search/i).pressSequentially('in:"Research" react', { delay: 90 });
        await page.waitForTimeout(1200);
        await page.getByPlaceholder(/search/i).fill("");
    },

    async undoAction(page) {
        // Undo stack lives in uiStore (ephemeral, not persisted) — a fresh
        // page has nothing to undo, so the button starts disabled. Make one
        // undoable change first (star toggle), then undo it.
        // Star button is hidden while selectionMode is on (see toggleSelectionMode)
        // — screenshots.ts reuses one page across all steps, so exit selection
        // mode first rather than assume a fresh page state.
        const exitSelection = page.getByRole("button", { name: "Exit selection mode" });
        if (await exitSelection.isVisible().catch(() => false)) {
            await exitSelection.click();
            await page.waitForTimeout(250);
        }
        await page.locator("button:has(svg.lucide-star)").first().click();
        await page.waitForTimeout(400);
        await page.getByRole("button", { name: "Undo" }).click();
    },

    async changeGroupColor(page) {
        // ponytail: "Change color" was removed from the group's right-click
        // dropdown (product decision) — the only remaining entry point is
        // the small color-swatch dot rendered directly on the sidebar row
        // (SidePanel/GroupItem.tsx), which has no accessible name of its own.
        // Walk up from the group's name text to its row container (marked
        // with the Tailwind `group` class for group-hover) and click the
        // round swatch button inside it.
        const groupRow = page
            .getByText("Research", { exact: true })
            .first()
            .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
        await groupRow.locator("button.rounded-full").click();
        await page.waitForTimeout(300);
        // ponytail: preset swatches are plain <button title="rgba(...)">
        // with no accessible name/role override — index into the preset
        // grid rather than matching a specific color string.
        await page.locator('button[title^="rgba"]').nth(3).click();
    },

    async addGroupNote(page) {
        const group = page.getByText("Research", { exact: true }).first();
        await group.click();
        await page.waitForTimeout(250);
        await group.click({ button: "right" });
        await page.waitForTimeout(250);
        await page.getByText("Add/edit note", { exact: true }).click();
        const textarea = page.getByPlaceholder("Add a note to this group...");
        await textarea.waitFor({ state: "visible" });
        await textarea.pressSequentially("Flights booked — check visa docs before Friday", { delay: 35 });
        await page.waitForTimeout(300);
        await page.getByRole("button", { name: "Save" }).click();
    },

    async outro(page) {
        await page.waitForTimeout(1000);
    },
};

export async function runStepAction(page: Page, action: string, minDurationMs: number) {
    const handler = actions[action];
    const start = Date.now();
    if (handler) {
        await handler(page);
    }
    const elapsed = Date.now() - start;
    if (elapsed < minDurationMs) {
        await page.waitForTimeout(minDurationMs - elapsed);
    }
}
