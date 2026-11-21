import Image from 'next/image'
import type { CardCover } from '@/lib/blog/cover'
import { cn } from '@/lib/utils'

/**
 * A card's cover, whole and sharp inside its 4:3 frame (the parent: `relative overflow-hidden`, a
 * `group` card): `object-contain` on the frame's surface, never cropped or zoomed. On card hover or
 * focus it grows by 3% inside the frame, except with reduced motion. Without a cover the frame
 * shows the TabMerger mark.
 *
 * With a dark version both images are in the HTML and CSS picks one (`dark:`), like the post's
 * ThemedScreenshot: the server HTML is right for either theme, so nothing swaps on load, and a
 * `display: none` lazy image isn't fetched.
 */
export function CoverImage({ cover, eager = false, sizes }: { cover: CardCover | null; eager?: boolean; sizes: string }) {
  if (!cover) {
    return (
      <div data-cover-placeholder="" className="absolute inset-0 flex items-center justify-center">
        <Image unoptimized src="/logo.png" alt="" width={64} height={64} className="size-16 opacity-60" />
      </div>
    )
  }
  const image = (src: string, theme?: 'light' | 'dark') => (
    <Image
      key={src}
      unoptimized
      src={src}
      alt=""
      fill
      sizes={sizes}
      // Both theme versions are lazy so the hidden one isn't fetched; the featured cover asks for
      // its image first.
      loading={eager && !cover.srcDark ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      data-cover-theme={theme}
      className={cn(
        'object-contain motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out',
        'motion-safe:group-hover:scale-[1.03] motion-safe:group-focus-within:scale-[1.03]',
        theme === 'light' && 'dark:hidden',
        theme === 'dark' && 'hidden dark:block'
      )}
    />
  )
  if (!cover.srcDark) return image(cover.src)
  return (
    <>
      {image(cover.src, 'light')}
      {image(cover.srcDark, 'dark')}
    </>
  )
}
