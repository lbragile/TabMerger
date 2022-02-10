import { useState, useEffect } from "react";

import useLocalStorage from "./useLocalStorage";

import type { Dispatch, SetStateAction } from "react";

/**
 * This is a wrapper for using local storage in scenarios where it is needed to also
 * be able to cancel/save based on some local state
 * @note In most cases the first element that is returned is not needed, but is provided for convenience
 */
export default function useStorageWithSave<T>(
  key: string,
  initialValue: T
): [T, Dispatch<SetStateAction<T>>, T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useLocalStorage(key, initialValue);

  const [localValue, setLocalValue] = useState(initialValue);

  useEffect(() => setLocalValue(value), [value]);

  return [value, setValue, localValue, setLocalValue];
}
