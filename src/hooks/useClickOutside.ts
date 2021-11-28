import { RefObject, useEffect } from "react";

export default function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T>,
  cb: (e: PointerEvent) => void
): void {
  useEffect(() => {
    const listener = (e: PointerEvent) => {
      const elem = ref?.current;

      // Do nothing if clicking ref's element or descendent elements
      if (!elem || elem.contains(e.target as Node)) return;

      cb(e);
    };

    document.addEventListener("pointerdown", listener);
    return () => document.removeEventListener("pointerdown", listener);
  }, [ref, cb]);
}
