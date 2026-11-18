import type { TFunction } from "i18next";

import {
  RegenerateResultKinds,
  type RegenerateNoticeKeys,
  type RegenerateResultKind,
} from "../../types";

/** A queued run swaps the card, and that swap is announced by the page. */
export const RegenerateNotices: RegenerateNoticeKeys = {
  [RegenerateResultKinds.QUEUED]: undefined,
  [RegenerateResultKinds.HELD]: "pulls.briefError.generation-held",
  [RegenerateResultKinds.NOT_REGENERABLE]:
    "pulls.briefError.generation-not-regenerable",
  [RegenerateResultKinds.NOT_ALLOWED]: "pulls.failed.regenerate.notAllowed",
  [RegenerateResultKinds.UNAUTHORIZED]: "pulls.failed.regenerate.unauthorized",
  [RegenerateResultKinds.UPSTREAM]: "pulls.failed.regenerate.upstream",
  [RegenerateResultKinds.INDETERMINATE]:
    "pulls.failed.regenerate.indeterminate",
};

export function readRegenerateNotice(
  t: TFunction,
  kind: RegenerateResultKind,
  notices: RegenerateNoticeKeys = RegenerateNotices,
): string | undefined {
  const key = notices[kind];
  if (key === undefined) {
    return undefined;
  }
  return t(key);
}

/** The answers that say the meta read is stale. */
const META_STALE_KINDS: ReadonlySet<RegenerateResultKind> = new Set([
  RegenerateResultKinds.QUEUED,
  RegenerateResultKinds.HELD,
  RegenerateResultKinds.NOT_REGENERABLE,
]);

export function refreshesMeta(kind: RegenerateResultKind): boolean {
  return META_STALE_KINDS.has(kind);
}
