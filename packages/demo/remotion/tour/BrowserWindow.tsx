import React from "react";
import { Img, staticFile } from "remotion";
import type { ChaosTab } from "../../lib/chaosWindows";

// A drawn Chrome window for the feature tour: tab strip, toolbar with address
// bar, and a page screenshot. Playwright's recordVideo can't capture a
// browser's own frame, so the tour draws it (no real window is recorded).
// Fully prop-driven so later scenes can animate it: `tabs`/`tabProgress` for
// tabs piling in or closing (scene 4), `appear` for the whole window arriving
// (scene 8).

export type TourTheme = "light" | "dark";

const PALETTE = {
    dark: {
        frame: "#202124",
        active: "#35363a",
        toolbar: "#35363a",
        omnibox: "#202124",
        text: "#e8eaed",
        muted: "#9aa0a6",
        divider: "rgba(255,255,255,0.18)",
        page: "#202124",
        shadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
    },
    light: {
        frame: "#dee1e6",
        active: "#ffffff",
        toolbar: "#ffffff",
        omnibox: "#f1f3f4",
        text: "#202124",
        muted: "#5f6368",
        divider: "rgba(0,0,0,0.2)",
        page: "#ffffff",
        shadow: "0 30px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.12)",
    },
} as const;

export const TAB_STRIP_HEIGHT = 50;
export const TOOLBAR_HEIGHT = 56;
const TOOLBAR_ICON_SIZE = 36;
const TOOLBAR_PAD_X = 18;
/** Centre of the extension button, in window pixels (before any scale), for a window of `width`. */
export const toolbarIconCenter = (width: number) => ({
    x: width - TOOLBAR_PAD_X - TOOLBAR_ICON_SIZE / 2,
    y: TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT / 2,
});
const TAB_HEIGHT = 40;
const TAB_MAX_WIDTH = 260;
const TAB_MIN_WIDTH = 40;
// Room reserved right of the tabs: new-tab button + min/max/close controls.
const STRIP_LEFT_PAD = 14;
const STRIP_RIGHT_RESERVED = 190;
const FONT = '"Segoe UI", Roboto, system-ui, sans-serif';

export interface BrowserWindowProps {
    /** Tabs in strip order. */
    tabs: ChaosTab[];
    /** Index into `tabs` of the highlighted tab (its URL and page are shown). */
    activeIndex: number;
    theme: TourTheme;
    width: number;
    height: number;
    /** 0..1: how far the whole window has arrived (opacity, rise, scale). Default 1. */
    appear?: number;
    /**
     * Per-tab 0..1 presence (parallel to `tabs`), default all 1. A tab at 0.5 is
     * half-width and half-faded and the others reflow, so tabs piling in or
     * closing animate the way Chrome's do.
     */
    tabProgress?: number[];
    /** Extra uniform scale on top of `appear`'s (scene 2 shrinks the windows to make room for the popup). Default 1. */
    scale?: number;
    /** CSS transform-origin for the scale; default "50% 100%" (the window rises from its bottom edge). */
    origin?: string;
    /** TabMerger's toolbar button; `pressed` (0..1) draws the click highlight. */
    toolbarIcon?: { src: string; pressed: number };
    style?: React.CSSProperties;
}

function Favicon({ tab, size }: { tab: ChaosTab; size: number }) {
    if (!tab.favicon) {
        return (
            <div
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    background: tab.accent,
                    flexShrink: 0,
                }}
            />
        );
    }
    return <Img src={staticFile(tab.favicon)} style={{ width: size, height: size, flexShrink: 0, objectFit: "contain" }} />;
}

function TabItem({
    tab,
    width,
    presence,
    active,
    theme,
}: {
    tab: ChaosTab;
    width: number;
    presence: number;
    active: boolean;
    theme: TourTheme;
}) {
    const c = PALETTE[theme];
    const showTitle = width >= 96;
    const showIcon = width >= TAB_MIN_WIDTH;
    return (
        <div style={{ width, height: TAB_HEIGHT, flexShrink: 0, opacity: presence, overflow: "hidden" }}>
            <div
                style={{
                    height: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: showTitle ? "flex-start" : "center",
                    gap: 10,
                    padding: showTitle ? "0 14px" : 0,
                    borderRadius: "10px 10px 0 0",
                    background: active ? c.active : "transparent",
                    // Divider between inactive tabs, like Chrome's.
                    boxShadow: active ? "none" : `inset -1px 0 0 -0px ${c.divider}`,
                    color: active ? c.text : c.muted,
                    fontFamily: FONT,
                    fontSize: 16,
                    whiteSpace: "nowrap",
                }}
            >
                {showIcon && <Favicon tab={tab} size={20} />}
                {showTitle && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title}</span>}
            </div>
        </div>
    );
}

