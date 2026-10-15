import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenuLoader } from "@/components/layout/AccountMenuLoader";
import { MobileNavToggle } from "@/components/layout/MobileNavToggle";
import { GithubStars, GithubStarsFallback } from "@/components/layout/GithubStars";
import { getGithubStarCount } from "@/lib/githubStats";

export async function Navbar() {
    // Started, not awaited: the header renders straight away and the star count streams in
    // behind a Suspense boundary. The one promise feeds both the badge and the mobile panel.
    const starsPromise = getGithubStarCount();

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const initials = user?.email
        ? user.email.slice(0, 2).toUpperCase()
        : undefined;

    return (
        <header className="sticky top-0 z-50 flex h-16 w-full items-center border-b border-border bg-background px-4">
            <div className="container relative flex items-center">
                {/* Width budget from md to lg: the container is capped at 768px there and, logged out,
                    holds the logo, four links, the GitHub mark, the theme toggle and two buttons. The
                    tighter spacing below lg (mr-4 here and on the logo, px-2 on the links) is what
                    makes them fit: this block shrinks instead of overflowing, so when it is too wide
                    the right-hand cluster slides over the last link rather than causing a scrollbar. */}
                <div className="mr-4 flex items-center">
                    <Link href="/" className="mr-4 flex shrink-0 items-center gap-[9px] lg:mr-8">
                        <Image
                            src="/logo.png"
                            alt="TabMerger"
                            width={26}
                            height={26}
                            className="rounded-md"
                        />
                        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">TabMerger</span>
                    </Link>
                    <nav className="hidden items-center gap-1 text-[13.5px] md:flex">
                        <Link
                            href="/features"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            Features
                        </Link>
                        <Link
                            href="/pricing"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            Pricing
                        </Link>
                        <Link
                            href="/changelog"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            Changelog
                        </Link>
                        <Link
                            href="/faq"
                            className="flex h-8 items-center rounded-lg px-2 text-text2 transition-colors hover:bg-surface2 hover:text-foreground lg:px-3"
                        >
                            FAQ
                        </Link>
                    </nav>
                </div>
                <div className="flex flex-1 items-center justify-end space-x-2">
                    <div className="flex items-center gap-2.5">
                        <Suspense fallback={<GithubStarsFallback />}>
                            <GithubStars starsPromise={starsPromise} />
                        </Suspense>
                        <ThemeToggle />
                        {/* Sign-in/account controls move into the mobile hamburger panel below md */}
                        <div className="hidden items-center gap-2.5 md:flex">
                            {user ? (
                                <AccountMenuLoader email={user.email ?? ""} initials={initials} />
                            ) : (
                                <>
                                    {/* The theme toggle and the GitHub badge have a 1px border; these two get one too (transparent
                                        or the fill colour), so all four are the same 36px box and the browser snaps
                                        them to the same device pixels at any zoom. */}
                                    <Button variant="ghost" size="sm" className="border border-transparent" asChild>
                                        <Link href="/auth/sign-in">Sign in</Link>
                                    </Button>
                                    <Button size="sm" className="border border-primary" asChild>
                                        <Link href="/auth/sign-up">
                                            Get started
                                        </Link>
                                    </Button>
                                </>
                            )}
                        </div>
                        <MobileNavToggle email={user?.email} initials={initials} starsPromise={starsPromise} />
                    </div>
                </div>
            </div>
        </header>
    );
}
