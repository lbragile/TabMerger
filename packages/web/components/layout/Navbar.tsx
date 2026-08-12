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

export async function Navbar() {
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
                <div className="mr-8 flex items-center">
                    <Link href="/" className="mr-8 flex shrink-0 items-center gap-[9px]">
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
                            className="flex h-8 items-center rounded-lg px-3 text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            Features
                        </Link>
                        <Link
                            href="/pricing"
                            className="flex h-8 items-center rounded-lg px-3 text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            Pricing
                        </Link>
                        <Link
                            href="/changelog"
                            className="flex h-8 items-center rounded-lg px-3 text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            Changelog
                        </Link>
                        <Link
                            href="/faq"
                            className="flex h-8 items-center rounded-lg px-3 text-text2 transition-colors hover:bg-surface2 hover:text-foreground"
                        >
                            FAQ
                        </Link>
                    </nav>
                </div>
                <div className="flex flex-1 items-center justify-end space-x-2">
                    <div className="flex items-center gap-2.5">
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
                        <MobileNavToggle email={user?.email} initials={initials} />
                    </div>
                </div>
            </div>
        </header>
    );
}
