import React from "react";
import { Composition, registerRoot } from "remotion";
import { WalkthroughDemo, MobileWalkthroughDemo, getTotalDurationInFrames } from "./Composition";
import { demoScript, promoScript } from "../demo-script";
import { ScreenshotFrame } from "./stills/ScreenshotFrame";
import { PromoTile } from "./stills/PromoTile";

// ponytail: 2026-09-26 — hard duration caps from direct user asks: the full
// walkthrough must land at/under 60s (was 103.1s), the promo cut at/under
// 30s (was 82.9s). `WalkthroughDemo`'s new `speed` prop (Composition.tsx)
// plays every non-textCard beat back faster (real motion, not a truncated
// freeze — see that prop's own comment) without touching a single
// `durationMs` in demo-script.ts. Values below are solved algebraically per
// composition (action-beats total / speed + fixed intro+text-card time <=
// target), not guessed — re-derive if any step's real durationMs, the
// promoScript beat list, or the target caps ever change:
//   walkthrough: fixed (intro 1500 + hook 3694 + outro 3392) = 8586ms;
//     action beats total 94480ms; 94480/1.9 + 8586 = 58312ms (58.3s, <=60s)
//   promo: fixed (intro 1500 + outro 4200) = 5700ms; action beats total
//     (chaos-hook 6320 + open-popup 9720 + multi-select-drag 7200 +
//     cross-group-drag 6800) = 30040ms; 30040/1.3 + 5700 = 28808ms (28.8s,
//     <=30s)
const WALKTHROUGH_SPEED = 1.9;
const PROMO_SPEED = 1.3;

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
                durationInFrames={getTotalDurationInFrames(demoScript, WALKTHROUGH_SPEED)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "dark", speed: WALKTHROUGH_SPEED }}
            />
            <Composition
                id="WalkthroughDemoLight"
                component={WalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(demoScript, WALKTHROUGH_SPEED)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "light", speed: WALKTHROUGH_SPEED }}
            />
            {/* ~29s fast-paced promo cut (see PROMO_VIDEO_SPEC.md) — reuses the
                same recorded clips as the full walkthrough via promoScript's
                shared step ids. Still native 800x600/30fps like the full
                walkthrough; the 1920x1080/60fps upscale flagged in the spec's
                technical checklist is not attempted in this pass. */}
            <Composition
                id="PromoDark"
                component={WalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript, PROMO_SPEED)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "dark", script: promoScript, speed: PROMO_SPEED }}
            />
            <Composition
                id="PromoLight"
                component={WalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript, PROMO_SPEED)}
                fps={30}
                width={800}
                height={600}
                defaultProps={{ theme: "light", script: promoScript, speed: PROMO_SPEED }}
            />
            {/* Portrait/mobile-friendly promo export (1080x1920) — same
                promoScript/clips as PromoDark/PromoLight above, scaled up
                into a phone-legible portrait canvas. See
                MobileWalkthroughDemo's comment in Composition.tsx. */}
            <Composition
                id="PromoDarkVertical"
                component={MobileWalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript, PROMO_SPEED)}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ theme: "dark", script: promoScript, speed: PROMO_SPEED }}
            />
            <Composition
                id="PromoLightVertical"
                component={MobileWalkthroughDemo}
                durationInFrames={getTotalDurationInFrames(promoScript, PROMO_SPEED)}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ theme: "light", script: promoScript, speed: PROMO_SPEED }}
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
            {/* 2:1 social preview (GitHub repo social preview, og:image) */}
            <Composition
                id="SocialPreview"
                component={PromoTile}
                durationInFrames={1}
                fps={30}
                width={1280}
                height={640}
                defaultProps={{ variant: "social" }}
            />
        </>
    );
}

registerRoot(RemotionRoot);
