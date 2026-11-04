import { Fragment, useId, type ReactNode } from "react";
import { LayoutGrid, NotebookPen, PenLine, Settings, Sparkles, WandSparkles } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/uiStore";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAutoGroup, useOrganizeTabs } from "@/hooks/useAI";
import { useAiUsage } from "@/hooks/useAiUsage";
import { useNameGroupAction } from "@/hooks/useNameGroupAction";
import { useDescribeGroupAction } from "@/hooks/useDescribeGroupAction";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useGroups, useApplyAIGroups } from "@/hooks/useGroups";
import { AI_ENABLED } from "@/lib/aiFlag";
import { toast } from "@/lib/toast";
import { FreeLimitExceededError, countedGroups } from "@/lib/tierLimits";
import { clampAiSuggestionsToSlots } from "@/lib/aiAutoGroup";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { formatNumber } from "@/lib/i18n";
import { AiRequestError, QuotaExceededError, isFixedInAiSettings } from "@/lib/aiErrors";
import { TOUR_ANCHORS } from "@/lib/tourSteps";
import { LockedMark, LockedUpgradeFooter, ProAiTag } from "./AiMenuLocked";

const ICON = "h-3.5 w-3.5 me-2 shrink-0 text-muted-foreground";
const HINT = "text-[10px] text-muted-foreground font-normal";
const SECTION_LABEL = "px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

interface AiMenuProps {
    /** The header shows the "out of credits" prompt below itself while this is true. */
    onQuotaExceeded: (exceeded: boolean) => void;
}

/** One labelled group of the menu: a small uppercase label (not focusable) and its items. */
function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
    const id = useId();
    return (
        <DropdownMenuGroup aria-labelledby={id}>
            <DropdownMenuLabel id={id} className={cn(SECTION_LABEL, "flex min-w-0")}>
                <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuLabel>
            {children}
        </DropdownMenuGroup>
    );
}

/** An item's two lines: the action and what it does. */
function ItemText({ title, hint }: { title: ReactNode; hint: ReactNode }) {
    return (
        <div className="min-w-0">
            <div>{title}</div>
            <div className={HINT}>{hint}</div>
        </div>
    );
}

/**
 * The header's ✨ AI menu, sorted by what each action works on: OPEN TABS (Auto-group), SELECTED
 * GROUP (Name group, Describe group: the group shown in the main panel, named in the label) and ALL
 * GROUPS (Organize…). A section whose actions are all switched off in Settings → AI is hidden; the
 * selected-group actions are disabled with a hint while no saved group with tabs is selected. The
 * footer shows the credits left this month (managed plans) or "Your own key", and opens Settings
 * on the AI tab.
 *
 * Free and Pro users get a locked preview: the sparkle in full colour with a "Pro AI" tag, and the
 * same sections with every action shown but locked (a lock, `aria-disabled`, never runs; the
 * per-feature switches don't apply) above an "Upgrade to Pro AI" item that opens the upgrade
 * modal. This is UX only: the server rejects AI requests without Pro AI.
 *
 * Hidden entirely while no AI option is live, for a Pro AI subscriber whose option isn't live yet,
 * and when "Show AI button" (Settings → General) is off.
 */
