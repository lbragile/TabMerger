import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import React from 'react'

// ponytail: next/dynamic(ssr:false) components (e.g. DemoSectionLoader) resolve
// slower than the default 1000ms asyncUtilTimeout on a cold module cache — bump it
// so findBy* queries don't flake on those.
configure({ asyncUtilTimeout: 5000 })

// jsdom's localStorage persists across tests within a file — components that read/write
// it (e.g. GroupGrid's view-mode toggle) can leak state between unrelated tests otherwise.
beforeEach(() => {
  localStorage.clear()
})

// jsdom doesn't implement the Pointer Events API (hasPointerCapture/setPointerCapture/
// scrollIntoView) that Radix UI's Select relies on for its open/close and scroll behavior —
// without these no-op stubs, clicking a Select in a test throws "not a function".
if (typeof window !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}

// Next.js Link renders as <a> in tests
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
