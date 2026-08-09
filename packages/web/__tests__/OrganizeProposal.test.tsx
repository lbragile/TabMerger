/**
 * Tests for components/dashboard/OrganizeProposal.tsx — streams AI reorganize
 * proposals from /api/ai/organize and posts the user's approve/reject decision.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OrganizeProposal } from '@/components/dashboard/OrganizeProposal'

function streamResponse(chunks: string[], ok = true, withBody = true) {
  let i = 0
  const body = withBody
    ? {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => {
            if (i < chunks.length) {
              const chunk = chunks[i++]
              return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk) })
            }
            return Promise.resolve({ done: true, value: undefined })
          }),
        }),
      }
    : null

  return { ok, status: ok ? 200 : 500, body }
}

const PROPS = { runId: 'run-1', token: 'org-token', supabaseToken: 'jwt' }

describe('OrganizeProposal', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('shows a loading indicator while streaming', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse([]))
    render(<OrganizeProposal {...PROPS} />)
    expect(screen.getByText(/analyzing your tab groups/i)).toBeInTheDocument()
  })

  it('shows an error when the server responds with a non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse([], false))
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/server error 500/i)).toBeInTheDocument())
  })

  it('shows an error when the response has no body', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse([], true, false))
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/no response body/i)).toBeInTheDocument())
  })

  it('shows an error when fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument())
  })

  it('shows "No changes suggested" when the stream resolves to an empty array', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(['[]']))
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/no changes suggested/i)).toBeInTheDocument())
  })

  it('ignores incomplete JSON chunks while buffering', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamResponse(['[{"type":"rename","group', 'Id":"g1","newName":"Work"}]'])
    )
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/rename group/i)).toBeInTheDocument())
  })

  it('filters out a rename action targeting "Now Open"', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamResponse([
        JSON.stringify([{ type: 'rename', groupId: 'g0', newName: 'Now Open' }]),
      ])
    )
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/no changes suggested/i)).toBeInTheDocument())
  })

  it('renders each action type with its label', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      streamResponse([
        JSON.stringify([
          { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'g2' },
          { type: 'rename', groupId: 'g3', newName: 'Research' },
          { type: 'delete', groupId: 'g4' },
          { type: 'reorder', groupIds: ['g1', 'g2', 'g3'] },
        ]),
      ])
    )
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByText(/merge g1 → g2/i)).toBeInTheDocument())
    expect(screen.getByText(/rename group → "research"/i)).toBeInTheDocument()
    expect(screen.getByText(/delete group g4/i)).toBeInTheDocument()
    expect(screen.getByText(/reorder groups: g1, g2, g3/i)).toBeInTheDocument()
  })

  it('approves the proposal and shows the success state', async () => {
    const user = userEvent.setup()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([JSON.stringify([{ type: 'rename', groupId: 'g1', newName: 'Work' }])])
      )
      .mockResolvedValueOnce({ ok: true })

    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() => expect(screen.getByText(/changes applied successfully/i)).toBeInTheDocument())
  })

  it('rejects the proposal and shows the cancelled state', async () => {
    const user = userEvent.setup()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([JSON.stringify([{ type: 'rename', groupId: 'g1', newName: 'Work' }])])
      )
      .mockResolvedValueOnce({ ok: true })

    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /reject/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /reject/i }))

    await waitFor(() => expect(screen.getByText(/proposal cancelled/i)).toBeInTheDocument())
  })

  it('shows an error when the approve request fails', async () => {
    const user = userEvent.setup()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([JSON.stringify([{ type: 'rename', groupId: 'g1', newName: 'Work' }])])
      )
      .mockResolvedValueOnce({ ok: false, status: 500 })

    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() => expect(screen.getByText(/server error 500/i)).toBeInTheDocument())
  })

  // E2EE: the dashboard has no data key, so it must refuse rather than review
  // a proposal derived from groups it cannot read.
  it('refuses to stream or approve when the user is encrypted', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock

    render(<OrganizeProposal {...PROPS} encrypted />)

    expect(screen.getByText(/end-to-end encrypted groups/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('disables Approve when there are no actions', async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse(['[]']))
    render(<OrganizeProposal {...PROPS} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled())
  })
})
