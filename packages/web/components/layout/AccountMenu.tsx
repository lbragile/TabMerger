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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
    );
}
