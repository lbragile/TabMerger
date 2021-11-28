import { useCallback, useEffect } from "react";
import GROUPS_CREATORS from "../store/actions/groups";
import { useDispatch } from "./useDispatch";

/** @note The main logic for updating tabs/windows is done in the background script */
export default function useUpdateWindows(): void {
  const dispatch = useDispatch();

  const updateGroupDetails = useCallback(() => {
    chrome.storage.local.get(null, (result) => {
      if (result.active && result.available) {
        dispatch(GROUPS_CREATORS.updateActive(result.active));
        dispatch(GROUPS_CREATORS.updateAvailable(result.available));
      }
    });
  }, [dispatch]);

  /** When the popup is first opened, get the list of all windows */
  useEffect(() => updateGroupDetails(), [updateGroupDetails]);

  /** When a tab is created OR a tab is updated OR a window is created */
  useEffect(() => {
    chrome.storage.onChanged.addListener(updateGroupDetails);
    return () => chrome.storage.onChanged.addListener(updateGroupDetails);
  }, [updateGroupDetails]);
}
