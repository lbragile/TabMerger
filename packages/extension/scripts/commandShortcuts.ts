/**
 * The default keyboard shortcuts (`suggested_key`) of the four "save" commands, and the browser
 * shortcuts they must not collide with.
 *
 * A browser silently leaves an extension command "Not set" when its suggested key is one of the
 * browser's own shortcuts (Edge 158 did this to Ctrl+Shift+K, U and P; Chromium 149 to P), and
 * Firefox never calls an extension shortcut that a built-in one already uses. So the defaults
 * avoid every combination listed below. The documented lists are not the whole story: Edge 158
 * and Chromium 149 also refuse Alt+Shift+C, P, R, W, X and Z, which no help page lists (found by
 * loading builds with each key headless and reading `chrome.commands.getAll()`).
 *
 * - Windows, Linux (`default`): Alt+Shift. Ctrl+Shift is crowded (Edge alone uses 17 letters with
 *   it), and Ctrl+Alt is not allowed (it is AltGr on many keyboards).
 * - macOS (`mac`): Control+Shift (`MacCtrl`). None of the three browsers uses Control+Shift with a
 *   letter or Comma/Period on a Mac. Option+Shift+letter types a character there (Option+Shift+K
 *   types the Apple logo), and Command+Shift is as crowded as Ctrl+Shift.
 *
 * The keys: S = save this tab, Comma (the "<" key) = tabs to the left, Period (the ">" key) = tabs
 * to the right, O = other tabs.
 *
 * Changing a default only changes NEW installs: the browser keeps an existing install's
 * shortcuts (assigned or "Not set") across updates. Anyone can change them at
 * chrome://extensions/shortcuts, edge://extensions/shortcuts or about:addons → Manage Extension
 * Shortcuts.
 */

/** A command's default keys. `mac` is required: without it a Mac would get `default`'s Option keys. */
export interface SuggestedKey {
    default: string;
    mac: string;
}

/** The four save commands' default keys. The browser caps auto-assigned defaults at four per extension. */
export const COMMAND_SHORTCUTS = {
    "save-current-tab": { default: "Alt+Shift+S", mac: "MacCtrl+Shift+S" },
    "save-tabs-left": { default: "Alt+Shift+Comma", mac: "MacCtrl+Shift+Comma" },
    "save-tabs-right": { default: "Alt+Shift+Period", mac: "MacCtrl+Shift+Period" },
    "save-other-tabs": { default: "Alt+Shift+O", mac: "MacCtrl+Shift+O" },
} as const satisfies Record<string, SuggestedKey>;

/**
 * The browsers' own shortcuts with the same modifiers as the defaults (letter keys). Sources:
 * Chrome's "Chrome keyboard shortcuts" help page, Microsoft's "Keyboard shortcuts in Microsoft
 * Edge" page, Firefox's built-in key set (browser-sets.inc plus the developer tools keys), and the
 * undocumented keys Edge 158 and Chromium 149 refused when loaded headless. Checked 2026-11.
 */
export const BROWSER_RESERVED_SHORTCUTS: Record<"windowsLinux" | "mac", Record<"chrome" | "edge" | "firefox", readonly string[]>> = {
    windowsLinux: {
        // Ctrl+Shift: B D G J M N O R T W, and P (refused by Chromium 149).
        // Alt+Shift: A I N T, and B C P R W X Z (refused by Chromium 149).
        chrome: [
            "Ctrl+Shift+B", "Ctrl+Shift+D", "Ctrl+Shift+G", "Ctrl+Shift+J", "Ctrl+Shift+M", "Ctrl+Shift+N",
            "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+R", "Ctrl+Shift+T", "Ctrl+Shift+W",
            "Alt+Shift+A", "Alt+Shift+B", "Alt+Shift+C", "Alt+Shift+I", "Alt+Shift+N", "Alt+Shift+P",
            "Alt+Shift+R", "Alt+Shift+T", "Alt+Shift+W", "Alt+Shift+X", "Alt+Shift+Z",
        ],
        // Ctrl+Shift: B D E G I K L M N O P R T U V W Y.
        // Alt+Shift: B I T, and A C P R W X Z (refused by Edge 158).
        edge: [
            "Ctrl+Shift+B", "Ctrl+Shift+D", "Ctrl+Shift+E", "Ctrl+Shift+G", "Ctrl+Shift+I", "Ctrl+Shift+K",
            "Ctrl+Shift+L", "Ctrl+Shift+M", "Ctrl+Shift+N", "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+R",
            "Ctrl+Shift+T", "Ctrl+Shift+U", "Ctrl+Shift+V", "Ctrl+Shift+W", "Ctrl+Shift+Y",
            "Alt+Shift+A", "Alt+Shift+B", "Alt+Shift+C", "Alt+Shift+I", "Alt+Shift+P", "Alt+Shift+R",
            "Alt+Shift+T", "Alt+Shift+W", "Alt+Shift+X", "Alt+Shift+Z",
        ],
        // Ctrl+Shift: A (add-ons) B C D E G H I J K M N O P Q R S (screenshot) T W X Y Z. No Alt+Shift letters.
        firefox: [
            "Ctrl+Shift+A", "Ctrl+Shift+B", "Ctrl+Shift+C", "Ctrl+Shift+D", "Ctrl+Shift+E", "Ctrl+Shift+G",
            "Ctrl+Shift+H", "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+K", "Ctrl+Shift+M", "Ctrl+Shift+N",
            "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+Q", "Ctrl+Shift+R", "Ctrl+Shift+S", "Ctrl+Shift+T",
            "Ctrl+Shift+W", "Ctrl+Shift+X", "Ctrl+Shift+Y", "Ctrl+Shift+Z",
        ],
    },
    mac: {
        // Command+Shift: B D G H I J M N R T W. No Control+Shift letters.
        chrome: [
            "Command+Shift+B", "Command+Shift+D", "Command+Shift+G", "Command+Shift+H", "Command+Shift+I",
            "Command+Shift+J", "Command+Shift+M", "Command+Shift+N", "Command+Shift+R", "Command+Shift+T",
            "Command+Shift+W",
        ],
        // Command+Shift: B C D E G H M N R T U V W. No Control+Shift letters.
        edge: [
            "Command+Shift+B", "Command+Shift+C", "Command+Shift+D", "Command+Shift+E", "Command+Shift+G",
            "Command+Shift+H", "Command+Shift+M", "Command+Shift+N", "Command+Shift+R", "Command+Shift+T",
            "Command+Shift+U", "Command+Shift+V", "Command+Shift+W",
        ],
        // Command+Shift: A B D F G H N O P R S T W X. Control+Shift only with digits (3, 4, 6) and Tab.
        firefox: [
            "Command+Shift+A", "Command+Shift+B", "Command+Shift+D", "Command+Shift+F", "Command+Shift+G",
            "Command+Shift+H", "Command+Shift+N", "Command+Shift+O", "Command+Shift+P", "Command+Shift+R",
            "Command+Shift+S", "Command+Shift+T", "Command+Shift+W", "Command+Shift+X",
            "MacCtrl+Shift+3", "MacCtrl+Shift+4", "MacCtrl+Shift+6",
        ],
    },
};

/** The `commands` manifest entry's `suggested_key` for one save command. */
export function suggestedKeyFor(command: keyof typeof COMMAND_SHORTCUTS): SuggestedKey {
    const { default: def, mac } = COMMAND_SHORTCUTS[command];
    return { default: def, mac };
}
