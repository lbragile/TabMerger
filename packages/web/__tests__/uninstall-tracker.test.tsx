/**
 * UninstallTracker: asks the server to record the uninstall exactly once per page view
 * (React's double effect run, a re-render, a refresh in the same tab), passing the parsed values.
 */
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UninstallTracker } from '@/components/uninstall/UninstallTracker'

const recordUninstall = vi.hoisted(() => vi.fn())
vi.mock('@/app/[locale]/(marketing)/uninstalled/actions', () => ({ recordUninstall }))

beforeEach(() => {
  recordUninstall.mockReset()
  recordUninstall.mockResolvedValue(undefined)
  sessionStorage.clear()
})

describe('UninstallTracker', () => {
  it('sends the parsed values once, even under StrictMode and a re-render', () => {
    const tree = (
      <StrictMode>
        <UninstallTracker version="3.3.3" browser="chrome" channel="stable" analytics />
      </StrictMode>
    )
    const { rerender } = render(tree)
    rerender(tree)
    expect(recordUninstall).toHaveBeenCalledTimes(1)
    expect(recordUninstall).toHaveBeenCalledWith({ version: '3.3.3', browser: 'chrome', channel: 'stable', analytics: '1' })
  })

  it('does not send again after a refresh in the same tab (a fresh mount)', () => {
    render(<UninstallTracker browser="firefox" analytics />).unmount()
    render(<UninstallTracker browser="firefox" analytics />)
    expect(recordUninstall).toHaveBeenCalledTimes(1)
  })

  it('passes a=0, or no flag when it is unknown (the server decides)', () => {
    render(<UninstallTracker browser="firefox" analytics={false} />).unmount()
    expect(recordUninstall).toHaveBeenLastCalledWith(expect.objectContaining({ analytics: '0' }))
    sessionStorage.clear()
    render(<UninstallTracker browser="chrome" />)
    expect(recordUninstall).toHaveBeenLastCalledWith(expect.objectContaining({ analytics: undefined }))
  })

  it('still sends once when sessionStorage throws (some private modes)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<UninstallTracker browser="edge" analytics />)
    expect(recordUninstall).toHaveBeenCalledTimes(1)
    getItem.mockRestore()
  })

  it('swallows a failed server action', async () => {
    recordUninstall.mockRejectedValue(new Error('offline'))
    render(<UninstallTracker browser="edge" analytics />)
    await Promise.resolve()
    expect(recordUninstall).toHaveBeenCalledTimes(1)
  })

  it('renders nothing', () => {
    const { container } = render(<UninstallTracker browser="chrome" analytics />)
    expect(container).toBeEmptyDOMElement()
  })
})
