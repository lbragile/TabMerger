import { Suspense } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { GithubStars, GithubStarsFallback } from '@/components/layout/GithubStars'

const REPO_URL = 'https://github.com/lbragile/TabMerger'

// GithubStars reads its promise with React's use(), so it suspends until the promise
// settles. Under RTL, findBy* alone never sees the retry (it timed out); rendering inside
// `await act(async ...)` flushes the resolved promise and the Suspense swap.
async function renderStars(starsPromise: Promise<number | null>) {
  await act(async () => {
    render(
      <Suspense fallback={<GithubStarsFallback />}>
        <GithubStars starsPromise={starsPromise} />
      </Suspense>,
    )
  })
}

describe('GithubStars', () => {
  it('shows the compact count and the exact count in the accessible name', async () => {
    await renderStars(Promise.resolve(1234))
    const link = screen.getByRole('link', { name: 'TabMerger on GitHub, 1,234 stars' })
    expect(link).toHaveAttribute('href', REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('1.2K')
  })

  it('shows a small count as is', async () => {
    await renderStars(Promise.resolve(187))
    const link = screen.getByRole('link', { name: 'TabMerger on GitHub, 187 stars' })
    expect(link).toHaveTextContent('187')
  })

  it('uses the singular for one star', async () => {
    await renderStars(Promise.resolve(1))
    expect(screen.getByRole('link', { name: 'TabMerger on GitHub, 1 star' })).toBeInTheDocument()
  })

  it('renders only the plain link, with no number, when the count is null', async () => {
    await renderStars(Promise.resolve(null))
    const link = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(link).toHaveAttribute('href', REPO_URL)
    expect(link.textContent).toBe('')
    expect(link.querySelector('span')).toBeNull()
  })

  it('shows the fallback while the promise is pending, then swaps to the count', async () => {
    let resolve!: (n: number | null) => void
    const pending = new Promise<number | null>((r) => {
      resolve = r
    })
    await renderStars(pending)

    // Pending: the same link, named without a number.
    const fallback = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(fallback).toHaveAttribute('href', REPO_URL)

    await act(async () => {
      resolve(42)
    })
    expect(screen.getByRole('link', { name: 'TabMerger on GitHub, 42 stars' })).toBeInTheDocument()
  })
})

describe('GithubStarsFallback', () => {
  it('is the plain-named repo link, opening in a new tab safely', () => {
    render(<GithubStarsFallback />)
    const link = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(link).toHaveAttribute('href', REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows no count text', () => {
    render(<GithubStarsFallback />)
    expect(screen.getByRole('link', { name: 'TabMerger on GitHub' }).textContent?.trim()).toBe('')
  })
})
