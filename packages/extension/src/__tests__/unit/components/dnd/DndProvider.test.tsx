/**
 * DndProvider.test.tsx — the single app-level drag layer.
 *
 * Covers the provider's structural guarantees (exactly one context + overlay,
 * nesting is a passthrough) and the `useDndContext` fallback, without a mock of
 * the component itself — sibling suites (`appDndProvider`, `sidePanelUnifiedDnd`)
 * all mock it, so this is the only place the real module runs.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndProvider, useDndContext } from '@/components/dnd/DndProvider'

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, ui))
}

function CtxProbe() {
  const ctx = useDndContext()
  return React.createElement(
    'div',
    { 'data-testid': 'probe' },
    JSON.stringify({ isDragging: ctx.isDragging, hasActive: ctx.active != null, hasOverride: ctx.overrideState != null })
  )
}

describe('DndProvider', () => {
  it('renders exactly one provider wrapper around its children', () => {
    wrap(
      React.createElement(
        DndProvider,
        null,
        React.createElement('span', { 'data-testid': 'child' }, 'hi')
      )
    )
    expect(screen.getAllByTestId('dnd-provider')).toHaveLength(1)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('a nested DndProvider is a passthrough — still just one wrapper', () => {
    wrap(
      React.createElement(
        DndProvider,
        null,
        React.createElement(
          DndProvider,
          null,
          React.createElement('span', { 'data-testid': 'child' }, 'nested')
        )
      )
    )
    expect(screen.getAllByTestId('dnd-provider')).toHaveLength(1)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('exposes an idle drag context to descendants (no active drag)', () => {
    wrap(React.createElement(DndProvider, null, React.createElement(CtxProbe)))
    expect(screen.getByTestId('probe').textContent).toBe(
      JSON.stringify({ isDragging: false, hasActive: false, hasOverride: false })
    )
  })

  it('useDndContext returns the EMPTY fallback when used outside any provider', () => {
    render(React.createElement(CtxProbe))
    expect(screen.getByTestId('probe').textContent).toBe(
      JSON.stringify({ isDragging: false, hasActive: false, hasOverride: false })
    )
  })
})
