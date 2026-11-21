'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, X, ZoomIn } from 'lucide-react'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { FigureOverlays } from '@/components/blog/FigureOverlays'
import { LensOptions } from '@/components/blog/LensOptions'
import type { NumberedBox } from '@/lib/blog/figures'
import {
  DEFAULT_LENS_PREFS,
  LENS_PANEL_MIN_WIDTH_REM,
  parseLensPrefs,
  readLensPrefsRaw,
  writeLensPrefs,
  type LensPrefs,
} from '@/lib/blog/lensPrefs'
import { cn } from '@/lib/utils'
import { mediaMatches, onMediaChange } from '@/lib/blog/media'

/** What the lightbox and the hover lens need to show one figure. */
export interface ZoomFigure {
  figure?: number
  /** One image, or a light and a dark version (`ThemedScreenshot`). */
  src: string | { light: string; dark: string }
  alt: string | { light: string; dark: string }
  width: number
  height: number
  boxes: readonly NumberedBox[]
  caption?: ReactNode
  source?: string
}

interface LightboxApi {
  register: (trigger: HTMLElement, figure: ZoomFigure) => () => void
  open: (trigger: HTMLElement) => void
  lensEnter: (trigger: HTMLElement, event: ReactPointerEvent) => void
  lensMove: (event: ReactPointerEvent) => void
  lensLeave: () => void
}

const LightboxContext = createContext<LightboxApi | null>(null)

// Lens preferences: an external store over localStorage, shared by every figure's menu.
const prefListeners = new Set<() => void>()
const subscribePrefs = (cb: () => void) => {
  prefListeners.add(cb)
  return () => {
    prefListeners.delete(cb)
  }
}
const panelQuery = `(min-width: ${LENS_PANEL_MIN_WIDTH_REM}rem)`
const subscribeWidth = (cb: () => void) => onMediaChange(panelQuery, cb)

interface LensPrefsApi {
  prefs: LensPrefs
  setPrefs: (prefs: LensPrefs) => void
  /** The side panel is offered from 80rem of viewport only. */
  panelAvailable: boolean
}

/** The reader's magnifier shape and zoom (defaults on the server and before hydration). */
export function useLensPrefs(): LensPrefsApi {
  const raw = useSyncExternalStore(subscribePrefs, readLensPrefsRaw, () => null)
  const panelAvailable = useSyncExternalStore(subscribeWidth, () => mediaMatches(panelQuery), () => false)
  const stored = parseLensPrefs(raw)
  return {
    prefs: stored.shape === 'panel' && !panelAvailable ? { ...stored, shape: 'wide' } : stored,
    setPrefs: (prefs) => {
      writeLensPrefs(prefs)
      prefListeners.forEach((cb) => cb())
    },
    panelAvailable,
  }
}

/** Each lens shape's size in rem (the side panel takes the figure's height). */
const LENS_SIZE = { wide: { w: 26, h: 15 }, circle: { w: 16, h: 16 }, panel: { w: 28, h: 0 } } as const

/** The open figure, worked out when it is opened or stepped to (never from refs during render). */
interface LightboxView {
  trigger: HTMLElement
  entry: ZoomFigure
  /** Position among the figures shown in the article, and how many there are. */
  index: number
  count: number
  /** The highest figure number shown (the "of N"). */
  total: number
}

/** The view-transition name the thumbnail and the enlarged image share while morphing. */
const MORPH = 'blog-figure-zoom'

/** `#figure-3`: the address of an open figure (Back closes it; a link opens it). */
const FIGURE_HASH = /^#figure-(\d+)$/

/** How long the pointer rests on a figure before the lens shows. */
const LENS_DELAY_MS = 120

const reducedMotion = () => mediaMatches('(prefers-reduced-motion: reduce)')

/** View Transitions, when the browser has them and the reader hasn't asked for less motion. */
function canMorph(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && !reducedMotion()
}

/** A mouse or trackpad that can hover (the lens is for those only; touch taps open the lightbox). */
const finePointer = () => mediaMatches('(hover: hover) and (pointer: fine)')

/** A trigger the reader can see now (not in a hidden browser panel). */
function isShown(el: HTMLElement): boolean {
  return !el.closest('[hidden]') && el.getClientRects().length > 0
}

