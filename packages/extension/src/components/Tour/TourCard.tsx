import { forwardRef, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t as translate } from '@/lib/i18n';
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
   * For a task that visits several controls in a row: which one the action ring is on now.
   * Shown next to the title as dots and "2 of 3". `null` when there is nothing to count.
   */
  subStep?: { current: number; total: number } | null;
  /**
   * True on the step that introduces its chapter to this user in this run: the chapter's
   * description is then part of the announcement. It is SHOWN on that step and on the
   * chapter's first step, but announced only here, so it is heard once per chapter.
   */
  introducesChapter?: boolean;
  /**
   * True while the card has to stay small (a dialog the task opened is on screen): the
   * chapter's description is left out.
   */
  compact?: boolean;
  /**
   * True on a drag step: the card is wide and low (docked along the bottom of the main panel by
   * `Tour.tsx`), so the rows being dragged and the drop marker above it stay in view. The
   * chapter header becomes one line and the "Skip" links share the row of the buttons.
   */
  wide?: boolean;
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
export const tourDialogLabel = (): string => translate('tour.card.dialogLabel');

// Solid, high-contrast buttons from the theme's own foreground/background pair: AA in both
// themes without depending on the brand color (white on the light theme's cyan is too faint).
const BUTTON =
  'inline-flex h-7 items-center justify-center px-3 text-xs font-medium cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const LINK =
  'cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';


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
 * whole step ("Chapter 2 of 6, Organize with groups. Step 5 of 23: title. text"), with the
 * chapter's description after the chapter title on the step that introduces the chapter and
 * on no other step. It is the only thing that
 * changes for a screen reader when the step changes, whether the user pressed a button or an
 * arrow key, because focus stays where it is inside the card. For the same reason the dialog's
 * name is a constant (`tourDialogLabel()`) and the card has no `aria-describedby`: a name or
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
  { step, body, progress, position, taskStatus, subStep = null, introducesChapter = false, compact = false, wide = false, practice, onNext, onBack, onSkip, onSkipStep, onSkipChapter, onRemovePractice },
  ref
) {
  const { t } = useTranslation();
  const titleId = useId();
  const isFirst = progress.step === 1;
  const isLast = progress.step === progress.total;
  const chapterLine = t('tour.card.chapterLine', { chapter: progress.chapter, chapters: progress.chapters });
  const stepLine = t('tour.card.stepLine', { step: progress.step, total: progress.total });
  const doneText = step.doneText ?? t('tour.card.done');

  const showChapterIntro = !compact && !wide && !!progress.chapterDescription && (introducesChapter || progress.stepInChapter === 1);
  const chapterIntro = introducesChapter && progress.chapterDescription ? ` ${progress.chapterDescription}` : '';
  // A step with its own text per sub-step is announced whole, once: every sub-step in order,
  // then the keyboard way. The line shown changes as the user goes; the announcement does not.
  const subStepText = step.subStepText ?? [];
  const subStepKeys = step.subStepKeys ?? [];
  const showSubStepText = taskStatus === 'todo' && !!subStep && subStepText.length > 0;
  const allSubSteps = taskStatus === 'todo' && subStepText.length > 0
    ? ` ${subStepText.join(' ')}${subStepKeys.length ? t('tour.card.withKeyboard', { keys: subStepKeys.join(' ') }) : ''}`
    : '';
  const stepAnnouncement = t('tour.card.announcement', {
    chapterLine,
    chapterTitle: progress.chapterTitle,
    chapterIntro,
    stepLine,
    title: step.title,
    body,
    subSteps: allSubSteps,
    yourTurn: taskStatus === 'todo' ? t('tour.card.yourTurnAnnouncement') : ''
  });
  const announcement = taskStatus === 'done' ? t('tour.card.doneAnnouncement', { done: doneText }) : stepAnnouncement;
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(announcement);
  }, [announcement]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={tourDialogLabel()}
      tabIndex={-1}
      data-tour-card={step.id}
      data-tour-task={taskStatus}
      className={cn(
        'pointer-events-auto fixed z-[61] flex max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] flex-col border border-foreground/30 bg-popover text-popover-foreground shadow-lg',
        wide ? 'w-[34rem] px-4 py-3' : 'w-80 p-4',
        'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        // Measured before it is shown, so it never flashes in the wrong place
        !position && 'invisible'
      )}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
    >
      <div {...{ [TOUR_BODY_ATTR]: '' }} className="min-h-0 flex-1 overflow-y-auto">
        <div data-tour-chapter="" className="border-s-2 border-foreground ps-2">
          <div className="flex items-baseline justify-between gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            <p className="min-w-0 truncate">
              {chapterLine}
              {wide && (
                <span data-tour-chapter-title="" className="font-semibold text-foreground">
                  {' · '}
                  {progress.chapterTitle}
                </span>
              )}
            </p>
            <p className="shrink-0">{stepLine}</p>
          </div>
          {!wide && (
            <p data-tour-chapter-title="" className="mt-0.5 text-sm font-semibold leading-snug">
              {progress.chapterTitle}
            </p>
          )}
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

        <div className={cn('flex items-center justify-between gap-2', wide ? 'mt-2' : 'mt-3')}>
          <h2 id={titleId} className="min-w-0 text-[0.8125rem] font-semibold">
            {step.title}
          </h2>
          {/* Not a live region: the ring moving on is announced by the control taking focus.
              The words "2 of 3" are the text equivalent of the dots. */}
          {subStep && (
            <p data-tour-substep={subStep.current} className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] font-medium text-muted-foreground">
              <span aria-hidden="true" className="flex items-center gap-0.5">
                {Array.from({ length: subStep.total }, (_, i) => (
                  <span key={i} data-tour-substep-dot={i + 1 < subStep.current ? 'done' : i + 1 === subStep.current ? 'current' : 'todo'} />
                ))}
              </span>
              <span>
                <span className="sr-only">{t('tour.card.part')}</span>
                {t('tour.card.ofTotal', { current: subStep.current, total: subStep.total })}
              </span>
            </p>
          )}
        </div>
        <p className={cn('text-[0.8125rem]', wide ? 'mt-1 leading-snug' : 'mt-1.5 leading-relaxed')}>{body}</p>
        {showSubStepText && subStep && (
          <>
            <p data-tour-substep-text="" className="mt-2 border-s-2 border-secondary ps-2 text-[0.8125rem] font-medium leading-snug">
              {subStepText[subStep.current - 1] ?? subStepText[subStepText.length - 1]}
            </p>
            {subStepKeys[subStep.current - 1] && (
              <p data-tour-substep-keys="" className="mt-1 ps-2.5 text-xs leading-snug text-muted-foreground">
                <span className="font-medium text-foreground">{t('tour.card.keyboard')}</span>
                {subStepKeys[subStep.current - 1]}
              </p>
            )}
          </>
        )}

        {/* Left out while a sub-step's own instruction is up: that line and the "2 of 3" marker
            already say it is the user's turn, and the card has to stay small next to a drag */}
        {taskStatus === 'todo' && !showSubStepText && (
          <p data-tour-task-line="todo" className="mt-2.5 flex items-start gap-1.5 border border-foreground/30 px-2 py-1.5 text-xs font-medium">
            <Hand aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{t('tour.card.yourTurn')}</span>
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
              <p>{t('tour.card.practiceRemoved')}</p>
            ) : (
              <>
                <p>
                  {practice.tabCount > 0
                    ? t('tour.card.practiceKept', { context: 'tabs', name: practice.name, tabs: t('common.tabCount', { count: practice.tabCount }) })
                    : t('tour.card.practiceKept', { name: practice.name })}
                </p>
                <button type="button" className={cn(BUTTON, 'mt-1.5 border border-border hover:bg-muted')} onClick={onRemovePractice}>
                  {t('tour.card.removePractice')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Wide: one row, the "Skip" links on the left of the buttons. They stay AFTER the buttons
          in the document (and so in the Tab order) and are only drawn first (`order-first`). */}
      <div className={cn(wide ? 'mt-2.5 flex shrink-0 items-center justify-between gap-3' : 'contents')}>
      <div className={cn('flex shrink-0 items-center justify-end gap-2', !wide && 'mt-4')}>
        {!isFirst && (
          <button type="button" className={cn(BUTTON, 'border border-border hover:bg-muted')} onClick={onBack}>
            {t('tour.card.back')}
          </button>
        )}
        {taskStatus === 'todo' ? (
          <button type="button" className={cn(BUTTON, 'border border-foreground/60 hover:bg-muted')} onClick={onSkipStep}>
            {t('tour.card.skipStep')}
          </button>
        ) : (
          <button type="button" className={cn(BUTTON, 'bg-foreground text-background hover:bg-foreground/85')} onClick={onNext}>
            {isLast ? t('tour.card.finish') : t('tour.card.next')}
          </button>
        )}
      </div>

      {!isLast && (
        <div className={cn('flex shrink-0 items-center', wide ? 'order-first gap-4' : 'mt-2.5 justify-between gap-3 border-t border-foreground/15 pt-2')}>
          <button type="button" className={LINK} onClick={onSkip}>
            {t('tour.card.skipTour')}
          </button>
          {onSkipChapter && (
            <button type="button" className={LINK} onClick={onSkipChapter}>
              {t('tour.card.skipChapter')}
            </button>
          )}
        </div>
      )}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announced}
      </div>
    </div>
  );
});
