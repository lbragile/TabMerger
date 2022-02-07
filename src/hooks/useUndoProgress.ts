import { useEffect, useCallback, useRef, useState } from "react";

import { useSelector, useDispatch } from "./useRedux";

import { setShowUndo, updateUndoTimer } from "~/store/actions/header";

const UNDO_TIMER_SECONDS = 10;

export default function useUndoProgress() {
  const dispatch = useDispatch();

  const { showUndo, undoTimer } = useSelector((state) => state.header);

  const [localUndoTimer, setLocalUndoTimer] = useState(10);

  const undoTimerRef = useRef<NodeJS.Timer | null>(null);

  const resetTimer = useCallback(() => {
    dispatch(setShowUndo(false));
    setLocalUndoTimer(UNDO_TIMER_SECONDS);
    clearInterval(undoTimerRef.current as unknown as number);
    undoTimerRef.current = null;
  }, [dispatch]);

  useEffect(() => {
    if (showUndo && !undoTimerRef.current) {
      // Start timer immediately
      setLocalUndoTimer((prev) => prev - 1);

      undoTimerRef.current = setInterval(() => {
        setLocalUndoTimer((prev) => prev - 1);
      }, 1000);
    }

    return () => clearInterval(undoTimerRef.current as unknown as number);
  }, [showUndo]);

  useEffect(() => {
    if (undoTimer === UNDO_TIMER_SECONDS) {
      setLocalUndoTimer(UNDO_TIMER_SECONDS);
    }
  }, [undoTimer]);

  useEffect(() => {
    dispatch(updateUndoTimer(localUndoTimer));

    /**
     * Clear the countdown timer interval
     * @note Need to wait until -1 to "exit" at 0 seconds
     */
    if (localUndoTimer === -1) {
      resetTimer();
    }
  }, [dispatch, localUndoTimer, resetTimer]);

  return { resetTimer, completed: (undoTimer * 100) / UNDO_TIMER_SECONDS };
}
