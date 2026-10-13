import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useConfirm, type ConfirmRequest } from '@/hooks/useConfirm'

const REQUEST: ConfirmRequest = {
  title: 'Delete this thing?',
  description: 'It will be gone for good.',
  confirmLabel: 'Delete thing',
  destructive: true
}

/** Asks `request` when "Ask" is pressed and records every answer, in order. */
function Harness({ request = REQUEST, answers, other }: { request?: ConfirmRequest; answers: boolean[]; other?: ConfirmRequest }) {
  const { confirm, confirmDialog } = useConfirm()
  return (
    <div>
      <button onClick={() => void confirm(request).then((v) => answers.push(v))}>Ask</button>
      {other && <button onClick={() => void confirm(other).then((v) => answers.push(v))}>Ask other</button>}
      {confirmDialog}
    </div>
  )
}

const box = () => screen.findByRole('alertdialog')
const gone = () => waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
const cancelButton = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
const actionButton = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete thing' })

describe('useConfirm / ConfirmDialog', () => {
  it('renders nothing until a question is asked', () => {
    render(<Harness answers={[]} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('is an alertdialog named by its title and described by its description', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} />)
    await user.click(screen.getByText('Ask'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this thing?' })
    expect(dialog).toHaveAccessibleDescription('It will be gone for good.')
  })

  it('resolves true only for the action button, and the dialog closes', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(actionButton())
    await gone()
    expect(answers).toEqual([true])
  })

  it('resolves false for Cancel', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(cancelButton())
    await gone()
    expect(answers).toEqual([false])
  })

  it('uses a custom cancel label', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} request={{ ...REQUEST, cancelLabel: 'Keep it' }} />)
    await user.click(screen.getByText('Ask'))
    expect(within(await box()).getByRole('button', { name: 'Keep it' })).toBeInTheDocument()
  })

  it('resolves false for Escape', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.keyboard('{Escape}')
    await gone()
    expect(answers).toEqual([false])
  })

  it('resolves false for the X (Close) button', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await user.click(within(await box()).getByRole('button', { name: /close/i }))
    await gone()
    expect(answers).toEqual([false])
  })

  it('a click outside does not dismiss it', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    fireEvent.pointerDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.click(document.body)
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(answers).toEqual([])
  })

  it('a double click on the action button answers once', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.dblClick(actionButton())
    await gone()
    expect(answers).toEqual([true])
  })

  it('a second question while one is open resolves the first false and shows the second', async () => {
    const answers: boolean[] = []
    const second: ConfirmRequest = { title: 'Second?', description: 'Another one.', confirmLabel: 'Do second' }
    render(<Harness answers={answers} other={second} />)
    // the open dialog makes the page inert for pointer input, so ask both from code
    screen.getByText('Ask').click()
    await box()
    screen.getByText('Ask other').click()
    await screen.findByRole('alertdialog', { name: 'Second?' })
    await waitFor(() => expect(answers).toEqual([false]))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Do second' }))
    await gone()
    expect(answers).toEqual([false, true])
  })

  it('unmounting while a question is open resolves false', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    const { unmount } = render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    unmount()
    await waitFor(() => expect(answers).toEqual([false]))
  })

  it('a destructive question starts with focus on Cancel', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await waitFor(() => expect(cancelButton()).toHaveFocus())
  })

  it('a non-destructive question starts with focus on the action', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} request={{ ...REQUEST, destructive: false }} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await waitFor(() => expect(actionButton()).toHaveFocus())
  })

  it('keyboard only: Enter on the default Cancel cancels; Tab then Enter confirms', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await waitFor(() => expect(cancelButton()).toHaveFocus())
    await user.keyboard('{Enter}')
    await gone()
    await user.click(screen.getByText('Ask'))
    await box()
    await waitFor(() => expect(cancelButton()).toHaveFocus())
    await user.tab()
    expect(actionButton()).toHaveFocus()
    await user.keyboard('{Enter}')
    await gone()
    expect(answers).toEqual([false, true])
  })

  it('returns focus to the element that was focused when the question was asked', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} />)
    const ask = screen.getByText('Ask')
    ask.focus()
    await user.keyboard('{Enter}')
    await box()
    await user.click(cancelButton())
    await gone()
    await waitFor(() => expect(ask).toHaveFocus())
  })

  it('returns focus to returnFocusTo when given, not to the asking element', async () => {
    function Custom() {
      const { confirm, confirmDialog } = useConfirm()
      const [target, setTarget] = useState<HTMLButtonElement | null>(null)
      return (
        <div>
          <button onClick={() => void confirm({ ...REQUEST, returnFocusTo: target })}>Ask</button>
          <button ref={setTarget}>Target</button>
          {confirmDialog}
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Custom />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(cancelButton())
    await gone()
    await waitFor(() => expect(screen.getByText('Target')).toHaveFocus())
  })

  it('does not throw when the element to return focus to has left the page', async () => {
    function Vanishing() {
      const { confirm, confirmDialog } = useConfirm()
      const [shown, setShown] = useState(true)
      return (
        <div>
          {shown && <button onClick={() => void confirm(REQUEST).then(() => setShown(false))}>Ask</button>}
          {confirmDialog}
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Vanishing />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(actionButton())
    await gone()
    expect(screen.queryByText('Ask')).toBeNull()
  })

  it('renders title and description as text, never markup', async () => {
    const user = userEvent.setup()
    render(<Harness answers={[]} request={{ ...REQUEST, title: '<b>bold</b>', description: '<img src=x onerror=alert(1)>' }} />)
    await user.click(screen.getByText('Ask'))
    const dialog = await box()
    expect(dialog.querySelector('b, img')).toBeNull()
    expect(dialog).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('the same hook can ask again after being answered', async () => {
    const answers: boolean[] = []
    const user = userEvent.setup()
    render(<Harness answers={answers} />)
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(cancelButton())
    await gone()
    await user.click(screen.getByText('Ask'))
    await box()
    await user.click(actionButton())
    await gone()
    expect(answers).toEqual([false, true])
  })
})
