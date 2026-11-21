'use client'

import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLensPrefs } from '@/components/blog/FigureLightbox'
import { LENS_SHAPES, LENS_ZOOMS, type LensShape } from '@/lib/blog/lensPrefs'

const SHAPE_LABEL = { wide: 'lensWide', circle: 'lensCircle', panel: 'lensPanel' } as const satisfies Record<LensShape, string>

/**
 * "Magnifier options", the chevron half of a figure's magnifier split button: the lens shape and
 * zoom, for every figure on the page (kept in localStorage). Built on the site's dropdown menu
 * (radio groups, keyboard, Escape).
 */
export function LensOptions() {
  const t = useTranslations('blog.interactive')
  const { prefs, setPrefs, panelAvailable } = useLensPrefs()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('lensOptions')}
        title={t('lensOptions')}
        className="inline-flex h-9 w-7 items-center justify-center border-s border-border2 text-foreground transition-colors hover:bg-surface3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-surface3"
      >
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{t('lensShape')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={prefs.shape} onValueChange={(shape) => setPrefs({ ...prefs, shape: shape as LensShape })}>
          {LENS_SHAPES.filter((shape) => shape !== 'panel' || panelAvailable).map((shape) => (
            <DropdownMenuRadioItem key={shape} value={shape}>
              {t(SHAPE_LABEL[shape])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('lensZoom')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(prefs.zoom)}
          onValueChange={(zoom) => setPrefs({ ...prefs, zoom: Number(zoom) as (typeof LENS_ZOOMS)[number] })}
        >
          {LENS_ZOOMS.map((zoom) => (
            <DropdownMenuRadioItem key={zoom} value={String(zoom)}>
              {t('lensZoomValue', { zoom })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
