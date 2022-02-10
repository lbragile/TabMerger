import { useEffect, useState } from "react";

import type { MutableRefObject } from "react";

/**
 * This is useful for dynamically computing  the height of containers relative to some bottom position
 * @param ref The container reference
 * @param updateList A state list that should trigger re-calculation
 * @returns The container's height such that it does not surpass the bottom position
 */
export default function useContainerHeight(ref: MutableRefObject<HTMLDivElement | null>, ...updateList: unknown[]) {
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const { top } = ref.current.getBoundingClientRect();
      setContainerHeight(590 - top);
    }
  }, [ref, updateList]);

  return containerHeight;
}
