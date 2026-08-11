import type { TFunction } from "i18next";

import type { GenerationFailureCode } from "../../../types";

/** The two codes whose template interpolates a `{{detail}}`. */
const DETAIL_CODES: ReadonlySet<string> = new Set([
  "generation-config",
  "unknown",
]);

/**
 * The failure sentence. A known code renders `generationError.<code>` — the
 * verbatim-code lookup the spec specifies, so no mapping table can drift.
 * A detail-carrying code with no detail, and an unrecognized code with no
 * detail, both degrade to the no-detail copy rather than printing a template
 * with a hole; an unrecognized code that DID carry a detail keeps it through
 * the generic line.
 */
export function failureLine(
  t: TFunction,
  errorCode: GenerationFailureCode | null,
  errorDetail: string | null,
): string {
  const detail = errorDetail ?? "";
  if (errorCode === null) {
    return detail === ""
      ? t("pulls.failed.noDetail")
      : t("generationError.unknown", { detail });
  }
  if (DETAIL_CODES.has(errorCode) && detail === "") {
    return t("pulls.failed.noDetail");
  }
  return t(`generationError.${errorCode}`, { detail });
}
