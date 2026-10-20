import {
  autoUpdate,
  flip,
  offset,
  size,
  useFloating,
} from "@floating-ui/react";
import type { CSSProperties } from "react";

import {
  POPOVER_OFFSET_PX,
  POPOVER_VIEWPORT_PADDING_PX,
} from "../Popover/consts";
import { fitListToAnchor, ignoreAnchor } from "./utils";

/** What floats the mention list under the textarea; the list's ref and style are absent in flow. */
export interface FloatingMentionList {
  readonly setAnchor: (node: HTMLElement | null) => void;
  readonly setList: ((node: HTMLElement | null) => void) | undefined;
  readonly listStyle: CSSProperties | undefined;
}

/**
 * Floats the list with a fixed strategy: a fixed box is clipped by no
 * scrolling host and adds nothing to its height, yet stays in the host's
 * DOM, so a modal's ARIA scope still holds the list the textarea controls.
 */
export function useFloatingMentionList(floats: boolean): FloatingMentionList {
  const { refs, floatingStyles } = useFloating({
    strategy: "fixed",
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(POPOVER_OFFSET_PX),
      flip({ padding: POPOVER_VIEWPORT_PADDING_PX }),
      size({ apply: fitListToAnchor, padding: POPOVER_VIEWPORT_PADDING_PX }),
    ],
  });

  // floating-ui's setter writes state, so an in-flow list never hands it the textarea.
  if (!floats) {
    return {
      setAnchor: ignoreAnchor,
      setList: undefined,
      listStyle: undefined,
    };
  }
  return {
    setAnchor: refs.setReference,
    setList: refs.setFloating,
    listStyle: floatingStyles,
  };
}