/**
 * Enlarges the post's figures.
 *
 * - **Lightbox:** a native modal `<dialog>` (focus stays inside, Escape closes, focus returns to the
 *   image that opened it, the page keeps its scroll position), with the annotation boxes in place,
 *   the caption and the figure number. "Back to article" and Close, a click on the backdrop, and
 *   the browser's Back button all close it: opening pushes `#figure-N`, and a link to `#figure-N`
 *   opens that figure after load. Previous / Next (and the arrow keys) step through the figures
 *   shown in the article; "Actual size" shows the image at its natural width, scrolled to pan,
 *   with pinch zoom left on. Opening and closing morph from the thumbnail with View Transitions
 *   when available and motion isn't reduced; otherwise they are instant.
 * - **Lens:** with a mouse or trackpad, resting on a figure shows a round 2× magnifier that
 *   follows the pointer, markers included. One element for the page, `aria-hidden`, never in the
 *   way of a click, moved with transforms on animation frames.
 */
export function FigureLightbox({ children }: { children: ReactNode }) {
  const t = useTranslations('blog.interactive')
  const { screenshotTheme } = useBlogPostState()
  const registry = useRef(new Map<HTMLElement, ZoomFigure>())
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<LightboxView | null>(null)
  const [actualSize, setActualSize] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const pushedHash = useRef(false)
  const savedScroll = useRef(0)

  const register = useCallback((trigger: HTMLElement, figure: ZoomFigure) => {
    registry.current.set(trigger, figure)
    return () => {
      registry.current.delete(trigger)
    }
  }, [])

  /** The figures shown in the article, in document order. */
  const shownTriggers = useCallback(
    () =>
      [...registry.current.keys()]
        .filter(isShown)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)),
    []
  )

  const pick = useCallback(
    <T,>(value: T | { light: T; dark: T }): T =>
      typeof value === 'object' && value !== null && 'light' in value ? value[screenshotTheme] : (value as T),
    [screenshotTheme]
  )

  // ── Lens ──────────────────────────────────────────────────────────────────────────────────
  const lens = useRef<HTMLDivElement>(null)
  const lensInner = useRef<HTMLDivElement>(null)
  const [lensFigure, setLensFigure] = useState<{ figure: ZoomFigure; width: number; height: number } | null>(null)
  const lensTrigger = useRef<HTMLElement | null>(null)
  const lensTimer = useRef<number | undefined>(undefined)
  const lensFrame = useRef<number | undefined>(undefined)
  const pointer = useRef({ x: 0, y: 0 })
  const outline = useRef<HTMLDivElement>(null)
  const { prefs: lensPrefs } = useLensPrefs()
  const lensPrefsRef = useRef<LensPrefs>(DEFAULT_LENS_PREFS)
  useEffect(() => {
    lensPrefsRef.current = lensPrefs
  }, [lensPrefs])

  const placeLens = useCallback(() => {
    lensFrame.current = undefined
    const trigger = lensTrigger.current
    const el = lens.current
    const inner = lensInner.current
    if (!trigger || !el || !inner) return
    const { shape, zoom } = lensPrefsRef.current
    const rect = trigger.getBoundingClientRect()
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const margin = 8
    const { x, y } = pointer.current
    let width = Math.min(LENS_SIZE[shape].w * rem, window.innerWidth - 2 * margin)
    let height = Math.min(LENS_SIZE[shape].h * rem, window.innerHeight - 2 * margin)
    let left: number
    let top: number
    if (shape === 'panel') {
      // Beside the figure, on the side with more room, as tall as the figure (within the viewport).
      height = Math.min(rect.height, window.innerHeight - 2 * margin)
      const roomEnd = window.innerWidth - rect.right
      const roomStart = rect.left
      width = Math.min(width, Math.max(roomEnd, roomStart) - 2 * margin)
      left = roomEnd >= roomStart ? rect.right + margin : rect.left - margin - width
      top = Math.min(Math.max(rect.top, margin), window.innerHeight - height - margin)
    } else {
      // Centred on the pointer, kept inside the viewport near its edges.
      left = Math.min(Math.max(x - width / 2, margin), window.innerWidth - width - margin)
      top = Math.min(Math.max(y - height / 2, margin), window.innerHeight - height - margin)
    }
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.style.transform = `translate(${left}px, ${top}px)`
    // The magnified image, moved so the spot under the pointer sits in the lens centre.
    const dx = (x - rect.left) * zoom
    const dy = (y - rect.top) * zoom
    inner.style.width = `${rect.width * zoom}px`
    inner.style.transform = `translate(${width / 2 - dx}px, ${height / 2 - dy}px)`
    // Side panel: a thin outline on the figure marks the area being magnified.
    const box = outline.current
    if (box) {
      const w = width / zoom
      const h = height / zoom
      box.style.width = `${w}px`
      box.style.height = `${h}px`
      box.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px)`
    }
  }, [])

  const lensLeave = useCallback(() => {
    window.clearTimeout(lensTimer.current)
    if (lensFrame.current) cancelAnimationFrame(lensFrame.current)
    lensFrame.current = undefined
    lensTrigger.current = null
    setLensFigure(null)
  }, [])

  const lensEnter = useCallback(
    (trigger: HTMLElement, event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse' || !finePointer() || dialog.current?.open) return
      pointer.current = { x: event.clientX, y: event.clientY }
      lensTrigger.current = trigger
      window.clearTimeout(lensTimer.current)
      lensTimer.current = window.setTimeout(() => {
        const figure = registry.current.get(trigger)
        if (!figure || lensTrigger.current !== trigger) return
        const rect = trigger.getBoundingClientRect()
        setLensFigure({ figure, width: rect.width, height: rect.height })
      }, LENS_DELAY_MS)
    },
    []
  )

  const lensMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!lensTrigger.current) return
      pointer.current = { x: event.clientX, y: event.clientY }
      if (lensFrame.current === undefined) lensFrame.current = requestAnimationFrame(placeLens)
    },
    [placeLens]
  )

  // Placed as soon as it renders; hidden on scroll and Escape while it shows.
  useEffect(() => {
    if (!lensFigure) return
    placeLens()
    const hide = () => lensLeave()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') lensLeave()
    }
    window.addEventListener('scroll', hide, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide)
      window.removeEventListener('keydown', onKey)
    }
  }, [lensFigure, placeLens, lensLeave])

  // ── Lightbox ──────────────────────────────────────────────────────────────────────────────
  const lockScroll = () => {
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingInlineEnd = `${gap}px`
  }
  const unlockScroll = () => {
    document.body.style.overflow = ''
    document.body.style.paddingInlineEnd = ''
  }

  const figureNumberOf = useCallback(
    (trigger: HTMLElement) => registry.current.get(trigger)?.figure ?? shownTriggers().indexOf(trigger) + 1,
    [shownTriggers]
  )

  const viewFor = useCallback(
    (trigger: HTMLElement): LightboxView | null => {
      const entry = registry.current.get(trigger)
      if (!entry) return null
      const list = shownTriggers()
      const total = list.reduce((max, el) => Math.max(max, registry.current.get(el)?.figure ?? 0), 0)
      return { trigger, entry, index: list.indexOf(trigger), count: list.length, total: Math.max(total, list.length) }
    },
    [shownTriggers]
  )

  const open = useCallback(
    (trigger: HTMLElement, { push = true }: { push?: boolean } = {}) => {
      lensLeave()
      opener.current = trigger
      savedScroll.current = window.scrollY
      if (push) {
        history.pushState(history.state, '', `#figure-${figureNumberOf(trigger)}`)
        pushedHash.current = true
      }
      const show = () => {
        flushSync(() => {
          setView(viewFor(trigger))
          setActualSize(false)
        })
        if (!dialog.current?.open) dialog.current?.showModal()
        lockScroll()
      }
      if (!canMorph()) return show()
      trigger.style.viewTransitionName = MORPH
      const transition = document.startViewTransition(() => {
        trigger.style.viewTransitionName = ''
        show()
        if (frame.current) frame.current.style.viewTransitionName = MORPH
      })
      transition.finished.finally(() => {
        if (frame.current) frame.current.style.viewTransitionName = ''
      })
    },
    [figureNumberOf, lensLeave, viewFor]
  )

  /** Closes the dialog itself (with the morph when possible); `onClose` restores the page. */
  const closeDialog = useCallback(() => {
    const trigger = opener.current
    if (!dialog.current?.open) return
    if (!canMorph() || !trigger || !isShown(trigger) || !frame.current) {
      dialog.current.close()
      return
    }
    frame.current.style.viewTransitionName = MORPH
    const transition = document.startViewTransition(() => {
      if (frame.current) frame.current.style.viewTransitionName = ''
      dialog.current?.close()
      trigger.style.viewTransitionName = MORPH
    })
    transition.finished.finally(() => {
      trigger.style.viewTransitionName = ''
    })
  }, [])

  /** Back to article, Close, Escape, backdrop: undo our history entry, which closes it (popstate). */
  const close = () => {
    if (pushedHash.current) {
      history.back()
      return
    }
    if (FIGURE_HASH.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search)
    closeDialog()
  }

  // The browser's Back (or our history.back()) leaves #figure-N: close.
  useEffect(() => {
    const onPop = () => {
      if (!dialog.current?.open || FIGURE_HASH.test(location.hash)) return
      pushedHash.current = false
      closeDialog()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [closeDialog])

  // A link to #figure-N opens that figure once the figures have registered.
  useEffect(() => {
    const match = FIGURE_HASH.exec(location.hash)
    if (!match) return
    const id = window.setTimeout(() => {
      const n = Number(match[1])
      const trigger = shownTriggers().find((el) => figureNumberOf(el) === n)
      if (trigger) open(trigger, { push: false })
    }, 0)
    return () => window.clearTimeout(id)
  }, [open, shownTriggers, figureNumberOf])

  // Fires however the dialog closed: restore the page, its scroll position and focus.
  const onClose = () => {
    unlockScroll()
    setView(null)
    const trigger = opener.current
    opener.current = null
    pushedHash.current = false
    window.scrollTo({ top: savedScroll.current, behavior: 'instant' })
    trigger?.focus({ preventScroll: true })
  }

  useEffect(() => () => unlockScroll(), [])

  const entry = view?.entry
  const index = view?.index ?? -1

  const step = (delta: number) => {
    if (!view) return
    const next = shownTriggers()[view.index + delta]
    if (!next) return
    opener.current = next
    setView(viewFor(next))
    setActualSize(false)
    history.replaceState(history.state, '', `#figure-${figureNumberOf(next)}`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    // Arrow keys inside the scroll area pan the actual-size image instead.
    if ((event.target as HTMLElement).closest('[data-lightbox-scroll]') && actualSize) return
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = (event.key === 'ArrowRight') !== rtl
    event.preventDefault()
    step(forward ? 1 : -1)
  }

  // A click on the dark backdrop (outside the image, caption and toolbar) closes.
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if ((event.target as HTMLElement).hasAttribute('data-lightbox-backdrop')) close()
  }

  const iconButton =
    'inline-flex size-11 items-center justify-center text-white transition-colors hover:bg-white/15 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

  return (
    <LightboxContext.Provider value={{ register, open, lensEnter, lensMove, lensLeave }}>
      {children}

      {/* The hover lens: one per page, a visual aid only. */}
      <div
        ref={lens}
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed left-0 top-0 z-40 overflow-hidden border-2 border-foreground bg-background shadow-sh3',
          lensPrefs.shape === 'circle' ? 'rounded-full' : 'rounded-xl',
          'transition-opacity duration-150 motion-reduce:transition-none',
          lensFigure ? 'opacity-100' : 'invisible opacity-0'
        )}
      >
        {lensFigure && (
          <div ref={lensInner} className="absolute left-0 top-0 origin-top-left">
            {/* Same file as the thumbnail (already loaded): no extra request. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a magnified copy of a capture already on the page */}
            <img
              src={pick(lensFigure.figure.src)}
              alt=""
              width={lensFigure.figure.width}
              height={lensFigure.figure.height}
              className="block h-auto w-full max-w-none"
            />
            <FigureOverlays boxes={lensFigure.figure.boxes} large />
          </div>
        )}
      </div>

      {/* Side panel only: the area being magnified, outlined on the figure. */}
      <div
        ref={outline}
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed left-0 top-0 z-30 border border-foreground',
          lensFigure && lensPrefs.shape === 'panel' ? '' : 'invisible'
        )}
      />

      <dialog
        ref={dialog}
        aria-labelledby="blog-lightbox-title"
        data-lightbox-backdrop=""
        onClose={onClose}
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onKeyDown={onKeyDown}
        onClick={onDialogClick}
        className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none bg-black/90 p-0 text-white backdrop:bg-black/70"
      >
        {entry && (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-1 px-2 py-2">
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
                {t('backToArticle')}
              </button>
              <p id="blog-lightbox-title" className="me-auto ms-2 text-sm text-white/85">
                {t('figureOf', { n: entry.figure ?? index + 1, total: view?.total ?? 1 })}
              </p>
              <button
                type="button"
                aria-pressed={actualSize}
                onClick={() => setActualSize((v) => !v)}
                className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Maximize2 aria-hidden="true" className="size-4" />
                {t('actualSize')}
              </button>
              <button type="button" aria-label={t('previous')} onClick={() => step(-1)} disabled={index <= 0} className={iconButton}>
                <ChevronLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                aria-label={t('next')}
                onClick={() => step(1)}
                disabled={!view || index >= view.count - 1}
                className={iconButton}
              >
                <ChevronRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              </button>
              <button type="button" aria-label={t('close')} onClick={close} className={iconButton}>
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            {/* Focusable so the keyboard can pan an actual-size image; pinch zoom is left on. */}
            <div
              data-lightbox-scroll=""
              data-lightbox-backdrop=""
              tabIndex={0}
              className="min-h-0 flex-1 overflow-auto [touch-action:pinch-zoom] focus-visible:outline-2 focus-visible:outline-white"
            >
              <div data-lightbox-backdrop="" className={cn('p-4', actualSize ? 'w-max' : 'flex h-full items-center justify-center')}>
                <div ref={frame} className="relative inline-block bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised capture, shown at its own size */}
                  <img
                    src={pick(entry.src)}
                    alt={pick(entry.alt)}
                    width={entry.width}
                    height={entry.height}
                    className={cn('block', actualSize ? 'max-w-none' : 'h-auto max-h-[calc(100dvh-11rem)] w-auto max-w-full')}
                    style={actualSize ? { width: entry.width, height: 'auto' } : undefined}
                  />
                  <FigureOverlays boxes={entry.boxes} large />
                </div>
              </div>
            </div>
            {(entry.caption || entry.source) && (
              <div className="max-h-[30dvh] overflow-y-auto px-4 pb-4 pt-2 text-sm leading-normal text-white/85 [&_.text-foreground]:text-white [&_code]:bg-white/15 [&_code]:text-white">
                {entry.caption}
                {entry.source && <span className="mt-1 block font-mono text-xs text-white/70">{entry.source}</span>}
              </div>
            )}
          </div>
        )}
      </dialog>
    </LightboxContext.Provider>
  )
}

