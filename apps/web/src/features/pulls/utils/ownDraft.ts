// The SINGLE source for "the viewer is reading their own draft PR". Derived
// at read time from the PrView booleans the server computes per request,
// never stored, never a self-declared toggle, never dependent on how the page
// was entered (behavior follows visible state). Everything the own-draft state
// changes keys off this one predicate.

import type { TFunction } from "i18next";

/** The two server-derived booleans the state reads (a `PrSummary` slice). */
export interface OwnDraftSource {
  /** GitHub draft state, mirrored from the PR row. */
  readonly draft: boolean;
  /** Server-derived per request; the author login never crosses the wire. */
  readonly viewerIsAuthor: boolean;
}

/** True iff the viewer is reading their OWN DRAFT pull request. */
export function isOwnDraft(view: OwnDraftSource): boolean {
  return view.draft && view.viewerIsAuthor;
}

/** The instance draft-policy slice the notice reads (a `DraftPolicySummary`). */
export interface DraftPolicyNoticeSource {
  readonly debounceSeconds?: number;
}

export interface DraftPolicyNotice {
  readonly text: string;
}

/**
 * The own-draft policy notice: explains why the brief is slow to refresh
 * (damping window). It is shown to the DRAFT'S OWN AUTHOR only; reviewers of
 * someone else's draft and any ready-PR view get nothing. The text states the
 * CONFIGURED window (never a hardcoded duration, since the operator picks it).
 * Absent when there is nothing to explain: no policy on the row (list rows)
 * or the zero-config default.
 */
export function draftPolicyNotice(
  t: TFunction,
  policy: DraftPolicyNoticeSource | undefined,
  view: OwnDraftSource,
): DraftPolicyNotice | undefined {
  if (policy === undefined || !isOwnDraft(view)) {
    return undefined;
  }
  if (policy.debounceSeconds !== undefined) {
    // "can take up to" is an upper bound, deliberately: the FE cannot tell a
    // damped regeneration from the two never-damped pending cases (first
    // generation, review-triggered regen), where the
    // job fires on the normal window. An exact claim would over-promise the
    // wait there; the bound is true in every case. Revisit trigger recorded
    // in the plan (echo the applied window on the generation summary).
    return {
      text: t("pulls.ownDraft.damped", {
        window: formatWindow(t, policy.debounceSeconds),
      }),
    };
  }
  return undefined;
}

/** "about a minute" under 2 minutes, else "about N minutes" (rounded). */
function formatWindow(t: TFunction, seconds: number): string {
  if (seconds < 120) {
    return t("pulls.ownDraft.windowMinute");
  }
  return t("pulls.ownDraft.windowMinutes", {
    count: Math.round(seconds / 60),
  });
}
