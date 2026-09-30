// ILLUSTRATION (not a real capture): Chrome's native context menu is not part
// of the page, so it can't be screenshotted headless. This renders an HTML/CSS
// mock of Chrome's light context menu over a real page screenshot, using the
// exact titles/nesting built by packages/extension/src/entrypoints/background.ts
// (_buildMenus): "Save to TabMerger" > 4 scopes > one entry per non-permanent,
// non-archived group titled `${emoji} ${name} (${windows}w · ${tabs}t)`.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { BETA_OUT_DIR } from "./lib/betaShot";

const GROUPS = [
    { emoji: "🟣", name: "Work", w: 1, t: 5 },
    { emoji: "🔵", name: "Research", w: 1, t: 4 },
    { emoji: "🟢", name: "Shopping", w: 1, t: 3 },
    { emoji: "🟠", name: "Reading List", w: 1, t: 5 },
];
// A group created via "Add Group" with the default gray colour is empty, and gray is not in COLOR_EMOJI -> white circle.
const NEW_GROUP = { emoji: "⚪", name: "Trip planning", w: 0, t: 0 };
const SCOPES = ["Save this tab", "Save tabs to the left", "Save tabs to the right", "Save all other tabs"];
const W = 1000;
const H = 750;

const CSS = `
.cm{position:fixed;z-index:2147483647;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:8px;padding:4px 0;
 box-shadow:0 4px 14px rgba(0,0,0,.22),0 0 2px rgba(0,0,0,.18);font:13px/1 "Segoe UI",system-ui,sans-serif;color:#1f1f1f;min-width:210px}
.cm .it{display:flex;align-items:center;height:30px;padding:0 14px 0 32px;margin:0 4px;border-radius:4px;white-space:nowrap;gap:24px;position:relative}
.cm .it .sc{margin-left:auto;color:#5f6368;font-size:12px;padding-left:28px}
.cm .it.dis{color:#9aa0a6}
.cm .it.hl{background:#e8eaed}
.cm .it .ar{margin-left:auto;color:#5f6368}
.cm .it img{position:absolute;left:9px;width:16px;height:16px}
.cm hr{border:0;border-top:1px solid #dadce0;margin:4px 0}
.cur{position:fixed;z-index:2147483647;width:20px;height:20px}
`;

function item(label: string, opts: { sc?: string; dis?: boolean; hl?: boolean; arrow?: boolean; icon?: string } = {}) {
    return `<div class="it${opts.dis ? " dis" : ""}${opts.hl ? " hl" : ""}">${opts.icon ? `<img src="${opts.icon}">` : ""}<span>${label}</span>${
        opts.sc ? `<span class="sc">${opts.sc}</span>` : ""
    }${opts.arrow ? `<span class="ar">&#9656;</span>` : ""}</div>`;
}

async function render(page: Page, file: string, groups: typeof GROUPS) {
    const icon = "data:image/png;base64," + fs.readFileSync(path.resolve(__dirname, ".pw-ext-dev/icon/16.png")).toString("base64");
    const main = [
        item("Back", { sc: "Alt+Left Arrow", dis: true }),
        item("Forward", { sc: "Alt+Right Arrow", dis: true }),
        item("Reload", { sc: "Ctrl+R" }),
        "<hr>",
        item("Save as...", { sc: "Ctrl+S" }),
        item("Print...", { sc: "Ctrl+P" }),
        item("Cast..."),
        item("Search with Google Lens"),
        "<hr>",
        item("Save to TabMerger", { hl: true, arrow: true, icon }),
        "<hr>",
        item("View page source", { sc: "Ctrl+U" }),
        item("Inspect"),
    ].join("");
    const scopes = SCOPES.map((s, i) => item(s, { hl: i === 0, arrow: true })).join("");
    const list = groups.map((g) => item(`${g.emoji} ${g.name} (${g.w}w · ${g.t}t)`)).join("");
    // Plain string script: tsx injects __name helpers that don't exist in the page.
    const script = `(() => {
      const [css, main, scopes, list] = ${JSON.stringify([CSS, main, scopes, list])};
      document.getElementById("cm-root")?.remove();
      const root = document.createElement("div");
      root.id = "cm-root";
      root.innerHTML = '<style>' + css + '</style><div class="cm" id="m1">' + main + '</div><div class="cm" id="m2">' + scopes + '</div><div class="cm" id="m3">' + list + '</div>' +
        '<svg class="cur" id="cur" viewBox="0 0 20 20"><path d="M2 1l0 15 4-4 3 7 3-1-3-7 6 0z" fill="#000" stroke="#fff" stroke-width="1.2"/></svg>';
      document.body.appendChild(root);
      const m1 = document.getElementById("m1");
      m1.style.left = "70px"; m1.style.top = "110px";
      const row = (m, i) => m.querySelectorAll(".it")[i];
      const r1 = row(m1, 9).getBoundingClientRect();
      const m2 = document.getElementById("m2");
      m2.style.left = (m1.getBoundingClientRect().right - 2) + "px"; m2.style.top = (r1.top - 5) + "px";
      const r2 = row(m2, 0).getBoundingClientRect();
      const m3 = document.getElementById("m3");
      m3.style.left = (m2.getBoundingClientRect().right - 2) + "px"; m3.style.top = (r2.top - 5) + "px";
      const cur = document.getElementById("cur");
      cur.style.left = (m2.getBoundingClientRect().left + 235) + "px"; cur.style.top = (r2.top + 12) + "px";
    })()`;
    await page.evaluate(script);
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: 92,
        clip: { x: 0, y: 0, width: W, height: H, scale: 1600 / W },
    });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`saved ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "light" });
    const page = await ctx.newPage();
    const ok = await page.goto("https://example.com", { waitUntil: "load", timeout: 10000 }).then(() => true).catch(() => false);
    console.log("example.com reachable:", ok);
    if (!ok) throw new Error("example.com unreachable");
    await render(page, path.join(BETA_OUT_DIR, "context-menu.webp"), GROUPS);
    await render(page, path.join(BETA_OUT_DIR, "context-menu-new-group.webp"), [...GROUPS, NEW_GROUP]);
    await browser.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
