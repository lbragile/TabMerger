import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNavToggle } from "@/components/layout/MobileNavToggle";
import { SignOutForm } from "@/components/auth/SignOutForm";
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
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            className="relative h-8 w-8 rounded-md"
                                            aria-label="Account menu"
                                        >
                                            <Avatar className="h-8 w-8 rounded-md">
                                                <AvatarFallback className="text-xs rounded-md">
                                                    {initials}
                                                </AvatarFallback>
                                            </Avatar>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        className="w-56"
                                        align="end"
                                        forceMount
                                    >
                                        <div className="flex flex-col space-y-1 p-2">
                                            <p className="text-sm font-medium leading-none">
                                                {user.email}
                                            </p>
                                        </div>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem asChild>
                                            <Link href="/dashboard">Dashboard</Link>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem asChild>
                                            <Link href="/account">Account</Link>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem asChild>
                                            <SignOutForm>
                                                <button
                                                    className="w-full text-left"
                                                    type="submit"
                                                >
                                                    Sign out
                                                </button>
                                            </SignOutForm>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <>
                                    <Button variant="ghost" size="sm" asChild>
                                        <Link href="/auth/sign-in">Sign in</Link>
                                    </Button>
                                    <Button size="sm" asChild>
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
