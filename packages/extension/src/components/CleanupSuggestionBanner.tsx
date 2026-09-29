import { useState } from "react";

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
        for (const groupIndex of staleGroupIndexes) {
            await removeStaleTabs({
                groupIndex,
                staleThresholdMs: thresholdMs,
            });
        }
        toast.success(`Removed ${count} stale ${count === 1 ? "tab" : "tabs"}`);
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
                {count} tabs were saved over {staleThresholdDays} days ago.
            </span>
            <button
                className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors"
                onClick={review}
            >
                Review
            </button>
            <button
                className="shrink-0 border border-primary/40 text-primary px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors"
                onClick={removeAll}
            >
                Remove stale
            </button>
            <button
                className="shrink-0 text-primary hover:opacity-70 transition-opacity ml-1"
                onClick={dismiss}
                aria-label="Dismiss"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
