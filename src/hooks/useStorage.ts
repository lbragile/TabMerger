import { useCallback, useEffect, useState, Dispatch, SetStateAction } from "react";

type TSetState<T> = Dispatch<SetStateAction<T>>;

export default function useStorage<T>(key: string, initialValue: T): [T, TSetState<T>] {
  const [storedValue, setStoredValue] = useState(initialValue);

  const setValue: TSetState<T> = useCallback(
    (value) => {
      if (!(value instanceof Function)) {
        chrome.storage.local.set({ [key]: value }, () => setStoredValue(value));
      }
    },
    [key]
  );

  const handleStorageChange = useCallback(
    () => chrome.storage.local.get(key, (result) => result[key] && setStoredValue(result[key] as T)),
    [key]
  );

  useEffect(() => {
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.addListener(handleStorageChange);
  }, [handleStorageChange]);

  return [storedValue, setValue];
}
