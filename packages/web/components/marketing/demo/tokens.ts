// Design tokens copied from packages/extension/src/styles/globals.css —
// the web package doesn't share the extension's CSS variables, so computed
// light/dark values are hardcoded here rather than guessed.

export const ZONE_BG = '#F7F7F8'
export const ZONE_BG_DARK = '#16181D'
export const ZONE_BORDER = 'rgba(0,0,0,0.08)'
export const ZONE_BORDER_DARK = 'rgba(255,255,255,0.08)'
export const SIDEBAR_HOVER_BG = 'rgba(0,0,0,0.05)'
export const SIDEBAR_HOVER_BG_DARK = 'rgba(255,255,255,0.07)'
export const SIDEBAR_BADGE_BG = 'rgba(0,0,0,0.07)'
export const SIDEBAR_BADGE_BG_DARK = 'rgba(255,255,255,0.1)'
export const SIDEBAR_TEXT_ACTIVE = '#111827'
export const SIDEBAR_TEXT_ACTIVE_DARK = '#FFFFFF'
export const SIDEBAR_TEXT_INACTIVE = '#374151'
export const SIDEBAR_TEXT_INACTIVE_DARK = '#C4C7CC'
export const SIDEBAR_TEXT_MUTED = '#6B7280'
export const SIDEBAR_TEXT_MUTED_DARK = '#9CA3AF'
export const SIDEBAR_TEXT_SUBTLE = '#767C88'
export const SIDEBAR_TEXT_SUBTLE_DARK = '#8B919A'
export const BORDER = '#E5E7EB'
export const BORDER_DARK = '#282d38'

// Copied verbatim from packages/extension/src/components/Windows/Tab.tsx
export const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E"
