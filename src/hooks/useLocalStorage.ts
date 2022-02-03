import { useCallback, useEffect, useState } from "react";

import { useDispatch } from "./useRedux";

import type { Dispatch, SetStateAction } from "react";
import type { IGroupsState } from "~/store/reducers/groups";

import { updateAvailable, updateActive } from "~/store/actions/groups";
import { setAnchorState } from "~/store/actions/history";

interface IChanges {
  [key: string]: chrome.storage.StorageChange;
}

type TAreaName = "sync" | "local" | "managed";

export default function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    (value) => {
      chrome.storage.local.set({ [key]: value }, () => {
        setStoredValue(value);
      });
    },
    [key]
  );

  useEffect(() => {
    chrome.storage.local.get([key], (value) => {
      setValue(value[key] ?? initialValue);
    });
  }, [key, initialValue, setValue]);

  const handleStorageChange = useCallback(
    (changes: IChanges, areaName: TAreaName) => {
      if (areaName === "local" && changes[key]) {
        setStoredValue(changes[key].newValue);
      }
    },
    [key]
  );

  useEffect(() => {
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [handleStorageChange]);

  return [storedValue, setValue];
}

export function useUpdateGroupsFromStorage({ active, available }: IGroupsState): void {
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

      // Set undo/redo anchor
      dispatch(setAnchorState({ available: storageAvailable, active: storageActive }));
    });
  }, [dispatch]);

  useEffect(() => {
    chrome.storage.local.set({ available, active }, () => "");
  }, [active, available]);
}
