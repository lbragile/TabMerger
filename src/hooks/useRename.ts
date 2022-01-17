import { useState, useEffect, useCallback } from "react";

import { useDebounce, useDebounceCallback } from "./useDebounce";

/**
 * Whenever an "item" (group / window) needs a name update, this hook ensures that both local and global state
 * are persisted and remain the most current value
 * @param dispatcher Updates the global state, which in turn updates local storage to persist the change
 * @param name The current name of the "item"
 * @param delay Debounce duration
 * @returns Local state & corresponding handler - to display most up-to-date information
 */
export default function useRename(dispatcher: () => void, name: string, delay = 250): [string, (arg: string) => void] {
  const [value, setValue] = useState("");

  const debouncedValue = useDebounce(value, delay);

  useEffect(() => setValue(name), [name]);

  const debounceHandler = useCallback(() => {
    if (value !== name && value === debouncedValue) {
      dispatcher();
    }
  }, [dispatcher, value, debouncedValue, name]);

  useDebounceCallback(debounceHandler, delay);

  return [value, setValue];
}
