import { forwardRef, useEffect, useId, useState } from 'react';
import { Check, Hand } from 'lucide-react';
import type { TourProgress, TourStep } from '@/lib/tour';
import { TOUR_BODY_ATTR } from '@/hooks/useTourKeys';
import { cn } from '@/lib/utils';

/** Where an interactive step stands. `none` = a read-only step. */
export type TourTaskStatus = 'none' | 'todo' | 'done';

/** The group made during the tour, offered for removal on the last step. */
export interface TourPracticeOffer {
  name: string;
  tabCount: number;
  /** True once the user removed it from this card. */
  removed: boolean;
}

interface TourCardProps {
  step: TourStep;
  /** The text to show: the step's own, or its read-only fallback. */
  body: string;
  progress: TourProgress;
  /** Pixel position inside the popup, or `null` until the card has been measured. */
  position: { left: number; top: number } | null;
  taskStatus: TourTaskStatus;
  /**
   * True on the step that introduces its chapter to this user in this run: the chapter's
   * description is then part of the announcement. It is SHOWN on that step and on the
   * chapter's first step, but announced only here, so it is heard once per chapter.
   */
  introducesChapter?: boolean;
  /** Last step only: the practice group, while there is one to offer. */
  practice?: TourPracticeOffer | null;
  onNext: () => void;
  onBack: () => void;
  /** Skip the whole tour. */
  onSkip: () => void;
  /** Move on from an interactive step without doing it. */
  onSkipStep: () => void;
  /** Jump to the next chapter. Omitted in the last chapter. */
  onSkipChapter?: () => void;
  onRemovePractice?: () => void;
}

/** Accessible name of the dialog. Constant on purpose, see the announcement note below. */
export const TOUR_DIALOG_LABEL = 'TabMerger tour';

// Solid, high-contrast buttons from the theme's own foreground/background pair: AA in both
// themes without depending on the brand colour (white on the light theme's cyan is too faint).
const BUTTON =
  'inline-flex h-7 items-center justify-center px-3 text-xs font-medium cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const LINK =
  'cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The tour's card: a modal dialog. Purely presentational. Positioning, focus and keys are
 * owned by `Tour.tsx`.
 *
 * The chapter header sits at the top: "Chapter 2 of 6", the chapter's title, one progress
 * segment per chapter, and the chapter's one-sentence description on the step that opens the
 * chapter (its first step, or the step a resumed tour lands on). Later steps drop the
 * description so the step's own text keeps the room: the card must fit the 800x600 popup.
 *
 * How a step is announced: ONCE, by the polite status line at the bottom, which carries the
 * whole step ("Chapter 2 of 6, Organise with groups. Step 5 of 23: title. text"), with the
 * chapter's description after the chapter title on the step that introduces the chapter and
 * on no other step. It is the only thing that
 * changes for a screen reader when the step changes, whether the user pressed a button or an
 * arrow key, because focus stays where it is inside the card. For the same reason the dialog's
 * name is a constant (`TOUR_DIALOG_LABEL`) and the card has no `aria-describedby`: a name or
 * description built from the title and text would be read a second time whenever focus lands
 * on the card. When an interactive step is completed the same line changes to the step's
 * "done" text, so the result is announced without moving focus.
 *
 * The status line is always in the DOM and gets its text in an effect, one tick after it
 * mounts: a live region that is inserted already filled in is often not announced, which
 * would lose the first step.
 *
 * Sizing: never taller than the popup (minus the margin). When the text does not fit (large
 * text, 200% zoom) the text scrolls and the button rows stay in view.
 *
 * `pointer-events-auto`: an open modal dialog of the app sets `pointer-events: none` on
 * `<body>`, which this card (a child of the body) would otherwise inherit.
 */
