import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { betaGoodKey, betaStepKey } from '@/lib/betaChecklist'

const STORAGE_KEY = 'tabmerger:beta-checklist:v1'
const STEPS = ['Open the popup.', 'Create a group.', 'Rename it.']
const GOOD = ['The group shows its new name straight away.', 'Undo puts the old name back.']

// The checklist caches what it read from localStorage at module level, so each test loads a
// fresh copy (as a page reload would).
async function load() {
  vi.resetModules()
  return import('@/components/beta/BetaChecklist')
}

describe('beta step checklist', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders every step as a numbered, labelled checkbox', async () => {
    const { BetaStepList } = await load()
    render(<BetaStepList areaId="groups" steps={STEPS} />)
    STEPS.forEach((step, i) => {
      expect(screen.getByRole('checkbox', { name: `${i + 1}. ${step}` })).not.toBeChecked()
    })
  })

  it('ticks a step, strikes it through, and saves it for the next visit', async () => {
    const { BetaStepList } = await load()
    const { unmount } = render(<BetaStepList areaId="groups" steps={STEPS} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Create a group/ }))

    expect(screen.getByRole('checkbox', { name: /Create a group/ })).toBeChecked()
    expect(screen.getByText('Create a group.').closest('label')!.className).toContain('line-through')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([betaStepKey('groups', 'Create a group.')])

    unmount()
    const again = await load()
    render(<again.BetaStepList areaId="groups" steps={STEPS} />)
    expect(screen.getByRole('checkbox', { name: /Create a group/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Open the popup/ })).not.toBeChecked()
  })

  it('clears a checkmark when its step is reworded, keeping the others', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([betaStepKey('groups', 'Open the popup.'), betaStepKey('groups', 'Rename it.')])
    )
    const { BetaStepList } = await load()
    render(<BetaStepList areaId="groups" steps={['Open the popup.', 'Create a group.', 'Rename it inline.']} />)
    expect(screen.getByRole('checkbox', { name: /Open the popup/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Rename it inline/ })).not.toBeChecked()
  })

  it("shows an area's progress over steps and results, and marks it done when all are ticked", async () => {
    const { BetaStepList, BetaGoodCheck, BetaAreaProgress } = await load()
    render(
      <>
        <BetaAreaProgress areaId="groups" items={[{ steps: STEPS, good: GOOD }]} />
        <BetaStepList areaId="groups" steps={STEPS} />
        <BetaGoodCheck areaId="groups" good={GOOD} />
      </>
    )
    expect(screen.queryByLabelText(/checks done/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Open the popup/ }))
    expect(screen.getByLabelText('1 of 5 checks done')).toHaveTextContent('1/5')

    fireEvent.click(screen.getByRole('checkbox', { name: /Create a group/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Rename it/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: GOOD[0] }))
    expect(screen.getByLabelText('4 of 5 checks done')).toHaveTextContent('4/5')

    fireEvent.click(screen.getByRole('checkbox', { name: GOOD[1] }))
    expect(screen.getByLabelText('All checks done')).toHaveTextContent('✓ All done')
  })

  it('gives each "Good looks like" outcome its own checkbox, struck through and saved when ticked', async () => {
    const { BetaGoodCheck } = await load()
    const { unmount } = render(<BetaGoodCheck areaId="groups" good={GOOD} />)
    expect(screen.getByText('Good looks like')).toBeInTheDocument()
    GOOD.forEach((outcome) => expect(screen.getByRole('checkbox', { name: outcome })).not.toBeChecked())

    fireEvent.click(screen.getByRole('checkbox', { name: GOOD[1] }))
    expect(screen.getByRole('checkbox', { name: GOOD[1] })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: GOOD[0] })).not.toBeChecked()
    expect(screen.getByText(GOOD[1]).closest('label')!.className).toContain('line-through')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([betaGoodKey('groups', GOOD[1])])

    unmount()
    const again = await load()
    render(<again.BetaGoodCheck areaId="groups" good={GOOD} />)
    expect(screen.getByRole('checkbox', { name: GOOD[1] })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: GOOD[0] })).not.toBeChecked()
  })

  it("keeps a result's key apart from a step with the same text", () => {
    expect(betaGoodKey('groups', 'Rename it.')).not.toBe(betaStepKey('groups', 'Rename it.'))
  })

  it('"Clear my checkmarks" unticks everything, and only appears once something is ticked', async () => {
    const { BetaStepList, BetaChecklistReset } = await load()
    render(
      <>
        <BetaChecklistReset />
        <BetaStepList areaId="groups" steps={STEPS} />
      </>
    )
    expect(screen.queryByRole('button', { name: /Clear my checkmarks/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /Open the popup/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear my checkmarks (1)' }))
    expect(screen.getByRole('checkbox', { name: /Open the popup/ })).not.toBeChecked()
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([])
  })

  it('still works as a plain list when storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      const { BetaStepList } = await load()
      render(<BetaStepList areaId="groups" steps={STEPS} />)
      fireEvent.click(screen.getByRole('checkbox', { name: /Open the popup/ }))
      expect(screen.getByRole('checkbox', { name: /Open the popup/ })).toBeChecked()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