const iconProps = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ToolbarIcons({ theme }: { theme: TourTheme }) {
    const stroke = PALETTE[theme].muted;
    return (
        <div style={{ display: "flex", gap: 22, alignItems: "center", padding: "0 6px" }}>
            <svg {...iconProps} stroke={stroke}>
                <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            <svg {...iconProps} stroke={stroke} opacity={0.5}>
                <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <svg {...iconProps} stroke={stroke}>
                <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" />
            </svg>
        </div>
    );
}

function WindowControls({ theme }: { theme: TourTheme }) {
    const stroke = PALETTE[theme].text;
    const box = { width: 46, height: TAB_STRIP_HEIGHT - 6, display: "flex", alignItems: "center", justifyContent: "center" };
    return (
        <div style={{ display: "flex", position: "absolute", right: 0, top: 0 }}>
            <div style={box}>
                <svg width="14" height="14" viewBox="0 0 14 14" stroke={stroke} strokeWidth="1.5">
                    <path d="M1 7h12" />
                </svg>
            </div>
            <div style={box}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={stroke} strokeWidth="1.5">
                    <rect x="2" y="2" width="10" height="10" />
                </svg>
            </div>
            <div style={box}>
                <svg width="14" height="14" viewBox="0 0 14 14" stroke={stroke} strokeWidth="1.5">
                    <path d="M2 2l10 10M12 2L2 12" />
                </svg>
            </div>
        </div>
    );
}

export function BrowserWindow({
    tabs,
    activeIndex,
    theme,
    width,
    height,
    appear = 1,
    tabProgress,
    scale = 1,
    origin = "50% 100%",
    toolbarIcon,
    style,
}: BrowserWindowProps) {
    const c = PALETTE[theme];
    const presence = tabs.map((_, i) => tabProgress?.[i] ?? 1);
    const totalPresence = presence.reduce((a, b) => a + b, 0);
    const stripWidth = width - STRIP_LEFT_PAD - STRIP_RIGHT_RESERVED;
    // Chrome shrinks every tab equally as they multiply, down to a minimum.
    const tabWidth = totalPresence > 0 ? Math.min(TAB_MAX_WIDTH, Math.max(TAB_MIN_WIDTH, stripWidth / totalPresence)) : TAB_MAX_WIDTH;
    const active = tabs[activeIndex];
    const contentHeight = height - TAB_STRIP_HEIGHT - TOOLBAR_HEIGHT;

    return (
        <div
            style={{
                position: "absolute",
                width,
                height,
                borderRadius: 12,
                overflow: "hidden",
                background: c.frame,
                boxShadow: c.shadow,
                opacity: appear,
                transform: `translateY(${(1 - appear) * 70}px) scale(${(0.94 + 0.06 * appear) * scale})`,
                transformOrigin: origin,
                ...style,
            }}
        >
            <div
                style={{
                    position: "relative",
                    height: TAB_STRIP_HEIGHT,
                    display: "flex",
                    alignItems: "flex-end",
                    paddingLeft: STRIP_LEFT_PAD,
                    boxSizing: "border-box",
                }}
            >
                {tabs.map((tab, i) => (
                    <TabItem
                        key={tab.url}
                        tab={tab}
                        width={tabWidth * presence[i]}
                        presence={presence[i]}
                        active={i === activeIndex}
                        theme={theme}
                    />
                ))}
                <div style={{ width: 40, height: TAB_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" stroke={c.muted} strokeWidth="2" strokeLinecap="round">
                        <path d="M9 3v12M3 9h12" />
                    </svg>
                </div>
                <WindowControls theme={theme} />
            </div>
            <div
                style={{
                    height: TOOLBAR_HEIGHT,
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    padding: "0 18px",
                    background: c.toolbar,
                }}
            >
                <ToolbarIcons theme={theme} />
                <div
                    style={{
                        flex: 1,
                        height: 38,
                        borderRadius: 19,
                        background: c.omnibox,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "0 18px",
                        color: c.text,
                        fontFamily: FONT,
                        fontSize: 17,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.muted} strokeWidth="2">
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{active?.host}</span>
                </div>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c.muted} strokeWidth="2" strokeLinejoin="round">
                    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
                </svg>
                {toolbarIcon && (
                    <div
                        style={{
                            width: TOOLBAR_ICON_SIZE,
                            height: TOOLBAR_ICON_SIZE,
                            borderRadius: "50%",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: `rgba(0, 180, 204, ${0.35 * toolbarIcon.pressed})`,
                        }}
                    >
                        <Img src={staticFile(toolbarIcon.src)} style={{ width: 24, height: 24 }} />
                    </div>
                )}
            </div>
            <div style={{ position: "relative", height: contentHeight, background: c.page, overflow: "hidden" }}>
                {active?.screenshot ? (
                    <Img
                        src={staticFile(active.screenshot)}
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
                    />
                ) : (
                    active && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Favicon tab={active} size={72} />
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
