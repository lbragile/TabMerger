// Single source of truth for the walkthrough recording — consumed by both
// record.ts (drives Playwright) and remotion/Composition.tsx (captions/timing).
//
// Assumes the demo-mode seed data (packages/extension/src/lib/demoData.ts)
// has multiple groups of common everyday tabs — Work, Research, Shopping,
// Reading List — so "view-groups" et al. have something worth showing.
export interface DemoStep {
    id: string;
    caption: string;
    durationMs: number;
    action: string;
    // Pure on-screen-text scene — no extension recording, rendered as a
    // styled title card by Composition.tsx instead of an OffthreadVideo.
    // record.ts/screenshots.ts skip these (nothing to capture).
    textCard?: boolean;
}

export const demoScript: DemoStep[] = [
    // Dedicated hook scene — sets up the problem before any UI is shown,
    // per the "on-screen text gets its own scene" rule.
    {
        id: "hook",
        caption: "100 tabs open. Zero idea where anything is.",
        durationMs: 2200,
        action: "",
        textCard: true,
    },
    {
        id: "open-popup",
        caption: "One click. Every tab, right here.",
        durationMs: 2500,
        action: "openPopup",
    },
    // Order below is the core feature walkthrough, sequenced so each scene
    // starts from the state the previous one left behind (view groups ->
    // move a tab into one -> rename it -> star it -> bulk-select -> search
    // -> undo) — no unrelated setup detours in between.
    {
        id: "view-groups",
        caption: "Every project, its own space",
        durationMs: 3500,
        action: "viewGroups",
    },
    {
        id: "tab-preview",
        caption: "Hover any tab — see its preview without leaving the popup",
        durationMs: 3500,
        action: "tabPreview",
    },
    {
        id: "drag-reorder",
        caption: "One drag. Tab sorted.",
        durationMs: 4000,
        action: "dragTabBetweenGroups",
    },
    {
        id: "change-color",
        caption: "Color-code it to spot it at a glance",
        durationMs: 3200,
        action: "changeGroupColor",
    },
    {
        id: "star-window",
        caption: "Star a window — its border lights up in your group color",
        durationMs: 3000,
        action: "starWindow",
    },
    {
        id: "add-note",
        caption: "Leave yourself a note on any group",
        durationMs: 4000,
        action: "addGroupNote",
    },
    {
        id: "rename-group",
        caption: "Make it yours — rename anything",
        durationMs: 3500,
        action: "renameGroup",
    },
    {
        id: "star-group",
        caption: "Pin it. Floats right below Now Open.",
        durationMs: 3000,
        action: "starGroup",
    },
    {
        id: "selection-mode",
        caption: "Clean up dozens of tabs in one shot",
        durationMs: 4000,
        action: "toggleSelectionMode",
    },
    {
        id: "search",
        caption: 'Search inside one group — try in:"Research"',
        durationMs: 3200,
        action: "searchTabs",
    },
    {
        id: "undo",
        caption: "Oops? Ctrl+Z has your back",
        durationMs: 3000,
        action: "undoAction",
    },
    // Dark mode moved out of the feature walkthrough — it's a nice-to-have
    // flex, not part of the core "organize your tabs" story, so it no
    // longer interrupts that flow right after open-popup.
    {
        id: "dark-mode",
        caption: "Oh, and it comes in dark mode.",
        durationMs: 2800,
        action: "enableDarkMode",
    },
    {
        id: "outro",
        caption: "TabMerger — tab chaos, tamed. Free to start.",
        durationMs: 3000,
        action: "",
        textCard: true,
    },
];
