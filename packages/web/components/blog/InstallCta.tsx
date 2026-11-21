import type { ReactNode } from 'react'
import { BlogInstallCta } from '@/components/blog/BlogInstallCta'
import { getStoreLinks } from '@/lib/storeLinks'

/**
 * The post body's install box: the post's line (children) beside the install buttons. A server
 * component so the store links follow the deployment answering the request.
 */
export function InstallCta({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 border border-primary/30 bg-primary/5 px-6 py-5 dark:bg-accent">
      {children && <div className="min-w-0 flex-[1_1_16rem] text-[1.0625rem] leading-normal [&>p]:m-0">{children}</div>}
      <BlogInstallCta links={getStoreLinks()} />
    </div>
  )
}
