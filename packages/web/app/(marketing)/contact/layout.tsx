import { pageMetadata } from '@/lib/seo'

// The contact page is a client component (the form), and only server modules may export
// metadata, so the page's own title, description and canonical are set here.
export const metadata = pageMetadata({
  path: '/contact',
  title: 'Contact',
  description:
    'Get in touch with the TabMerger team: report a bug, ask about billing or your account, or share feedback and ideas.',
})

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
