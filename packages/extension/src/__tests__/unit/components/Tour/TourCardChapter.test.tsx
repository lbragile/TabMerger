import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TourCard } from '@/components/Tour/TourCard'
import type { TourProgress, TourStep } from '@/lib/tour'

const step: TourStep = { id: 's', chapter: 'groups', anchor: 'groups', placement: 'right', title: 'Your groups', body: 'Body text.' }
const DESC = 'Groups are where saved tabs live.'

const progress = (over: Partial<TourProgress> = {}): TourProgress => ({
  step: 5,
  total: 23,
  chapter: 2,
  chapters: 6,
  chapterTitle: 'Organise with groups',
  chapterDescription: DESC,
  stepInChapter: 2,
  stepsInChapter: 5,
  ...over
})

function setup(props: Partial<React.ComponentProps<typeof TourCard>> = {}) {
  const noop = vi.fn()
  return render(
    <TourCard
      step={step}
      body={step.body}
      progress={progress()}
      position={{ left: 0, top: 0 }}
      taskStatus="none"
      onNext={noop}
      onBack={noop}
      onSkip={noop}
      onSkipStep={noop}
      {...props}
    />
  )
}
const description = () => document.querySelector('[data-tour-chapter-description]')

describe('TourCard chapter header', () => {
  it('shows the chapter title on every step, first or not', () => {
    for (const stepInChapter of [1, 2, 5]) {
      const { unmount } = setup({ progress: progress({ stepInChapter }) })
      expect(document.querySelector('[data-tour-chapter-title]')).toHaveTextContent('Organise with groups')
      unmount()
    }
  })

  it('shows the description on the first step of the chapter', () => {
    setup({ progress: progress({ stepInChapter: 1 }) })
    expect(description()).toHaveTextContent(DESC)
  })

  it('hides it on later steps unless this step introduces the chapter', () => {
    const { unmount } = setup({ progress: progress({ stepInChapter: 3 }) })
    expect(description()).toBeNull()
    unmount()
    setup({ progress: progress({ stepInChapter: 3 }), introducesChapter: true })
    expect(description()).toHaveTextContent(DESC)
  })

  it('shows nothing when the chapter has no description', () => {
    setup({ progress: progress({ stepInChapter: 1, chapterDescription: '' }), introducesChapter: true })
    expect(description()).toBeNull()
  })

  it('draws one progress segment per chapter, filled up to the current chapter', () => {
    setup({ progress: progress({ chapter: 2, chapters: 6, stepInChapter: 2, stepsInChapter: 4 }) })
    const segments = Array.from(document.querySelectorAll('[data-tour-progress] > span')).map((s) => (s.firstElementChild as HTMLElement).style.width)
    expect(segments).toEqual(['100%', '50%', '0%', '0%', '0%', '0%'])
  })
})

describe('TourCard announcement', () => {
  const status = () => screen.getByRole('status')

  it('includes the chapter description only on the step that introduces the chapter', async () => {
    const { unmount } = setup({ progress: progress({ stepInChapter: 1 }), introducesChapter: true })
    await waitFor(() => expect(status()).toHaveTextContent('Chapter 2 of 6, Organise with groups.'))
    expect(status()).toHaveTextContent(`Organise with groups. ${DESC} Step 5 of 23: Your groups. Body text.`)
    unmount()
    // first step of the chapter again, but not introducing it (after Back): shown, not announced
    setup({ progress: progress({ stepInChapter: 1 }), introducesChapter: false })
    await waitFor(() => expect(status()).toHaveTextContent('Step 5 of 23'))
    expect(description()).toHaveTextContent(DESC)
    expect(status()).not.toHaveTextContent(DESC)
  })

  it('leaves the description out of every later step announcement', async () => {
    setup({ progress: progress({ stepInChapter: 4 }) })
    await waitFor(() => expect(status()).toHaveTextContent('Step 5 of 23'))
    expect(status()).not.toHaveTextContent(DESC)
  })

  it('on a waiting task adds how to move on without trying it', async () => {
    setup({ taskStatus: 'todo' })
    await waitFor(() => expect(status()).toHaveTextContent('Your turn. To move on without trying it, select "Skip this step".'))
  })

  it('says only the done text when the task is done', async () => {
    setup({ taskStatus: 'done', step: { ...step, doneText: 'Nice, colour changed.' }, introducesChapter: true })
    await waitFor(() => expect(status()).toHaveTextContent('Nice, colour changed. Select Next to continue.'))
    expect(status()).not.toHaveTextContent(DESC)
  })

  it('falls back to "Done." when the step has no done text', async () => {
    setup({ taskStatus: 'done' })
    await waitFor(() => expect(status()).toHaveTextContent('Done. Select Next to continue.'))
  })
})

describe('TourCard buttons by chapter', () => {
  it('has no Skip chapter in the last chapter, but keeps Skip tour', () => {
    setup({ progress: progress({ chapter: 6 }), onSkipChapter: undefined })
    expect(screen.queryByRole('button', { name: 'Skip chapter' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('has Skip chapter in an earlier one', () => {
    setup({ onSkipChapter: vi.fn() })
    expect(screen.getByRole('button', { name: 'Skip chapter' })).toBeInTheDocument()
  })
})
