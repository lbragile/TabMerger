import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavAccountProvider, NavAccountSlot } from "@/components/layout/NavAccount";
import { MobileNavToggle } from "@/components/layout/MobileNavToggle";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { GithubStars, GithubStarsFallback } from "@/components/layout/GithubStars";
import { getGithubStarCount } from "@/lib/githubStats";

/**
 * The site header. Reads nothing per request, so the pages around it can be rendered at build
 * time: the account controls are resolved in the browser (`NavAccountProvider`), the star count
 * comes from a revalidated fetch.
 */
export async function Navbar() {
    // Started, not awaited: the header renders straight away and the star count streams in
    // behind a Suspense boundary. The one promise feeds both the badge and the mobile panel.
    const starsPromise = getGithubStarCount();
    const t = await getTranslations("nav");

    return (
        <header className="sticky top-0 z-50 flex h-16 w-full items-center border-b border-border bg-background px-4">
            <div className="container relative flex items-center">
                {/* Width budget from md to lg: the container is capped at 768px there and, logged out,
                    holds the logo, four links, the GitHub mark, the language button, the theme toggle
                    and two buttons. The tighter spacing below lg (me-4 here and on the logo, px-2 on
                    the links), the logo without its wordmark and the icon-only language button are
                    what make them fit: this block shrinks instead of overflowing, so when it is too wide
                    the end cluster slides over the last link rather than causing a scrollbar.
                    min-w-0 here and on the nav is what lets it shrink: with longer (translated) link
                    labels the last links are cut off at the cluster instead of pushing the sign-in
                    buttons off the screen. English fits without it. */}
                <div className="me-4 flex min-w-0 items-center">
                    <Link href="/" className="me-4 flex shrink-0 items-center gap-[9px] lg:me-8">
                        <Image
                            src="/logo.png"
                            alt="TabMerger"
                            width={26}
                            height={26}
                            className="rounded-md"
                        />
                        {/* Hidden from md to lg (the logo's alt text still names the link): the language
                            button needs the room. */}
                        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline md:hidden lg:inline">TabMerger</span>
                    </Link>
                    <nav className="hidden min-w-0 items-center gap-1 overflow-hidden text-[13.5px] md:flex">
                        <Link
                            href="/features"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            {t("features")}
                        </Link>
                        <Link
                            href="/pricing"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            {t("pricing")}
                        </Link>
                        <Link
                            href="/changelog"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            {t("changelog")}
                        </Link>
                        <Link
                            href="/faq"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            {t("faq")}
                        </Link>
                    </nav>
                </div>
                <div className="flex flex-1 items-center justify-end space-x-2">
                    <NavAccountProvider>
                        <div className="flex items-center gap-2.5">
                            <Suspense fallback={<GithubStarsFallback />}>
                                <GithubStars starsPromise={starsPromise} />
                            </Suspense>
                            {/* At every width, beside the theme toggle: below lg just the icon, the same
                                2.25rem bordered square as the toggle. */}
                            <LanguageSwitcher codeClassName="hidden lg:inline" />
                            <ThemeToggle />
                            {/* Sign-in/account controls move into the mobile hamburger panel below md */}
                            <div className="hidden items-center gap-2.5 md:flex">
                                <NavAccountSlot />
                            </div>
                            <MobileNavToggle starsPromise={starsPromise} />
                        </div>
                    </NavAccountProvider>
                </div>
            </div>
        </header>
    );
}
