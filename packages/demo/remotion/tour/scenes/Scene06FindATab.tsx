import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import footage from "../../../lib/tourFindATabFootage.json";
import { CaptionCue, Desktop, type TourSceneProps } from "../common";
import { END_VIEW } from "./Scene04OrganiseTabs";

// Scene 6: "Find a tab". Real footage from record-tour-find-a-tab.ts. It starts on scene 5's
// last frame (same centred 1.55x popup, no drawn windows, no camera move). The search field is
// clicked, "slack" is typed, the results show the matching tabs with the group they live in
// (Work, where scene 4 moved the Slack tab), and the Slack result is clicked: the popup switches
// to Work and keeps the query (the sidebar stays filtered, the matches are highlighted by the
// product itself, so the scene draws no overlay of its own). Then the header's "Clear search"
// button is clicked and the full sidebar is back. The scene ends on Work at scene 5's framing.

export const SCENE_ID = "find-a-tab";

type Theme = "light" | "dark";
type Footage = { frames: Record<string, number>; events: Record<string, Record<string, number>> };
const data = footage as Footage;
/** Light data may not be recorded yet: fall back to dark (numbers and frame images) so the scene never crashes. */
const dataTheme = (theme: Theme): Theme => (data.frames[theme] ? theme : "dark");
const framesOf = (theme: Theme) => data.frames[dataTheme(theme)];

/** Footage plays at its recorded speed (typing at scene 3's pace); every action plays in full. */
const FOOTAGE_SPEED = 1;

/** The whole footage is played; the last frame (search cleared, full sidebar) is the scene's last. */
export const SCENE_06_FRAMES = Math.ceil((framesOf("dark") - 1) / FOOTAGE_SPEED) + 1;

export const SCENE_06_CAPTION: CaptionCue[] = [{ from: 0, text: "Find any tab, in any group." }];

const pad = (n: number) => String(n).padStart(4, "0");

export function Scene06FindATab({ theme = "dark" }: TourSceneProps) {
    const frame = useCurrentFrame();
    const index = Math.min(framesOf(theme), 1 + Math.floor(frame * FOOTAGE_SPEED));
    return (
        <Desktop theme={theme}>
            <div
                style={{
                    position: "absolute",
                    left: END_VIEW.left,
                    top: END_VIEW.top,
                    width: 800,
                    height: 600,
                    transform: `scale(${END_VIEW.scale})`,
                    transformOrigin: "0 0",
                    boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(128,128,128,0.35)",
                    zIndex: 200,
                }}
            >
                <Img src={staticFile(`tour/frames/${dataTheme(theme)}/find-a-tab/f-${pad(index)}.jpg`)} style={{ width: 800, height: 600, display: "block", objectFit: "fill" }} />
            </div>
        </Desktop>
    );
}