export const TourCard = forwardRef<HTMLDivElement, TourCardProps>(function TourCard(
  { step, body, progress, position, taskStatus, introducesChapter = false, practice, onNext, onBack, onSkip, onSkipStep, onSkipChapter, onRemovePractice },
  ref
) {
  const titleId = useId();
  const isFirst = progress.step === 1;
  const isLast = progress.step === progress.total;
  const chapterLine = `Chapter ${progress.chapter} of ${progress.chapters}`;
  const stepLine = `Step ${progress.step} of ${progress.total}`;
  const doneText = step.doneText ?? 'Done.';

  const showChapterIntro = !!progress.chapterDescription && (introducesChapter || progress.stepInChapter === 1);
  const chapterIntro = introducesChapter && progress.chapterDescription ? ` ${progress.chapterDescription}` : '';
  const stepAnnouncement = `${chapterLine}, ${progress.chapterTitle}.${chapterIntro} ${stepLine}: ${step.title}. ${body}${
    taskStatus === 'todo' ? ' Your turn. To move on without trying it, select "Skip this step".' : ''
  }`;
  const announcement = taskStatus === 'done' ? `${doneText} Select Next to continue.` : stepAnnouncement;
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(announcement);
  }, [announcement]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={TOUR_DIALOG_LABEL}
      tabIndex={-1}
      data-tour-card={step.id}
      data-tour-task={taskStatus}
      className={cn(
        'pointer-events-auto fixed z-[61] flex max-h-[calc(100vh-1rem)] w-80 max-w-[calc(100vw-1rem)] flex-col border border-foreground/30 bg-popover p-4 text-popover-foreground shadow-lg',
        'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        // Measured before it is shown, so it never flashes in the wrong place
        !position && 'invisible'
      )}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
    >
      <div {...{ [TOUR_BODY_ATTR]: '' }} className="min-h-0 flex-1 overflow-y-auto">
        <div data-tour-chapter="" className="border-l-2 border-foreground pl-2">
          <div className="flex items-baseline justify-between gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            <p className="min-w-0 truncate">{chapterLine}</p>
            <p className="shrink-0">{stepLine}</p>
          </div>
          <p data-tour-chapter-title="" className="mt-0.5 text-sm font-semibold leading-snug">
            {progress.chapterTitle}
          </p>
          {showChapterIntro && (
            <p data-tour-chapter-description="" className="mt-1 text-xs leading-snug text-muted-foreground">
              {progress.chapterDescription}
            </p>
          )}
        </div>
        {/* One segment per chapter, the current one filled as far as its steps have got */}
        <div aria-hidden="true" data-tour-progress="" className="mt-2 flex gap-0.5">
          {Array.from({ length: progress.chapters }, (_, i) => {
            const filled = i + 1 < progress.chapter ? 1 : i + 1 === progress.chapter ? progress.stepInChapter / progress.stepsInChapter : 0;
            return (
              <span key={i} className="h-0.5 flex-1 bg-foreground/15">
                <span className="block h-full bg-foreground" style={{ width: `${filled * 100}%` }} />
              </span>
            );
          })}
        </div>

        <h2 id={titleId} className="mt-3 text-[0.8125rem] font-semibold">
          {step.title}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed">{body}</p>

        {taskStatus === 'todo' && (
          <p data-tour-task-line="todo" className="mt-2.5 flex items-start gap-1.5 border border-foreground/30 px-2 py-1.5 text-xs font-medium">
            <Hand aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>Your turn. This step waits until you have tried it.</span>
          </p>
        )}
        {taskStatus === 'done' && (
          <p data-tour-task-line="done" className="mt-2.5 flex items-start gap-1.5 bg-foreground px-2 py-1.5 text-xs font-medium text-background">
            <Check aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{doneText}</span>
          </p>
        )}

        {isLast && practice && (
          <div data-tour-practice="" className="mt-2.5 border border-foreground/30 px-2 py-1.5 text-xs">
            {practice.removed ? (
              <p>The practice group was removed.</p>
            ) : (
              <>
                <p>
                  The group you made in this tour, &ldquo;{practice.name}&rdquo;
                  {practice.tabCount > 0 ? ` (${plural(practice.tabCount, 'tab')})` : ''}, is still in your list. Keep it, or remove it now.
                </p>
                <button type="button" className={cn(BUTTON, 'mt-1.5 border border-border hover:bg-muted')} onClick={onRemovePractice}>
                  Remove the practice group
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
        {!isFirst && (
          <button type="button" className={cn(BUTTON, 'border border-border hover:bg-muted')} onClick={onBack}>
            Back
          </button>
        )}
        {taskStatus === 'todo' ? (
          <button type="button" className={cn(BUTTON, 'border border-foreground/60 hover:bg-muted')} onClick={onSkipStep}>
            Skip this step
          </button>
        ) : (
          <button type="button" className={cn(BUTTON, 'bg-foreground text-background hover:bg-foreground/85')} onClick={onNext}>
            {isLast ? 'Done' : 'Next'}
          </button>
        )}
      </div>

      {!isLast && (
        <div className="mt-2.5 flex shrink-0 items-center justify-between gap-3 border-t border-foreground/15 pt-2">
          <button type="button" className={LINK} onClick={onSkip}>
            Skip tour
          </button>
          {onSkipChapter && (
            <button type="button" className={LINK} onClick={onSkipChapter}>
              Skip chapter
            </button>
          )}
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </div>
    </div>
  );
});
