"use client";

import { useState } from "react";
import { Star, Trash2, Plus } from "lucide-react";

interface DemoTab {
    title: string;
    url: string;
    initial: string;
    color: string;
}

interface DemoWindow {
    name: string;
    starred: boolean;
    tabs: DemoTab[];
}

interface DemoGroup {
    id: number;
    name: string;
    dotColor: string;
    permanent?: boolean;
    windows: DemoWindow[];
}

const INITIAL_GROUPS: DemoGroup[] = [
    {
        id: 0,
        name: "Now Open",
        dotColor: "#6B7280",
        permanent: true,
        windows: [
            {
                name: "Window 1",
                starred: false,
                tabs: [
                    { title: "Gmail — Inbox", url: "mail.google.com", initial: "G", color: "#EA4335" },
                    { title: "Google Calendar", url: "calendar.google.com", initial: "C", color: "#1A73E8" },
                    { title: "Slack — #general", url: "app.slack.com", initial: "S", color: "#4A154B" },
                ],
            },
        ],
    },
    {
        id: 1,
        name: "Work",
        dotColor: "#00B4CC",
        windows: [
            {
                name: "Main",
                starred: true,
                tabs: [
                    { title: "GitHub — Pull Requests", url: "github.com", initial: "G", color: "#24292F" },
                    { title: "Linear — Project Board", url: "linear.app", initial: "L", color: "#5E6AD2" },
                    { title: "Notion — Design Docs", url: "notion.so", initial: "N", color: "#000000" },
                ],
            },
        ],
    },
    {
        id: 2,
        name: "Research",
        dotColor: "#6366F1",
        windows: [
            {
                name: "Docs",
                starred: false,
                tabs: [
                    { title: "MDN — CSS Grid Guide", url: "developer.mozilla.org", initial: "M", color: "#E66000" },
                    { title: "Stack Overflow", url: "stackoverflow.com", initial: "S", color: "#F48024" },
                ],
            },
        ],
    },
];

const PALETTE = ["#00B4CC", "#F5921E", "#8B5CF6", "#EF4444", "#10B981", "#F59E0B", "#3B82F6"];
// ponytail: module-level counter is fine — this is a demo widget, not a data store
let nextId = 100;

function groupTabCount(g: DemoGroup) {
    return g.windows.reduce((acc, w) => acc + w.tabs.length, 0);
}

