import { useCallback } from "react";

import type {
  BriefAddressSearch,
  BriefSearchParams,
} from "../../../../model/comparison/compare-state";
import type { ScopeExitOptions } from "../types";
import type { BriefAddressPort, NavigateSearch } from "./types";

function writeLink(
  { l: _link, ...rest }: BriefAddressSearch,
  link: string | undefined,
): BriefAddressSearch {
  const next: BriefAddressSearch = { ...rest };
  if (link !== undefined) {
    next.l = link;
  }

  return next;
}

function writeFocus(
  { focus: _focus, ...rest }: BriefAddressSearch,
  focus: boolean,
): BriefAddressSearch {
  const next: BriefAddressSearch = { ...rest };
  if (focus) {
    next.focus = true;
  }

  return next;
}

function dropDiff({ diff: _diff, ...rest }: BriefAddressSearch) {
  return rest;
}

function writeScope(
  { view: _view, compare: _compare, diff: _diff, ...rest }: BriefAddressSearch,
  next: BriefSearchParams,
): BriefAddressSearch {
  return { ...rest, ...next };
}

/**
 * The URL writes both Brief routes hand the screen, so neither route spells
 * them. A posture (the link, Focus mode, the diff deep link) replaces
 * history; a Scope write pushes unless the caller asks to replace. Every
 * writer keeps the params it does not own.
 */
export function useBriefAddress(
  search: BriefAddressSearch,
  navigate: NavigateSearch<BriefAddressSearch>,
): BriefAddressPort {
  const navigateLink = useCallback(
    (link: string | undefined) => {
      void navigate({
        search: (previous) => writeLink(previous, link),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const setFocusParam = useCallback(
    (focus: boolean) => {
      void navigate({
        search: (previous) => writeFocus(previous, focus),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const clearDiffParam = useCallback(() => {
    void navigate({ search: dropDiff, replace: true });
  }, [navigate]);
  const navigateSearch = useCallback(
    (next: BriefSearchParams, options?: ScopeExitOptions) => {
      void navigate({
        search: (previous) => writeScope(previous, next),
        replace: options?.replace ?? false,
      });
    },
    [navigate],
  );

  return {
    link: search.l,
    navigateLink,
    setFocusParam,
    clearDiffParam,
    navigateSearch,
  };
}
