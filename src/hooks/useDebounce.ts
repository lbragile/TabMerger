import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay?: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay ?? 100);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function useDebounceCallback(cb: () => void, delay?: number): void {
  useEffect(() => {
    const timer = setTimeout(cb, delay ?? 100);

    return () => clearTimeout(timer);
  }, [cb, delay]);
}