export function DemoSection() {
    const [groups, setGroups] = useState<DemoGroup[]>(INITIAL_GROUPS);
    const [activeGroupId, setActiveGroupId] = useState<number>(1);

    const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];

    function deleteTab(groupId: number, winIdx: number, tabIdx: number) {
        setGroups((prev) =>
            prev.flatMap((g) => {
                if (g.id !== groupId) return [g];
                const newWindows = g.windows
                    .map((w, wi) => wi !== winIdx ? w : { ...w, tabs: w.tabs.filter((_, ti) => ti !== tabIdx) })
                    .filter((w) => w.tabs.length > 0 || g.windows.length === 1);
                // remove group entirely if non-permanent and no windows left
                if (!g.permanent && newWindows.every((w) => w.tabs.length === 0)) return [];
                return [{ ...g, windows: newWindows }];
            }),
        );
    }

    function toggleWindowStar(groupId: number, winIdx: number) {
        setGroups((prev) =>
            prev.map((g) =>
                g.id !== groupId ? g : {
                    ...g,
                    windows: g.windows.map((w, wi) => wi !== winIdx ? w : { ...w, starred: !w.starred }),
                },
            ),
        );
    }

    function deleteWindow(groupId: number, winIdx: number) {
        setGroups((prev) =>
            prev.map((g) =>
                g.id !== groupId ? g : { ...g, windows: g.windows.filter((_, wi) => wi !== winIdx) },
            ),
        );
        // if active group now has no windows, clear (shouldn't normally happen)
    }

    function addGroup() {
        const color = PALETTE[groups.length % PALETTE.length];
        const id = nextId++;
        setGroups((prev) => [
            ...prev,
            { id, name: "New Group", dotColor: color, windows: [{ name: "Window 1", starred: false, tabs: [] }] },
        ]);
        setActiveGroupId(id);
    }

    return (
        <section className="py-16">
            <div className="container">
                <div className="text-center mb-8">
                    <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                        Interactive preview
                    </p>
                    <h2 className="text-2xl font-bold">
                        <span
                            className="bg-clip-text text-transparent"
                            style={{ backgroundImage: "linear-gradient(90deg, #00B4CC, #F5921E)" }}
                        >
                            Try it yourself
                        </span>{" "}
                        <span className="text-foreground">→</span>
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Click a group, delete tabs with ×, star windows, or add a new group.
                    </p>
                </div>

                {/* Scale wrapper — popup is 780×600, scaled to 75% = 585×450 */}
                <div className="overflow-hidden mx-auto rounded-xl shadow-2xl" style={{ width: 585, height: 450 }}>
                    <div className="origin-top-left scale-75 flex flex-col overflow-hidden" style={{ width: 780, height: 600 }}>
                        {/* macOS window chrome — matches real extension header zone */}
                        <div className="flex items-center gap-1.5 px-3 py-2.5 flex-shrink-0" style={{ background: 'hsl(240,5%,97%)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                            <span className="w-3 h-3 rounded-full bg-red-400" />
                            <span className="w-3 h-3 rounded-full bg-yellow-400" />
                            <span className="w-3 h-3 rounded-full bg-green-400" />
                            <span className="flex-1 text-center text-xs font-medium" style={{ color: '#9CA3AF' }}>TabMerger</span>
                        </div>

                        {/* Popup body */}
                        <div className="flex flex-1 min-h-0">
                            {/* Sidebar — 210px, bg-zone-sidebar */}
                            <aside className="flex flex-col flex-shrink-0" style={{ width: 210, background: 'hsl(240,5%,97%)', borderRight: '1px solid rgba(0,0,0,0.08)' }}>
                                {/* Sidebar header */}
                                <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                                    <span className="flex-1 text-xs font-semibold uppercase tracking-widest" style={{ color: '#6B7280' }}>Groups</span>
                                    <button
                                        type="button"
                                        onClick={addGroup}
                                        title="Add group"
                                        className="h-6 w-6 flex items-center justify-center rounded transition-colors"
                                        style={{ color: '#6B7280' }}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                    </button>
                                </div>

                                {/* Group list */}
                                <nav className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
                                    {groups.map((group) => {
                                        const isActive = group.id === activeGroupId;
                                        return (
                                            <button
                                                key={group.id}
                                                type="button"
                                                onClick={() => setActiveGroupId(group.id)}
                                                className="relative w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors"
                                                style={{
                                                    background: isActive ? 'rgba(255,255,255,0.9)' : 'transparent',
                                                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : undefined,
                                                }}
                                                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; }}
                                                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                            >
                                                {isActive && (
                                                    <span
                                                        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                                                        style={{ background: group.dotColor }}
                                                    />
                                                )}
                                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: group.dotColor }} />
                                                <span className="flex-1 truncate text-xs font-medium" style={{ color: isActive ? '#111827' : '#374151' }}>
                                                    {group.name}
                                                </span>
                                                <span className="text-xs rounded-full px-1.5 flex-shrink-0" style={{ background: 'rgba(0,0,0,0.07)', color: '#6B7280' }}>
                                                    {groupTabCount(group)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </nav>
                            </aside>

                            {/* Windows panel — bg-background (white) */}
                            <main className="flex-1 flex flex-col min-w-0 bg-white">
                                {/* Panel toolbar */}
                                <div className="flex items-center px-3 py-1.5 flex-shrink-0" style={{ background: 'hsl(240,5%,97%)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                                    <span className="text-xs flex-1" style={{ color: '#9CA3AF' }}>
                                        {activeGroup.windows.length} {activeGroup.windows.length === 1 ? "window" : "windows"}
                                    </span>
                                </div>

                                <div className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-2">
                                    {activeGroup.windows.map((win, wi) => (
                                        <div
                                            key={wi}
                                            className="group/win rounded-lg overflow-hidden"
                                            style={{
                                                border: win.starred ? `2px solid ${activeGroup.dotColor}` : '1px solid rgba(0,0,0,0.1)',
                                                background: '#fff',
                                            }}
                                        >
                                            {/* Window header */}
                                            <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: 'hsl(240,5%,97%)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleWindowStar(activeGroup.id, wi)}
                                                    className="flex-shrink-0 transition-colors"
                                                    title={win.starred ? "Unstar window" : "Star window"}
                                                >
                                                    <Star
                                                        className="h-3.5 w-3.5"
                                                        fill={win.starred ? activeGroup.dotColor : "none"}
                                                        style={{ color: win.starred ? activeGroup.dotColor : '#8B919A' }}
                                                    />
                                                </button>
                                                <span className="flex-1 text-xs font-medium" style={{ color: '#374151' }}>{win.name}</span>
                                                <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                                                    {win.tabs.length} {win.tabs.length === 1 ? "tab" : "tabs"}
                                                </span>
                                                {activeGroup.windows.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteWindow(activeGroup.id, wi)}
                                                        className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/win:opacity-100 transition-all hover:bg-red-50"
                                                        style={{ color: '#9CA3AF' }}
                                                        title="Remove window"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Tab list */}
                                            <div className="px-1 py-0.5">
                                                {win.tabs.length === 0 && (
                                                    <p className="text-[10px] px-2 py-1.5" style={{ color: '#D1D5DB' }}>No tabs</p>
                                                )}
                                                {win.tabs.map((tab, ti) => (
                                                    <div
                                                        key={ti}
                                                        className="group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-gray-50"
                                                    >
                                                        <span
                                                            className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0"
                                                            style={{ background: tab.color }}
                                                        >
                                                            {tab.initial}
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs truncate leading-tight" style={{ color: '#111827' }}>{tab.title}</p>
                                                            <p className="text-[10px] truncate leading-tight" style={{ color: '#9CA3AF' }}>{tab.url}</p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); deleteTab(activeGroup.id, wi, ti); }}
                                                            className="opacity-0 group-hover:opacity-100 ml-auto transition-all text-sm leading-none flex-shrink-0 px-0.5 hover:text-red-500"
                                                            style={{ color: '#9CA3AF' }}
                                                            title="Close tab"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </main>
                        </div>
                    </div>
                </div>

                <p className="text-center text-xs text-muted-foreground mt-4">
                    Click × to remove a tab, ★ to star a window, + to add a group.
                </p>
            </div>
        </section>
    );
}
