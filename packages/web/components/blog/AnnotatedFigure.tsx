import type { ReactNode } from 'react'
import Image from 'next/image'
import { FigureFrame } from '@/components/blog/FigureFrame'
import type { PostBox } from '@/lib/blog/figures'

/**
 * A numbered screenshot with annotation boxes and a caption (the caption is the children, so it can hold
 * inline markdown such as `**④**` or code). The captures are already-optimised WebP files under
 * `public/blog/<slug>/`, so they are served as they are (`unoptimized`), with their real width and
 * height to reserve the space. Lazy unless `eager` (the post's first image).
 */
export function AnnotatedFigure({
  src,
  alt,
  width,
  height,
  boxes,
  figure,
  source,
  eager = false,
  small = false,
  className,
  children,
}: {
  src: string
  alt: string
  width: number
  height: number
  boxes?: readonly PostBox[]
  /** Set by rehype-figure-numbers.mjs; never written in a post. */
  figure?: number | string
  source?: string
  eager?: boolean
  small?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <FigureFrame
      className={className ?? 'mb-5'}
      boxes={boxes}
      figure={figure}
      zoom={{ src, alt, width, height }}
      source={source}
      small={small}
      caption={children}
      image={
        <Image
          unoptimized
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          className="block h-auto w-full"
        />
      }
    />
  )
}
