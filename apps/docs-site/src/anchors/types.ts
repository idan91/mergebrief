import type { ValueOf } from "types";

export const AnchorProblemKinds = {
  MISSING_PAGE: "missing-page",
  MISSING_ANCHOR: "missing-anchor",
  OUTSIDE_BASE: "outside-base",
  MALFORMED_HREF: "malformed-href",
} as const;

export type AnchorProblemKind = ValueOf<typeof AnchorProblemKinds>;

export interface DeadAnchor {
  /** Built page holding the link, relative to the output folder. */
  page: string;
  href: string;
  kind: AnchorProblemKind;
}

export interface BuiltPage {
  ids: ReadonlySet<string>;
  hrefs: readonly string[];
}
