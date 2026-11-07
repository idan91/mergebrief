import { useMemo, useSyncExternalStore } from "react";

import { MOBILE_QUERY, readLandscapePhone } from "@web/hooks/useMobileViewport";
import {
  DESKTOP_WRAP_COLUMNS,
  derivePhoneWrapColumns,
  type PhoneLayout,
  type SideInsets,
  type WrapColumns,
} from "./chunk-height-model";

// The bleed query in ChunkCard.module.scss and base.scss; chunk-height-model.stylesheets.test.ts compares.
export const CARD_BLEED_QUERY = "(width < 760px)";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** What a rem resolves to; absent where the root reports no size. */
function readRemPx(): number | undefined {
  const { fontSize } = getComputedStyle(document.documentElement);
  const remPx = Number.parseFloat(fontSize);
  return remPx > 0 ? remPx : undefined;
}

function readInsetPx(style: CSSStyleDeclaration, property: string): number {
  const insetPx = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(insetPx) ? insetPx : 0;
}

/** The side insets tokens.scss publishes from env(); only a sideways phone has any. */
function readSideInsets(): SideInsets {
  const style = getComputedStyle(document.documentElement);
  return {
    leftPx: readInsetPx(style, "--safe-area-inset-left"),
    rightPx: readInsetPx(style, "--safe-area-inset-right"),
  };
}

/** Bands from the media queries the CSS reads; the width inside the scrollbar, which a pinch zoom leaves alone. */
function readWrapColumns(): WrapColumns {
  if (!window.matchMedia(MOBILE_QUERY).matches) {
    return DESKTOP_WRAP_COLUMNS;
  }
  const cardBleeds = window.matchMedia(CARD_BLEED_QUERY).matches;
  const widthPx = document.documentElement.clientWidth;
  const layout: PhoneLayout = { widthPx, cardBleeds, remPx: readRemPx() };
  if (!readLandscapePhone()) {
    return derivePhoneWrapColumns(layout);
  }
  return derivePhoneWrapColumns({ ...layout, insets: readSideInsets() });
}

function readUnifiedColumns(): number {
  return readWrapColumns().unified;
}

function readSplitColumns(): number {
  return readWrapColumns().split;
}

function readServerUnifiedColumns(): number {
  return DESKTOP_WRAP_COLUMNS.unified;
}

function readServerSplitColumns(): number {
  return DESKTOP_WRAP_COLUMNS.split;
}

/** The columns code wraps at in this viewport; the desktop's during SSR and hydration. Renders only when a count changes. */
export function useWrapColumns(): WrapColumns {
  const unified = useSyncExternalStore(
    subscribe,
    readUnifiedColumns,
    readServerUnifiedColumns,
  );
  const split = useSyncExternalStore(
    subscribe,
    readSplitColumns,
    readServerSplitColumns,
  );

  return useMemo(() => ({ unified, split }), [unified, split]);
}
