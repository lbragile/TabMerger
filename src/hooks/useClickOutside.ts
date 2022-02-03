import { useEffect } from "react";

import type { RefObject} from "react";

interface IClickOutside<T> {
  ref: RefObject<T>;
  cb: (e: PointerEvent) => void;
  preCondition?: boolean;
}

export default function useClickOutside<T extends HTMLElement = HTMLElement>({
  ref,
  cb,
  preCondition = true
}: IClickOutside<T>): void {
  useEffect(() => {
    const listener = (e: PointerEvent) => {
      if (preCondition) {
        const elem = ref.current;

        // Do nothing if clicking ref's element or descendent elements
        if (!elem || elem.contains(e.target as Node)) return;

        cb(e);
      }
    };

    document.addEventListener("pointerdown", listener);

    return () => document.removeEventListener("pointerdown", listener);
  }, [ref, cb, preCondition]);
}
