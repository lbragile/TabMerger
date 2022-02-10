import { useCallback, useEffect, useState } from "react";

import type { Dispatch, SetStateAction } from "react";

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
    (changes: { [key: string]: chrome.storage.StorageChange }, areaName: chrome.storage.AreaName) => {
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
