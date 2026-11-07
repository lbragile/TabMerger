import { forwardRef, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The subtle bordered box that holds a feature's options while the feature is on. */
export const SETTINGS_SUB_BOX = 'border border-border p-3';

interface SettingsSectionProps {
  /** The small all-caps heading; it also names the section (`aria-labelledby`). */
  title: ReactNode;
  /** One line under the heading saying what the section is for. */
  purpose?: ReactNode;
  /** A control on the heading line, at its end (the feature's main switch). */
  headerAction?: ReactNode;
  /** `data-section` on the section, so tests and tools can find it whatever its language. */
  section: string;
  /** `data-testid` on the section. */
  testId?: string;
  /** Lets the section itself take focus (a fallback target after its last row is removed). */
  tabIndex?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * One titled block of a Settings tab (Settings → Data): a small all-caps heading (a real `h3`),
 * an optional control on the heading line, a one-line purpose, then the section's own content.
 */
export const SettingsSection = forwardRef<HTMLElement, SettingsSectionProps>(function SettingsSection(
  { title, purpose, headerAction, section, testId, tabIndex, className, children },
  ref
) {
  const headingId = useId();
  return (
    <section
      ref={ref}
      tabIndex={tabIndex}
      aria-labelledby={headingId}
      data-section={section}
      data-testid={testId}
      className={cn('min-w-0 space-y-3 focus:outline-none', className)}
    >
      <div className="min-w-0">
        <div className="flex min-h-5 min-w-0 items-center justify-between gap-4">
          <h3 id={headingId} className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
          {headerAction}
        </div>
        {purpose && <p className="mt-0.5 min-w-0 text-xs text-muted-foreground">{purpose}</p>}
      </div>
      {children}
    </section>
  );
});
