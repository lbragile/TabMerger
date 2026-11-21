'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ArrowDownWideNarrow, Check, ChevronDown, Search, X } from 'lucide-react'
import type { ListingTranslator } from '@/components/blog/HelpfulCounts'
import { LISTING_SORTS, type ListingSort } from '@/lib/blog/listing'
import { cn } from '@/lib/utils'

/** Each sort's message key. */
const SORT_LABEL = {
  newest: 'sortNewest',
  oldest: 'sortOldest',
  helpful: 'sortHelpful',
  shortest: 'sortShortest',
} as const satisfies Record<ListingSort, string>

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export interface ListingToolbarProps {
  /** The row's heading: "More guides 12", or the live result line while searching. */
  heading: ReactNode
  search: string
  onSearch: (value: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  sort: ListingSort
  onSort: (sort: ListingSort) => void
  t: ListingTranslator
}

/**
 * The "More guides" heading row: the heading on the start side; the search field and the sort menu
 * on the end side. On phones the sort menu stays beside the heading and the search field takes its
 * own full-width line below.
 */
export function ListingToolbar({ heading, search, onSearch, searchRef, sort, onSort, t }: ListingToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {heading}
      <SearchField
        value={search}
        onChange={onSearch}
        inputRef={searchRef}
        t={t}
        className="order-last basis-full sm:order-none sm:ms-auto sm:w-80 sm:basis-auto"
      />
      <SortMenu value={sort} onChange={onSort} t={t} className="ms-auto sm:ms-0" />
    </div>
  )
}

/**
 * Whether "/" should be left alone: typed into a text field, or pressed while a listbox (the open
 * sort menu) has focus.
 */
function ignoresSlash(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="listbox"]') !== null
}

/**
 * The title search: a search icon, the field, and either a "/" hint or, once there's text, a clear
 * button. Pressing "/" anywhere outside a text field (and outside the open sort menu) focuses it
 * without typing the slash. The hint shows only while it can help: not while the field has focus
 * (there "/" just types), not on phones or touch-only devices. Escape clears the field.
 */
export function SearchField({
  value,
  onChange,
  inputRef,
  t,
  className,
}: {
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  t: ListingTranslator
  className?: string
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || ignoresSlash(event.target)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inputRef])
  const [focused, setFocused] = useState(false)

  return (
    <div
      role="search"
      className={cn(
        'flex h-10 min-w-0 items-center gap-2 border border-border bg-surface2 ps-3 pe-2.5 text-text3 transition-colors',
        'focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
        className
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label={t('searchLabel')}
        aria-keyshortcuts="/"
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            onChange('')
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text3 sm:text-[0.9375rem] [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          aria-label={t('clearSearch')}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className={cn('flex size-7 shrink-0 items-center justify-center text-text2 hover:text-foreground', FOCUS_RING)}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : focused ? null : (
        <kbd
          aria-hidden="true"
          className="hidden border border-border2 px-1.5 font-mono text-xs leading-5 text-text3 sm:inline-block [@media(hover:none)_and_(pointer:coarse)]:hidden"
        >
          /
        </kbd>
      )}
    </div>
  )
}

/**
 * The sort control: a button ("Sort: Newest") opening a listbox of the four sorts, the current one
 * checked. Enter, Space or the arrow keys open it; up/down, Home/End and the first letter move;
 * Enter or Space picks; Escape closes and returns focus to the button; a click outside closes it.
 * The popover aligns to the button's inline end (left in RTL).
 */
export function SortMenu({
  value,
  onChange,
  t,
  className,
}: {
  value: ListingSort
  onChange: (sort: ListingSort) => void
  t: ListingTranslator
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const optionId = (sort: ListingSort) => `${id}-${sort}`
  const label = (sort: ListingSort) => t(SORT_LABEL[sort])
  const last = LISTING_SORTS.length - 1

  const openMenu = () => {
    setActive(LISTING_SORTS.indexOf(value))
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const choose = (index: number) => {
    close(true)
    if (LISTING_SORTS[index] !== value) onChange(LISTING_SORTS[index])
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space open it as a click.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu()
    }
  }

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const move = (index: number) => {
      event.preventDefault()
      setActive(index)
    }
    switch (event.key) {
      case 'ArrowDown':
        return move(Math.min(last, active + 1))
      case 'ArrowUp':
        return move(Math.max(0, active - 1))
      case 'Home':
        return move(0)
      case 'End':
        return move(last)
      case 'Enter':
      case ' ':
        event.preventDefault()
        return choose(active)
      case 'Escape':
        event.preventDefault()
        return close(true)
      case 'Tab':
        return close(false)
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const key = event.key.toLocaleLowerCase()
        const order = [...LISTING_SORTS.slice(active + 1), ...LISTING_SORTS.slice(0, active + 1)]
        const hit = order.find((sort) => label(sort).toLocaleLowerCase().startsWith(key))
        if (hit) move(LISTING_SORTS.indexOf(hit))
      }
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t.markup('sortButton', { sort: label(value), muted: (chunks) => chunks })}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onButtonKey}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 border px-3 text-sm text-foreground transition-colors sm:h-10 sm:gap-2 sm:text-[0.9375rem]',
          open ? 'border-primary' : 'border-border hover:border-primary/50',
          FOCUS_RING
        )}
      >
        <ArrowDownWideNarrow aria-hidden="true" className="size-4 shrink-0" />
        <span className="whitespace-nowrap">
          {t.rich('sortButton', {
            sort: label(value),
            muted: (chunks) => <span className="text-text3 max-sm:hidden">{chunks}</span>,
          })}
        </span>
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={t('sortLabel')}
          aria-activedescendant={optionId(LISTING_SORTS[active])}
          onKeyDown={onListKey}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
          }}
          className="absolute end-0 top-[calc(100%+0.375rem)] z-20 m-0 min-w-52 list-none border border-border2 bg-surface p-1 text-[0.9375rem] shadow-[0_0.75rem_2rem_rgb(0_0_0/0.45)] outline-none"
        >
          {LISTING_SORTS.map((sort, index) => {
            const selected = sort === value
            return (
              <li
                key={sort}
                id={optionId(sort)}
                role="option"
                aria-selected={selected}
                onClick={() => choose(index)}
                onPointerMove={() => setActive(index)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-6 px-3 py-2.5 whitespace-nowrap',
                  selected ? 'bg-accent text-accent-foreground' : 'text-foreground',
                  index === active && (selected ? 'ring-1 ring-inset ring-primary/60' : 'bg-surface3')
                )}
              >
                {label(sort)}
                {selected && <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
