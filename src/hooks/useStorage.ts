import { useEffect } from "react";
import { IGroupsState } from "../store/reducers/groups";
import GROUPS_CREATORS from "../store/actions/groups";
import { useDispatch } from "./useDispatch";

export default function useStorage({ active, available }: IGroupsState): void {
  const dispatch = useDispatch();

  useEffect(() => {
    chrome.storage.local.get(null, (result) => {
      const { available: storageAvailable, active: storageActive } = result as IGroupsState;
      if (storageAvailable) {
        dispatch(GROUPS_CREATORS.updateAvailable(storageAvailable));
      }

      if (storageActive) {
        dispatch(GROUPS_CREATORS.updateActive(storageActive));
      }
    });
  }, [dispatch]);

  useEffect(() => {
    chrome.storage.local.set({ available, active }, () => "");
  }, [active, available]);
}
