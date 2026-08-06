import { ChromeIcon } from '@/components/marketing/BrowserIcons'

export function ShareInstallCta() {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-border2 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
      <div className="flex-1">
        <p className="font-semibold text-[14.5px] mb-0.5">Open all your tabs at once</p>
        <p className="text-[13px] text-text2">Install TabMerger and this collection becomes a group you can restore in a click.</p>
      </div>
      <a
        href="https://chrome.google.com/webstore"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 inline-flex items-center gap-2 h-10 px-5 rounded-md text-white text-[13.5px] font-medium shadow-sh2 hover:shadow-sh3 hover:-translate-y-px transition-all"
        style={{ backgroundImage: 'var(--gradient-brand)' }}
      >
        <ChromeIcon size={16} />
        Install free
      </a>
    </div>
  )
}
