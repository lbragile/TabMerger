import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TourCard } from '@/components/Tour/TourCard'
import type { TourProgress, TourStep } from '@/lib/tour'

const step: TourStep = {
  id: 'groups',
  chapter: 'groups',
  anchor: 'groups',
  placement: 'right',
  title: 'Your groups',
  body: 'Double-click a group to rename it.',
  doneText: 'Nice, done.'
}

/** Step 3 of 5, in chapter 2 of 3. */
const progress = (over: Partial<TourProgress> = {}): TourProgress => ({
  step: 3,
  total: 5,
  chapter: 2,
  chapters: 3,
  chapterTitle: 'Groups',
  chapterDescription: '',
  stepInChapter: 1,
  stepsInChapter: 2,
  ...over
})

function handlers() {
  return { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn(), onSkipStep: vi.fn(), onSkipChapter: vi.fn(), onRemovePractice: vi.fn() }
}

function setup(props: Partial<React.ComponentProps<typeof TourCard>> = {}) {
  const h = handlers()
  render(<TourCard step={step} body={step.body} progress={progress()} position={{ left: 10, top: 20 }} taskStatus="none" {...h} {...props} />)
  return h
}

describe('TourCard', () => {
  it('is a named modal dialog showing the step title as a heading and the step text', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
    expect(screen.getByRole('heading', { name: 'Your groups' })).toBeInTheDocument()
    expect(screen.getByText('Double-click a group to rename it.')).toBeInTheDocument()
  })

  it('shows the chapter and the step counter, and announces the step in a polite status region', async () => {
    setup()
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
    expect(screen.getByText('Chapter 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Groups')).toBeInTheDocument()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => {
      expect(status).toHaveTextContent('Chapter 2 of 3, Groups')
      expect(status).toHaveTextContent('Step 3 of 5')
      expect(status).toHaveTextContent('Your groups')
    })
  })

  it('updates the announcement when the step changes', async () => {
    const h = handlers()
    const { rerender } = render(<TourCard step={step} body={step.body} progress={progress()} position={{ left: 0, top: 0 }} taskStatus="none" {...h} />)
    const next: TourStep = { ...step, id: 'search', title: 'Find anything', body: 'Type to search.' }
    rerender(<TourCard step={next} body={next.body} progress={progress({ step: 4 })} position={{ left: 0, top: 0 }} taskStatus="none" {...h} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Step 4 of 5'))
    expect(screen.getByRole('status')).toHaveTextContent('Find anything')
  })

  it('is programmatically focusable but not in the tab order, and tagged with the step id', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('tabindex', '-1')
    expect(dialog).toHaveAttribute('data-tour-card', 'groups')
  })

  it('is hidden until it has a position', () => {
    setup({ position: null })
    expect(screen.getByRole('dialog', { hidden: true })).toHaveClass('invisible')
  })

  it('is placed at the given position', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveStyle({ left: '10px', top: '20px' })
    expect(dialog).not.toHaveClass('invisible')
  })

  it('on a middle step offers Skip tour, Skip chapter, Back and Next', async () => {
    const user = userEvent.setup()
    const { onNext, onBack, onSkip, onSkipChapter } = setup()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    await user.click(screen.getByRole('button', { name: 'Skip chapter' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onSkipChapter).toHaveBeenCalledTimes(1)
  })

  it('has no Skip chapter in the last chapter', () => {
    setup({ onSkipChapter: undefined })
    expect(screen.queryByRole('button', { name: 'Skip chapter' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('has no Back button on the first step', () => {
    setup({ progress: progress({ step: 1 }) })
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
  })

  it('on the last step shows Done instead of Next, and no Skip', async () => {
    const user = userEvent.setup()
    const { onNext } = setup({ progress: progress({ step: 5 }) })
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip tour' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('an interactive step that is not done offers "Skip this step" instead of Next, and says it is the user\'s turn', async () => {
    const user = userEvent.setup()
    const { onSkipStep, onNext } = setup({ taskStatus: 'todo' })
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.getByText(/Your turn\. This step waits/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your turn.'))
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    expect(onSkipStep).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('a completed interactive step shows and announces its "done" text and offers Next', async () => {
    setup({ taskStatus: 'done' })
    expect(screen.getByText('Nice, done.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip this step' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nice, done. Select Next to continue.'))
  })

  it('on the last step offers to remove the practice group, naming it and its tabs', async () => {
    const user = userEvent.setup()
    const { onRemovePractice } = setup({ progress: progress({ step: 5 }), practice: { name: 'Practice', tabCount: 2, removed: false } })
    expect(screen.getByText(/“Practice”\s*\(2 tabs\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove the practice group' }))
    expect(onRemovePractice).toHaveBeenCalledTimes(1)
  })

  it('does not offer the removal before the last step, and confirms it afterwards', () => {
    const { rerender } = render(
      <TourCard step={step} body={step.body} progress={progress()} position={null} taskStatus="none" practice={{ name: 'Practice', tabCount: 0, removed: false }} {...handlers()} />
    )
    expect(screen.queryByRole('button', { name: 'Remove the practice group', hidden: true })).not.toBeInTheDocument()
    rerender(
      <TourCard step={step} body={step.body} progress={progress({ step: 5 })} position={null} taskStatus="none" practice={{ name: '', tabCount: 0, removed: true }} {...handlers()} />
    )
    expect(screen.getByText('The practice group was removed.')).toBeInTheDocument()
  })

  it('forwards its ref to the dialog element', () => {
    const ref = { current: null as HTMLDivElement | null }
    render(<TourCard ref={ref} step={step} body={step.body} progress={progress({ step: 1, total: 2 })} position={null} taskStatus="none" {...handlers()} />)
    expect(ref.current).toHaveAttribute('role', 'dialog')
  })
})
