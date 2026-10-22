import { useState } from "react";
import { useTranslation } from 'react-i18next';

import { X } from "lucide-react";
import { toast } from "@/lib/toast";
import { useCleanupSuggestions } from "@/hooks/useCleanupSuggestions";
import { useRemoveStaleTabs } from "@/hooks/useGroups";
import { useUIStore } from "@/stores/uiStore";
import { getSetting } from "@/lib/localDb";

const DISMISSED_KEY = "cleanup_banner_dismissed_until";

function isDismissed() {
    const until = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    return Date.now() < until;
}

export function CleanupSuggestionBanner() {
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(isDismissed);
    const { staleTabs, staleGroupIndexes, staleThresholdDays, thresholdMs } =
        useCleanupSuggestions();
    const { mutateAsync: removeStaleTabs } = useRemoveStaleTabs();
    const openModal = useUIStore((s) => s.openModal);

    if (dismissed || staleTabs.length < 5) return null;

    const count = staleTabs.length;

    function dismiss() {
        localStorage.setItem(
            DISMISSED_KEY,
            String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
        setDismissed(true);
    }

    function review() {
        openModal("reviewStaleTabs", { staleTabs, onRemoveAll: removeAll });
    }

    async function doRemoveAll() {
        // ONE write and one undo step for every group (an Undo brings all the removed tabs back)
        await removeStaleTabs({
            groupIndexes: staleGroupIndexes,
            staleThresholdMs: thresholdMs,
        });
        toast.success(t('banners.staleRemoved', { count }));
        dismiss();
    }

    async function removeAll() {
        const { confirmOnDelete } = await getSetting("appSettings", { confirmOnDelete: false });
        if (confirmOnDelete) {
            openModal("removeStaleTabs", { count, onConfirm: doRemoveAll });
        } else {
            await doRemoveAll();
        }
    }

    return (
        <div
            className="flex items-center gap-2 px-3 text-xs shrink-0 bg-primary/10 text-primary"
            style={{ height: 38 }}
        >
            <span className="flex-1 truncate">
                {t('banners.staleTabs', { count, days: staleThresholdDays })}
            </span>
            <button
                className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors"
                onClick={review}
            >
                {t('banners.review')}
            </button>
            <button
                className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors"
                onClick={removeAll}
            >
                {t('banners.removeStale')}
            </button>
            <button
                className="shrink-0 text-primary hover:opacity-70 transition-opacity ms-1"
                onClick={dismiss}
                aria-label={t('banners.dismiss')}
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
