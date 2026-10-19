import { useEffect, useRef, type RefObject } from "react";

/** Focus the returned heading once it has committed, if the block it replaced handed focus off. */
export function useHandedOffFocus(
  handedOff: boolean,
  onTaken: () => void,
): RefObject<HTMLHeadingElement | null> {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    if (!handedOff || heading === null) {
      return;
    }
    heading.focus();
    onTaken();
  }, [handedOff, onTaken]);

  return headingRef;
}