export function AiMenu({ onQuotaExceeded }: AiMenuProps) {
    const { t } = useTranslation();
    const openModal = useUIStore((s) => s.openModal);
    const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
    const { aiFeatures, tier, maxGroups, maxTabs, aiMode } = useEntitlements();
    const { data: groupsState } = useGroups();
    const { data: appSettings } = useAppSettings();
    const usage = useAiUsage();
    const { mutateAsync: autoGroup, isPending: aiLoading } = useAutoGroup();
    const { mutateAsync: applyAIGroups } = useApplyAIGroups({ maxGroups, maxTabs });
    const { mutateAsync: organizeTabs, isPending: organizeLoading } = useOrganizeTabs();
    // The selected-group actions work on the group shown in the main panel; the same actions as
    // the sidebar group menu's (shared hooks: same toasts, undo step and note review)
    const activeGroup = groupsState?.available[activeGroupIndex];
    const { run: nameActiveGroup, isPending: nameLoading, block } = useNameGroupAction(activeGroup);
    const { run: describeActiveGroup, isPending: describeLoading } = useDescribeGroupAction(activeGroup);
    const aiPending = aiLoading || organizeLoading || nameLoading || describeLoading;

    if (!AI_ENABLED || (tier === "pro_ai" && !aiFeatures) || appSettings?.showAiButton === false) return null;

    // Free and Pro: the preview, with every action locked
    const locked = !aiFeatures;
    /** A menu item's behaviour: runs `run` (unless `disabled`), or, locked, stays shown and focusable but does nothing (the menu stays open). */
    const itemProps = (run: () => void, disabled = false) =>
        locked
            ? { "aria-disabled": true as const, "data-locked": "", className: "cursor-default text-muted-foreground", onSelect: (e: Event) => e.preventDefault() }
            : { disabled, onClick: run };

    /** Settings on its AI tab (the own key, the model, the per-feature switches). */
    const openAiSettings = () => openModal("settings", { tab: "ai" });

    /** An AI error toast, with an "Open Settings" action when the fix is in Settings → AI (the own key, the model). */
    const aiErrorToast = (message: string, err: unknown) => {
        if (isFixedInAiSettings(err)) {
            toast.error(message, { action: { label: t("common.openSettings"), onClick: openAiSettings } });
        } else {
            toast.error(message);
        }
    };

    const handleAIGroup = async () => {
        if (!groupsState) return;
        const tabs =
            groupsState.available[0]?.windows.flatMap((w) => w.tabs) ?? [];
        if (tabs.length === 0) {
            toast.error(t("header.toast.noTabsToGroup"));
            return;
        }
        onQuotaExceeded(false);
        try {
            const result = await autoGroup(tabs);
            if (result.groups.length === 0) {
                toast.info(t("header.toast.aiNoGroups"));
                return;
            }

            // Cap the NEW groups to the remaining free-tier group slots (the limit manual "New group"
            // enforces); a suggestion that goes into an existing same-named group needs no slot
            const activeCount = countedGroups(groupsState.available).length;
            const remaining = isFinite(maxGroups) ? Math.max(0, maxGroups - activeCount) : Infinity;
            const { kept: suggestions, skipped } = clampAiSuggestionsToSlots(groupsState.available, result.groups, remaining);
            if (suggestions.length === 0) {
                trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
                toast.error(t('common.freeGroupLimit', { max: maxGroups }), {
                    action: { label: t('common.upgrade'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
                });
                return;
            }

            const { createdGroups, mergedGroups } = await applyAIGroups(suggestions);
            if (createdGroups + mergedGroups === 0) {
                toast.info(t("header.toast.aiNoMatchingTabs"));
                return;
            }
            // "AI created 2 groups" + "Also added tabs to 3 existing groups.", or "AI added tabs to 3 existing groups"
            const description = [
                createdGroups > 0 && mergedGroups > 0 ? t('header.toast.aiAlsoAdded', { count: mergedGroups }) : null,
                skipped > 0 ? t('header.toast.aiSkipped', { skipped }) : null,
            ].filter(Boolean).join(' ');
            toast.success(
                createdGroups > 0 ? t('header.toast.aiCreated', { count: createdGroups }) : t('header.toast.aiAddedTo', { count: mergedGroups }),
                description ? { description } : {}
            );
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                onQuotaExceeded(true);
                return;
            }
            // The backstop already showed the upgrade toast
            if (err instanceof FreeLimitExceededError) return;
            console.error("[TabMerger] AI grouping failed:", err);
            // A coded server error (own key missing or rejected, model unavailable, ...) says what to do
            aiErrorToast(err instanceof AiRequestError && err.code ? err.message : t("header.toast.aiGroupingFailed"), err);
        }
    };

    // Asks the AI for changes (merge, rename, archive, reorder) and reviews them right here: the
    // popup holds the decrypted groups, so it is the one place that can apply them for an
    // encrypted account. Nothing changes until the user applies them in the review modal.
    const handleOrganize = async () => {
        onQuotaExceeded(false);
        try {
            const { actions } = await organizeTabs();
            if (actions.length === 0) {
                toast.info(t('header.toast.organizeNothing'));
                return;
            }
            openModal('organizeReview', { actions });
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                onQuotaExceeded(true);
                return;
            }
            aiErrorToast(err instanceof Error ? err.message : t('header.toast.organizeFailed'), err);
        }
    };

    // The per-feature switches live in Settings → AI (Pro AI); the locked preview shows everything
    const showAutoGroup = locked || appSettings?.aiAutoGroupEnabled !== false;
    const showName = locked || appSettings?.aiNameGroupEnabled !== false;
    const showDescribe = locked || appSettings?.aiDescribeGroupEnabled !== false;
    const showOrganize = locked || appSettings?.aiOrganizeEnabled !== false;
    // Why the selected-group actions can't run: no saved group (Now Open, none) or no tabs
    const blockedHint = (noTabsKey: "groupMenu.toast.noTabsToName" | "groupMenu.toast.noTabsToDescribe") =>
        locked ? null : block === "notSaved" ? t("header.nameGroupPickSaved") : block === "noTabs" ? t(noTabsKey) : null;

    const sections: { key: string; node: ReactNode }[] = [];
    if (showAutoGroup) {
        sections.push({
            key: "openTabs",
            node: (
                <Section label={t("header.aiSection.openTabs")}>
                    <DropdownMenuItem {...itemProps(() => void handleAIGroup())} data-testid="header-ai-auto-group">
                        <LayoutGrid className={ICON} />
                        <ItemText title={t("header.autoGroup")} hint={t("header.autoGroupHint")} />
                        {locked && <LockedMark />}
                    </DropdownMenuItem>
                </Section>
            ),
        });
    }
    if (showName || showDescribe) {
        sections.push({
            key: "selectedGroup",
            node: (
                <Section
                    label={
                        block === "notSaved" || !activeGroup ? (
                            t("header.aiSection.selectedGroup")
                        ) : (
                            // The name is isolated (bdi), kept as typed (not uppercased) and cut with an ellipsis; the full name is its title
                            <Trans
                                i18nKey="header.aiSection.selectedGroupNamed"
                                values={{ name: activeGroup.name }}
                                components={{ name: <bdi title={activeGroup.name} className="inline-block max-w-[8rem] truncate align-bottom normal-case tracking-normal" /> }}
                            />
                        )
                    }
                >
                    {showName && (
                        <DropdownMenuItem {...itemProps(() => void nameActiveGroup(), block !== null)} data-testid="header-ai-name-group">
                            <PenLine className={ICON} />
                            <ItemText title={t("header.nameGroup")} hint={blockedHint("groupMenu.toast.noTabsToName") ?? t("header.nameGroupHint")} />
                            {locked && <LockedMark />}
                        </DropdownMenuItem>
                    )}
                    {showDescribe && (
                        <DropdownMenuItem {...itemProps(() => void describeActiveGroup(), block !== null)} data-testid="header-ai-describe-group">
                            <NotebookPen className={ICON} />
                            <ItemText title={t("header.describeGroup")} hint={blockedHint("groupMenu.toast.noTabsToDescribe") ?? t("header.describeGroupHint")} />
                            {locked && <LockedMark />}
                        </DropdownMenuItem>
                    )}
                </Section>
            ),
        });
    }
    if (showOrganize) {
        sections.push({
            key: "allGroups",
            node: (
                <Section label={t("header.aiSection.allGroups")}>
                    <DropdownMenuItem {...itemProps(() => void handleOrganize())} data-testid="header-ai-organize">
                        <WandSparkles className={ICON} />
                        <ItemText title={t("header.organize")} hint={t("header.organizeHint")} />
                        {locked && <LockedMark />}
                    </DropdownMenuItem>
                </Section>
            ),
        });
    }

    // Managed: credits left this month (once known). Own key: no TabMerger credits.
    const planLine =
        aiMode === "byok"
            ? t("header.aiOwnKey")
            : aiMode === "managed" && usage.known
              ? t("header.aiCreditsLeft", { count: usage.remaining, formatted: formatNumber(usage.remaining) })
              : null;

    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn("relative h-7 w-7", aiPending && "animate-pulse")}
                            disabled={aiPending}
                            aria-label={locked ? t("header.aiActionsLocked") : t("header.aiActions")}
                            data-tour={TOUR_ANCHORS.aiActions}
                        >
                            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                            {locked && <ProAiTag />}
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    {locked ? t("header.aiActionsLocked") : t("header.aiActions")}
                </TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-64 text-xs" data-testid="header-ai-menu" data-locked={locked ? "" : undefined}>
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-semibold">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                    {t("header.aiActions")}
                    {locked && <span className="ms-auto text-[0.625rem] font-normal text-muted-foreground">{t("header.aiLockedNote")}</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {sections.map(({ key, node }, i) => (
                    <Fragment key={key}>
                        {i > 0 && <DropdownMenuSeparator />}
                        {node}
                    </Fragment>
                ))}
                <DropdownMenuSeparator />
                {locked ? (
                    <LockedUpgradeFooter onUpgrade={() => openModal("upgrade", { reason: "aiFeatures" })} />
                ) : (
                    <AiMenuFooter planLine={planLine} onOpenSettings={openAiSettings} />
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** "1,820 credits left · AI settings": the plan line (not focusable) describes the settings item. */
function AiMenuFooter({ planLine, onOpenSettings }: { planLine: string | null; onOpenSettings: () => void }) {
    const { t } = useTranslation();
    const planId = useId();
    return (
        <div className="flex min-w-0 items-center gap-1">
            {planLine && (
                <DropdownMenuLabel id={planId} className="min-w-0 flex-1 truncate text-[10px] font-normal text-muted-foreground" data-testid="header-ai-plan">
                    {planLine}
                </DropdownMenuLabel>
            )}
            <DropdownMenuItem
                className="ms-auto shrink-0"
                onClick={onOpenSettings}
                aria-describedby={planLine ? planId : undefined}
                data-testid="header-ai-settings"
            >
                <Settings className={ICON} />
                {t("header.aiSettings")}
            </DropdownMenuItem>
        </div>
    );
}
