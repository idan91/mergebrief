import type { ValueOf } from "types/utils";

export const LinkFetchModes = {
  PUBLIC: "public",
  OFF: "off",
  ALLOWLIST: "allowlist",
} as const;
export type LinkFetchMode = ValueOf<typeof LinkFetchModes>;

/** What the generic link fetcher may read; `hosts` is non-empty only under the allowlist. */
export interface LinkFetchPolicy {
  readonly mode: LinkFetchMode;
  /** Exact lowercase hostnames, matched against the link's own host. */
  readonly hosts: readonly string[];
}
