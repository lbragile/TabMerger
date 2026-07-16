import React from "react";
import { Composition, registerRoot } from "remotion";
import { WalkthroughDemo, totalDurationInFrames } from "./Composition";
import { ScreenshotFrame } from "./stills/ScreenshotFrame";
import { PromoTile } from "./stills/PromoTile";

export function RemotionRoot() {
    return (
        <>
            <Composition
                id="WalkthroughDemo"
                component={WalkthroughDemo}
                durationInFrames={totalDurationInFrames}
                fps={30}
                width={780}
                height={600}
            />
            {/* Chrome Web Store listing assets — rendered via render-store-assets.ts */}
            <Composition
                id="ScreenshotFrame"
                component={ScreenshotFrame}
                durationInFrames={1}
                fps={30}
                width={1280}
                height={800}
                defaultProps={{ screenshotId: "open-popup" }}
            />
            <Composition
                id="PromoSmall"
                component={PromoTile}
                durationInFrames={1}
                fps={30}
                width={440}
                height={280}
                defaultProps={{ variant: "small" }}
            />
            <Composition
                id="PromoMarquee"
                component={PromoTile}
                durationInFrames={1}
                fps={30}
                width={1400}
                height={560}
                defaultProps={{ variant: "marquee" }}
            />
        </>
    );
}

registerRoot(RemotionRoot);
