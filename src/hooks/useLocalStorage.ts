import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";

import { useDispatch } from "./useRedux";

import { updateAvailable, updateActive } from "~/store/actions/groups";
import { IGroupsState } from "~/store/reducers/groups";

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
      setValue(value[key] ? (value[key] as T) : initialValue);
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
    });
  }, [dispatch]);

  useEffect(() => {
    chrome.storage.local.set({ available, active }, () => "");
  }, [active, available]);
}
