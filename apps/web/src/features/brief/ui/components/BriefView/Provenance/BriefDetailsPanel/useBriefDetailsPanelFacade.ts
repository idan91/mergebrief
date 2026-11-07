import { useId, useState } from "react";

import { useDetailsSurface } from "./hooks/useDetailsSurface";
import { useEscapeToClose } from "./hooks/useEscapeToClose";
import { useOutsidePressToClose } from "./hooks/useOutsidePressToClose";
import { useWarningsLanding } from "./hooks/useWarningsLanding";
import { DetailsSurfaces } from "./types";

export function useBriefDetailsPanelFacade() {
  const surfaceId = useId();
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const [chipEl, setChipEl] = useState<HTMLButtonElement | null>(null);
  const [warningsNode, setWarningsNode] = useState<HTMLDivElement | null>(null);

  const surface = useDetailsSurface(surfaceId, chipEl, triggerEl);
  const activateWarnings = useWarningsLanding(warningsNode, surface);
  const surfaceOpen = surface.openSurface !== undefined;
  useEscapeToClose(surfaceOpen, surface.close);
  const warningsOpen = surface.openSurface === DetailsSurfaces.WARNINGS;
  useOutsidePressToClose(warningsOpen, surfaceId, chipEl, surface.close);

  return {
    surfaceId,
    factsOpen: surface.openSurface === DetailsSurfaces.FACTS,
    warningsOpen,
    triggerEl,
    setTriggerEl,
    chipEl,
    setChipEl,
    setWarningsNode,
    closeOnLeave: surface.closeOnLeave,
    toggle: surface.toggle,
    activateWarnings,
    previewOnHover: surface.previewOnHover,
    endHover: surface.endHover,
  };
}
