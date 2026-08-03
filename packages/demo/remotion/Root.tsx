import React from "react";
import { Composition, registerRoot } from "remotion";
import { WalkthroughDemo, MobileWalkthroughDemo, totalDurationInFrames, getTotalDurationInFrames } from "./Composition";
import { promoScript } from "../demo-script";
import { ScreenshotFrame } from "./stills/ScreenshotFrame";
import { PromoTile } from "./stills/PromoTile";

export function RemotionRoot() {
    return (
        <>
            {/* Same component/script/timing for both — only `theme` differs,
                so light/dark stay in sync by construction. Each reads its
                clips from public/recordings/<theme>/ (see record.ts's theme
                CLI arg and Composition.tsx's `theme` prop). */}
            <Composition
                id="WalkthroughDemoDark"
                component={WalkthroughDemo}
                durationInFrames={totalDurationInFrames}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "dark" }}
            />
            <Composition
                id="WalkthroughDemoLight"
                component={WalkthroughDemo}
                durationInFrames={totalDurationInFrames}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "light" }}
            />
            {/* 30s fast-paced promo cut (see PROMO_VIDEO_SPEC.md) — reuses the
                same recorded clips as the full walkthrough via promoScript's
                shared step ids. Still native 800x600/30fps like the full
                walkthrough; the 1920x1080/60fps upscale flagged in the spec's
                technical checklist is not attempted in this pass. */}
            <Composition
                id="PromoDark"
                component={WalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "dark", script: promoScript }}
            />
            <Composition
                id="PromoLight"
                component={WalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "light", script: promoScript }}
            />
            {/* Portrait/mobile-friendly promo export (1080x1920) — same
                promoScript/clips as PromoDark/PromoLight above, scaled up
                into a phone-legible portrait canvas. See
                MobileWalkthroughDemo's comment in Composition.tsx. */}
            <Composition
                id="PromoDarkVertical"
                component={MobileWalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript)}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ theme: "dark", script: promoScript }}
            />
            <Composition
                id="PromoLightVertical"
                component={MobileWalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript)}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ theme: "light", script: promoScript }}
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
