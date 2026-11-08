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
import { NAV_LINK_ACTIVE_CLASS, NAV_LINKS } from "@/components/layout/navLinks";
import { NavLink } from "@/components/layout/NavLink";
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
                {/* The link bar and the account controls show from lg up; below lg the menu button
                    holds them. Width budget from lg to xl (1024-1279px), signed out: logo, four links
                    (Changelog joins at xl), the GitHub mark alone, the icon-only language button, the
                    theme toggle and two buttons, with at least 2rem to spare in every language
                    (measured; translated labels and other platforms' fonts are wider than English on
                    Windows). min-w-0 here and on the nav still lets this block shrink rather than push
                    the controls off screen if a label ever grows. */}
                <div className="me-4 flex min-w-0 items-center">
                    <Link href="/" className="me-4 flex shrink-0 items-center gap-[9px] lg:me-8">
                        <Image
                            src="/logo.png"
                            alt="TabMerger"
                            width={26}
                            height={26}
                            className="rounded-md"
                        />
                        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">TabMerger</span>
                    </Link>
                    <nav className="hidden min-w-0 items-center gap-1 overflow-hidden text-[13.5px] lg:flex">
                        {NAV_LINKS.map((link) => (
                            <NavLink
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground xl:px-3",
                                    link.barFromXl ? "hidden xl:flex" : "flex"
                                )}
                                activeClassName={NAV_LINK_ACTIVE_CLASS}
                            >
                                {t(link.label)}
                            </NavLink>
                        ))}
                    </nav>
                </div>
                <div className="flex flex-1 items-center justify-end space-x-2">
                    <NavAccountProvider>
                        <div className="flex items-center gap-2.5">
                            <Suspense fallback={<GithubStarsFallback />}>
                                <GithubStars starsPromise={starsPromise} />
                            </Suspense>
                            {/* At every width, beside the theme toggle. The language code shows from sm,
                                except from lg to xl, where the link bar needs the room: there it is
                                just the icon, the same 2.25rem bordered square as the toggle. */}
                            <LanguageSwitcher codeClassName="hidden sm:inline lg:hidden xl:inline" />
                            <ThemeToggle />
                            {/* Sign-in/account controls move into the menu panel below lg */}
                            <div className="hidden items-center gap-2.5 lg:flex">
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
