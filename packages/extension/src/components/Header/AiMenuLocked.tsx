import { Lock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * The tiny "Pro AI" tag on the ✨ button of a free or Pro user. Decorative: the button's
 * accessible name already says "AI actions, Pro AI".
 */
export function ProAiTag() {
    const { t } = useTranslation();
    return (
        // Centred under the sparkle (symmetric insets, so the same in both reading directions)
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-0.5 flex justify-center">
            <span
                className="whitespace-nowrap bg-purple-500 px-0.5 text-[0.4375rem] font-bold leading-[0.5625rem] text-white"
                data-testid="header-ai-pro-tag"
            >
                {t("header.aiProTag")}
            </span>
        </span>
    );
}

/** The lock at the end of a locked preview item (decorative: the item is aria-disabled). */
export function LockedMark() {
    return <Lock aria-hidden="true" className="ms-auto h-3 w-3 shrink-0 text-muted-foreground" data-testid="header-ai-lock" />;
}

/**
 * The bottom of the locked preview menu, in place of the credits footer: one prominent "Upgrade to
 * Pro AI" item that opens the upgrade modal. A menu item (not a plain button) so the arrow keys
 * reach it like every other entry.
 */
export function LockedUpgradeFooter({ onUpgrade }: { onUpgrade: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="p-1">
            <DropdownMenuItem
                onClick={onUpgrade}
                className="justify-center gap-1.5 bg-purple-600 text-xs font-semibold text-white focus:bg-purple-700 focus:text-white"
                data-testid="header-ai-upgrade"
            >
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {t("header.upgradeToProAi")}
            </DropdownMenuItem>
        </div>
    );
}
