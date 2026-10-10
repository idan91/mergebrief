import {
  buildBriefSearchParams,
  type BriefSearchParams,
} from "../../../comparison/compareState";
import type { BriefAddress, ScopeExitOptions } from "../types";
import type { BriefAddressPort } from "./types";

export interface BriefAddressInput {
  port: BriefAddressPort;
  searchParams: BriefSearchParams;
  /** Each route normalises the Scope exit its own way. */
  exitChangesScope: (options?: ScopeExitOptions) => void;
  revisionPending: boolean;
}

export interface FileAddressInput {
  port: BriefAddressPort;
  searchParams: BriefSearchParams;
  revisionPending: boolean;
}

/** The screen never writes the View/Compare trio itself, so the port's `navigateSearch` stays with the route. */
export function buildBriefAddress({
  port,
  searchParams,
  exitChangesScope,
  revisionPending,
}: BriefAddressInput): BriefAddress {
  return {
    searchParams,
    link: port.link,
    navigateLink: port.navigateLink,
    setFocusParam: port.setFocusParam,
    clearDiffParam: port.clearDiffParam,
    exitChangesScope,
    revisionPending,
  };
}

/** The file route's address: its Scope exit keeps Compare and diff as the URL has them. */
export function buildFileAddress(input: FileAddressInput): BriefAddress {
  const { port, searchParams } = input;
  function exitChangesScope(options?: ScopeExitOptions): void {
    const next = buildBriefSearchParams(
      "full",
      searchParams.compare,
      searchParams.diff,
    );
    port.navigateSearch(next, options);
  }

  return buildBriefAddress({ ...input, exitChangesScope });
}
