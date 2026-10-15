"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountAvatar, ACCOUNT_AVATAR_BUTTON_CLASS } from "@/components/layout/AccountAvatar";
import { SignOutForm } from "@/components/auth/SignOutForm";

/**
 * The signed-in visitor's account menu. Reached only through `AccountMenuLoader` (a lazy
 * import): the menu pulls in Radix's dropdown, popper and focus code, which a signed-out
 * visitor to the marketing pages would otherwise download and never use.
 */
export function AccountMenu({ email, initials }: { email: string; initials?: string }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className={ACCOUNT_AVATAR_BUTTON_CLASS}
                    aria-label="Account menu"
                >
                    <AccountAvatar initials={initials} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-56"
                align="end"
                forceMount
            >
                <div className="flex flex-col space-y-1 p-2">
                    <p className="text-sm font-medium leading-none">
                        {email}
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
                {/* Red on hover and focus, like the same item in the dashboard's menu. */}
                <DropdownMenuItem asChild className="text-destructive focus:bg-destructive/10 focus:text-destructive">
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
    );
}
