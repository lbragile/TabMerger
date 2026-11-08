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
import { NAV_LINKS } from "@/components/layout/navLinks";
import { cn } from "@/lib/utils";

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
                    {/* Tighter between md and lg (gap, padding, text a hair smaller): the 768-1023px
                        header is the narrowest bar, and French "FAQ" was cut off there. */}
                    <nav className="hidden min-w-0 items-center gap-0.5 overflow-hidden text-[13px] md:flex lg:gap-1 lg:text-[13.5px]">
                        {NAV_LINKS.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "h-8 items-center rounded-lg px-1.5 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3",
                                    link.barFromXl ? "hidden xl:flex" : "flex"
                                )}
                            >
                                {t(link.label)}
                            </Link>
                        ))}
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
