/**
 * The figure magnifier's shape and zoom, chosen by the reader for every figure and kept per
 * browser in localStorage. Reads and writes never throw: storage that is unavailable (privacy
 * modes, blocked cookies) or holds junk just gives the defaults.
 */
export const LENS_SHAPES = ['wide', 'circle', 'panel'] as const
export type LensShape = (typeof LENS_SHAPES)[number]

export const LENS_ZOOMS = [1.5, 1.75, 2.5] as const
export type LensZoom = (typeof LENS_ZOOMS)[number]

export interface LensPrefs {
  shape: LensShape
  zoom: LensZoom
}

export const DEFAULT_LENS_PREFS: LensPrefs = { shape: 'wide', zoom: 1.75 }

export const LENS_PREFS_KEY = 'tabmerger-blog-lens'

/** The side panel needs room beside the article: offered from 80rem (1280px) of viewport. */
export const LENS_PANEL_MIN_WIDTH_REM = 80

/** Parses a stored value; anything unexpected falls back to the defaults, field by field. */
export function parseLensPrefs(raw: string | null | undefined): LensPrefs {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<Record<keyof LensPrefs, unknown>>) : {}
    const shape = LENS_SHAPES.find((s) => s === value.shape) ?? DEFAULT_LENS_PREFS.shape
    const zoom = LENS_ZOOMS.find((z) => z === value.zoom) ?? DEFAULT_LENS_PREFS.zoom
    return { shape, zoom }
  } catch {
    return DEFAULT_LENS_PREFS
  }
}

export function readLensPrefsRaw(): string | null {
  try {
    return window.localStorage.getItem(LENS_PREFS_KEY)
  } catch {
    return null
  }
}

export function writeLensPrefs(prefs: LensPrefs): void {
  try {
    window.localStorage.setItem(LENS_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the choice lasts until the page is left.
  }
}
