// Sidebar-row parsing and the sanity check for the AI auto-group result (record-tour-ai-sort.ts).
// The AI is nondeterministic (the dev mock is not, a real model is), so the recorder refuses a take
// whose groups would make a bad scene.

export interface AiSortRow {
    name: string;
    windows: number;
    tabs: number;
}

/** "GitHub 1◆3" style sidebar rows (name, window count, tab count) as {@link AiSortRow}s. */
export function parseRowCounts(rows: string[]): AiSortRow[] {
    return rows.flatMap((text) => {
        const m = /^(.*?)\s*(\d+)\D+(\d+)\s*$/.exec(text);
        return m ? [{ name: m[1].trim(), windows: Number(m[2]), tabs: Number(m[3]) }] : [];
    });
}

/** Problems with the groups the AI created (empty list = usable). */
export function checkAiGroups({ nowOpenTabs, created }: { nowOpenTabs: number; created: AiSortRow[] }): string[] {
    const problems: string[] = [];
    if (created.length < 2 || created.length > 6) problems.push(`${created.length} new groups (want 2 to 6)`);
    if (created.some((g) => !g.name.trim())) problems.push("a group has an empty name");
    const names = created.map((g) => g.name.toLowerCase());
    if (new Set(names).size !== names.length) problems.push("duplicate group names");
    const assigned = created.reduce((n, g) => n + g.tabs, 0);
    // The popup's own tab is not sent to the AI; allow one or two tabs to be left out.
    if (assigned < nowOpenTabs - 2) problems.push(`only ${assigned} of ${nowOpenTabs} open tabs were assigned`);
    return problems;
}
