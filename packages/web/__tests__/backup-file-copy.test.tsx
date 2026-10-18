import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { AUTO_BACKUP_COPY, BACKUP_FILE_COPY } from '@tabmerger/shared'
import PrivacyPage from '@/app/[locale]/(marketing)/privacy/page'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'
import { PricingTable } from '@/components/pricing/PricingTable'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

/**
 * What the public pages say about the optional file copy of automatic backups ("Also save a file
 * to this computer"): the privacy page's storage table, the features entry and the Pro plan line.
 */
describe('privacy page: backup files', () => {
  it('has a storage row saying the file is optional, unencrypted, local, and what it holds', () => {
    render(<PrivacyPage />)
    const stored = within(document.getElementById('how-stored')!)
    const row = stored.getByText('Backup files (optional)').parentElement!
    expect(row).toHaveTextContent(`If you turn on "${BACKUP_FILE_COPY.toggle}", each automatic backup is also written as a JSON file inside your browser's Downloads folder.`)
    expect(row).toHaveTextContent('That file is not encrypted and stays on your computer: TabMerger does not upload it, read other files, or delete it.')
    expect(row).toHaveTextContent('It contains your saved groups (tab addresses and titles, group and window names, notes) and nothing about your account.')
  })

  it('keeps the row between the local and the account storage rows', () => {
    render(<PrivacyPage />)
    const labels = Array.from(document.getElementById('how-stored')!.querySelectorAll('span.font-medium')).map((el) => el.textContent)
    expect(labels.slice(0, 3)).toEqual(['Local (all tiers)', 'Backup files (optional)', 'Supabase (Pro)'])
  })
})

describe('features page: automatic backups', () => {
  it('mentions the optional, unencrypted file copy and the dashboard', () => {
    render(<FeaturesPage />)
    const entry = screen.getByRole('heading', { name: AUTO_BACKUP_COPY.title }).parentElement!.parentElement!
    expect(entry).toHaveTextContent('You can also have each one saved as a file on your computer; that copy is not encrypted.')
    expect(entry).toHaveTextContent('Your dashboard lists them too')
  })
})

describe('pricing: the Pro backups line', () => {
  it('is the shared line, with the optional file copy, and is rendered once', () => {
    expect(AUTO_BACKUP_COPY.pricingFeature).toMatch(/optional file copy on your computer/)
    render(<PricingTable installHref="https://store.example/tabmerger" />)
    expect(screen.getAllByText(AUTO_BACKUP_COPY.pricingFeature)).toHaveLength(1)
  })
})
