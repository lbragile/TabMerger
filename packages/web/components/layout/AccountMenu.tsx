"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
import { NO_CAPTURE_CLASS } from "@/lib/analyticsPrivacy";

/**
 * The signed-in visitor's account menu. Reached only through `AccountMenuLoader` (a lazy
 * import): the menu pulls in Radix's dropdown, popper and focus code, which a signed-out
 * visitor to the marketing pages would otherwise download and never use.
 */
export function AccountMenu({ email, initials }: { email: string; initials?: string }) {
    const t = useTranslations("nav");
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className={ACCOUNT_AVATAR_BUTTON_CLASS}
                    aria-label={t("accountMenu")}
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
                    <p className={`text-sm font-medium leading-none ${NO_CAPTURE_CLASS}`}>
                        {email}
                    </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href="/dashboard">{t("dashboard")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/account">{t("account")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Red on hover and focus, like the same item in the dashboard's menu. */}
                <DropdownMenuItem asChild className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <SignOutForm>
                        <button
                            className="w-full text-start"
                            type="submit"
                        >
                            {t("signOut")}
                        </button>
                    </SignOutForm>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
