import { useEffect, useRef } from "react";

/**
 * Cancels the composer when the table hosting it unmounts: a collapsed
 * card, a raw diff toggled off or a compare lens switch would otherwise
 * leave the anchor set with no composer on screen, and the page shortcuts
 * dead behind it. The check is deferred one microtask because a StrictMode
 * remount runs this cleanup and the effect again inside one commit.
 */
export function useComposerHostUnmount(
  hostsComposer: boolean,
  cancelComposer: () => void,
): void {
  const hosting = useRef(hostsComposer);
  hosting.current = hostsComposer;
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current && hosting.current) {
          cancelComposer();
        }
      });
    };
  }, [cancelComposer]);
}
