'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, Mail, Share2 } from 'lucide-react'
import { BrandIcon } from '@/components/blog/shareIcons'
import { copyText } from '@/lib/blog/clipboard'
import {
  COPY_FIRST,
  PLATFORM_NAME,
  SHARE_PLATFORMS,
  emailBody,
  shareLinks,
  shareText,
  type ShareContent,
  type SharePlatform,
} from '@/lib/blog/share'
import { cn } from '@/lib/utils'

const MENU_ID = 'blog-share-menu'

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2.5 px-3 text-start text-[0.9375rem] text-foreground no-underline hover:bg-surface3 focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-ring'

/** Each platform's `blog.interactive` label key. */
const LABEL = {
  x: 'shareX',
  linkedIn: 'shareLinkedIn',
  facebook: 'shareFacebook',
  reddit: 'shareReddit',
  bluesky: 'shareBluesky',
  threads: 'shareThreads',
  whatsApp: 'shareWhatsApp',
  telegram: 'shareTelegram',
  email: 'shareEmail',
} as const satisfies Record<SharePlatform, string>

const subscribeNever = () => () => {}
/** The system share sheet (phones, some desktops); false on the server and while hydrating. */
const useCanShareNatively = () =>
  useSyncExternalStore(
    subscribeNever,
    () => typeof navigator.share === 'function',
    () => false
  )

/**
 * Share: the system share sheet where there is one ("Share…"), copy the link, then X, LinkedIn,
 * Facebook, Reddit, Bluesky, Threads, WhatsApp, Telegram and email, each opening its composer with
 * the whole post text in it (lib/blog/share.ts). Plain links (no third-party script), each with
 * the platform's own mark.
 *
 * LinkedIn, Reddit and Facebook may drop the prefilled text (`COPY_FIRST`): a click there copies
 * the text first, in the click itself (so the browser still counts it as the reader's action),
 * then opens the composer and says "Post text copied: paste it into <Platform>".
 *
 * A disclosure: the list exists only while open (`aria-controls` names it then), Escape with
 * focus inside closes it and returns focus to the button, as does a click outside. Results go to
 * the article bar's live region; when the clipboard is refused, a read-only field with the link
 * (or the post text) is shown and selected so it can be copied by hand.
 */
export function ShareMenu({ content, announce }: { content: ShareContent; announce: (message: string) => void }) {
  const t = useTranslations('blog.interactive')
  const [open, setOpen] = useState(false)
  // What to show in the read-only fallback field when the clipboard is refused.
  const [manual, setManual] = useState<{ label: string; value: string } | null>(null)
  const canShare = useCanShareNatively()
  const container = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const { url, title } = content
  const strings = {
    readGuide: t('shareReadGuide', { url }),
    about: t('shareAbout'),
    download: t('shareDownload', { url: content.downloadUrl }),
    webApp: t('shareWebApp', { url: content.origin }),
    github: t('shareGitHub', { url: content.githubUrl }),
    redditFooter: t('shareRedditFooter', { download: content.downloadUrl, github: content.githubUrl }),
  }
  const links = shareLinks(content, strings)

  const close = (refocus = true) => {
    setOpen(false)
    setManual(null)
    if (refocus) toggle.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      if (active && active !== document.body && !container.current?.contains(active)) return
      setOpen(false)
      setManual(null)
      toggle.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false)
        setManual(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  // Selects the fallback field once it's on screen (a DOM call, not state).
  useEffect(() => {
    if (!manual) return
    field.current?.focus()
    field.current?.select()
  }, [manual])

  const copy = async () => {
    if (!(await copyText(url))) {
      setManual({ label: t('shareLink'), value: url })
      announce(t('copyFailed', { url }))
      return
    }
    close()
    announce(t('copied'))
  }

  /**
   * LinkedIn, Reddit, Facebook: start the clipboard write and open the composer in the same click
   * (both need the reader's action), then report. The composer opens either way.
   */
  const copyThenOpen = (event: MouseEvent<HTMLAnchorElement>, platform: SharePlatform) => {
    event.preventDefault()
    const text = shareText(platform, content, strings)
    const copied = copyText(text)
    window.open(links[platform], '_blank', 'noopener,noreferrer')
    void copied.then((ok) => {
      if (ok) {
        close(false)
        announce(t('textCopied', { platform: PLATFORM_NAME[platform] }))
      } else {
        setManual({ label: t('shareText'), value: text })
        announce(t('textCopyFailed', { platform: PLATFORM_NAME[platform] }))
      }
    })
  }

  const shareNatively = async () => {
    try {
      await navigator.share({ title, text: emailBody(content, strings), url })
      close()
    } catch {
      // Dismissed by the reader, or refused: the menu stays open with the other options.
    }
  }

  return (
    <div ref={container} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 border border-border bg-transparent px-3.5 text-[0.9375rem] text-foreground transition-colors hover:bg-surface3',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
        )}
      >
        <Share2 aria-hidden="true" className="size-4" />
        <span>{t('share')}</span>
      </button>
      {open && (
        <div
          id={MENU_ID}
          className="absolute end-0 top-[calc(100%+0.375rem)] z-20 w-60 max-w-[calc(100vw-3rem)] border border-border bg-popover p-1.5 shadow-sh2"
        >
          <ul aria-label={t('shareMenu')} className="m-0 list-none p-0">
            {canShare && (
              <li>
                <button type="button" onClick={shareNatively} className={ITEM_CLASS}>
                  <Share2 aria-hidden="true" className="size-4 shrink-0" />
                  {t('shareNative')}
                </button>
              </li>
            )}
            <li>
              <button type="button" onClick={copy} className={ITEM_CLASS}>
                <Link2 aria-hidden="true" className="size-4 shrink-0" />
                {t('copyLink')}
              </button>
            </li>
            {SHARE_PLATFORMS.map((platform) => (
              <li key={platform}>
                <a
                  href={links[platform]}
                  {...(platform === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  onClick={(event) => (COPY_FIRST.has(platform) ? copyThenOpen(event, platform) : close(false))}
                  className={ITEM_CLASS}
                >
                  {platform === 'email' ? (
                    <Mail aria-hidden="true" className="size-4 shrink-0" />
                  ) : (
                    <BrandIcon platform={platform} />
                  )}
                  {t(LABEL[platform])}
                </a>
              </li>
            ))}
          </ul>
          {manual && (
            <label className="mt-1.5 block px-1.5 pb-1 text-xs text-text2">
              {manual.label}
              <textarea
                ref={field}
                readOnly
                rows={manual.value.includes('\n') ? 6 : 2}
                value={manual.value}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 block w-full resize-y border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
