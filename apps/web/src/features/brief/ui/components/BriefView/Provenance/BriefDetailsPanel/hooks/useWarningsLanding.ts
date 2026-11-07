import { useEffect, useRef } from "react";

import { DetailsSurfaces, type DetailsSurfaceState } from "../types";

export function useWarningsLanding(
  warningsNode: HTMLDivElement | null,
  surface: DetailsSurfaceState,
): () => void {
  const { openSurface, close, pin, pinOpen, isPinned } = surface;
  // A chip click lands ON the warnings text; a hover preview leaves focus put.
  // Keyed on the node: Callout's FloatingPortal mounts its children a commit
  // after the open flip.
  const landOnWarnings = useRef(false);
  useEffect(() => {
    const landing = warningsNode !== null && landOnWarnings.current;
    if (!landing) {
      return;
    }
    landOnWarnings.current = false;
    warningsNode.focus();
  }, [warningsNode]);

  const activateWarnings = () => {
    if (openSurface !== DetailsSurfaces.WARNINGS) {
      landOnWarnings.current = true;
      pin(DetailsSurfaces.WARNINGS);
      return;
    }
    if (isPinned()) {
      close();
      return;
    }
    pinOpen();
    if (warningsNode === null) {
      landOnWarnings.current = true;
    } else {
      warningsNode.focus();
    }
  };

  return activateWarnings;
}
