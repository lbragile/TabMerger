import { useEffect } from "react";
import { ActionCreators } from "redux-undo";

import { useDispatch } from "./useRedux";

import type { IGroupsState } from "~/store/reducers/groups";

import { updateAvailable, updateActive } from "~/store/actions/groups";

export default function useInitState({ active, available }: IGroupsState): void {
  const dispatch = useDispatch();

  useEffect(() => {
    chrome.storage.local.get(null, (result) => {
      const { available: storageAvailable, active: storageActive } = result as IGroupsState;
      if (storageAvailable) {
        dispatch(updateAvailable(storageAvailable));
      }

      if (storageActive) {
        dispatch(updateActive(storageActive));
      }

      // Initial state for undo/redo functionality
      dispatch(ActionCreators.clearHistory());
    });
  }, [dispatch]);

  useEffect(() => {
    chrome.storage.local.set({ available, active }, () => "");
  }, [active, available]);
}