/**
 * A figure's interactive image: the button around the image (and its overlays) that opens the
 * lightbox, named "Enlarge: <alt>", plus, with a mouse or trackpad, the magnifier controls above
 * its top-end corner: a "Magnifier" toggle (off by default, per figure, not remembered) and the
 * shape/zoom options next to it (remembered for every figure). With the toggle on, the lens follows
 * the pointer over this figure; Escape turns it off. Outside a lightbox (a figure rendered on its
 * own) it's a plain wrapper.
 */
export function ZoomTrigger({ figure, children }: { figure: ZoomFigure; children: ReactNode }) {
  const t = useTranslations('blog.interactive')
  const lightbox = useContext(LightboxContext)
  const ref = useRef<HTMLButtonElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const [lensOn, setLensOn] = useState(false)

  useEffect(() => {
    if (!lightbox || !ref.current) return
    return lightbox.register(ref.current, figure)
  }, [lightbox, figure])

  // Escape while this figure is hovered or focused turns its magnifier off.
  useEffect(() => {
    if (!lensOn || !lightbox) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const el = area.current
      if (!el || !(el.matches(':hover') || el.contains(document.activeElement))) return
      setLensOn(false)
      lightbox.lensLeave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lensOn, lightbox])

  if (!lightbox) return <div className="relative">{children}</div>
  const alt = typeof figure.alt === 'string' ? figure.alt : figure.alt.light
  const toggle = () => {
    if (lensOn) lightbox.lensLeave()
    setLensOn(!lensOn)
  }
  return (
    <div ref={area}>
      {/* Mouse and trackpad only, like the lens itself; touch taps open the lightbox. */}
      <div className="hidden justify-end pb-1.5 pointer-fine:flex">
        <div className="inline-flex border border-border2 bg-background">
          <button
            type="button"
            aria-pressed={lensOn}
            aria-label={t('lensToggle')}
            title={lensOn ? t('lensOff') : t('lensOn')}
            onClick={toggle}
            className={cn(
              'inline-flex size-9 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              lensOn ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-surface3'
            )}
          >
            <ZoomIn aria-hidden="true" className="size-4" />
          </button>
          <LensOptions />
        </div>
      </div>
      <button
        ref={ref}
        type="button"
        aria-label={t('enlarge', { alt })}
        onClick={() => ref.current && lightbox.open(ref.current)}
        onPointerEnter={(event) => lensOn && ref.current && lightbox.lensEnter(ref.current, event)}
        onPointerMove={lensOn ? lightbox.lensMove : undefined}
        onPointerLeave={lightbox.lensLeave}
        className="relative block w-full cursor-zoom-in p-0 text-start shadow-sh3 ring-1 ring-border2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
      </button>
    </div>
  )
}
