import { useEffect } from "react";
import { useDispatch } from "./useDispatch";
import GROUPS_CREATORS from "../store/actions/groups";
import { useSelector } from "./useSelector";

export default function useStorage(key: string): void {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups);

  // get local storage groups on initial load (update available list)
  useEffect(() => {
    chrome.storage.local.get(key, (result) => {
      if (result) {
        dispatch(GROUPS_CREATORS.updateAvailable(result[key]));
      }
    });
  }, [dispatch, key]);

  // update chrome storage (local) whenever the groups update to persist changes
  useEffect(() => {
    chrome.storage.local.set({ groups: available });
  }, [available]);
}
