import { useState } from "react";

import { X } from "lucide-react";
import { toast } from "sonner";
import { useCleanupSuggestions } from "@/hooks/useCleanupSuggestions";
import { useRemoveStaleTabs } from "@/hooks/useGroups";
import { useUIStore } from "@/stores/uiStore";

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
    const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);

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
        if (staleGroupIndexes.length > 0)
            setActiveGroupIndex(staleGroupIndexes[0]);
    }

    async function removeAll() {
        for (const groupIndex of staleGroupIndexes) {
            await removeStaleTabs({
                groupIndex,
                staleThresholdMs: thresholdMs,
            });
        }
        toast.success(`Removed ${count} stale ${count === 1 ? "tab" : "tabs"}`);
        dismiss();
    }

    return (
        <div
            className="flex items-center gap-2 px-3 text-xs shrink-0"
            style={{
                height: 38,
                background: "#E6EBF0",
                color: "var(--color-neutral-700)",
            }}
        >
            <span className="flex-1 truncate">
                {count} tabs were saved over {staleThresholdDays} days ago.
            </span>
            <button
                className="shrink-0 border px-2 py-0.5 text-xs hover:opacity-80 transition-opacity"
                style={{
                    borderColor: "var(--color-divider)",
                    color: "var(--color-neutral-700)",
                }}
                onClick={review}
            >
                Review
            </button>
            <button
                className="shrink-0 border px-2 py-0.5 text-xs hover:opacity-80 transition-opacity"
                style={{
                    borderColor: "var(--color-divider)",
                    color: "var(--color-neutral-700)",
                }}
                onClick={removeAll}
            >
                Remove stale
            </button>
            <button
                className="shrink-0 hover:opacity-70 transition-opacity ml-1"
                onClick={dismiss}
                aria-label="Dismiss"
            >
                <X
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--color-neutral-600)" }}
                />
            </button>
        </div>
    );
}
