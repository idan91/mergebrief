// Own-draft state derivation (BRIEF-43, ADR 0031): the SINGLE source for
// "the viewer is reading their own draft PR". Derived at read time from the
// PrView booleans the server computes per request — never stored, never a
// self-declared toggle, never dependent on how the page was entered
// (behavior follows visible state, the ADR 0031 invariant). Everything the
// own-draft state changes (chip, hidden submit/receipt, read-only flags, the
// mark-ready CTA) keys off this one predicate.

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
  readonly generate: boolean;
  readonly debounceSeconds: number | null;
}

export interface DraftPolicyNotice {
  readonly kind: "drafts-off" | "damped";
  readonly text: string;
}

/**
 * The own-draft policy notice (BRIEF-64 decision 6): explains why the brief
 * is absent (instance has drafts off) or slow to refresh (damping window) —
 * to the DRAFT'S OWN AUTHOR only; reviewers of someone else's draft and any
 * ready-PR view get nothing. The damped text states the CONFIGURED window
 * (never a hardcoded duration — the operator picks it). Null when there is
 * nothing to explain: no policy on the row (list rows) or the zero-config
 * default.
 */
export function draftPolicyNotice(
  policy: DraftPolicyNoticeSource | undefined,
  view: OwnDraftSource,
): DraftPolicyNotice | null {
  if (policy === undefined || !isOwnDraft(view)) return null;
  if (!policy.generate) {
    return {
      kind: "drafts-off",
      text: "Brief generation for draft pull requests is off on this instance — the brief will generate when this pull request is marked ready for review.",
    };
  }
  if (policy.debounceSeconds !== null) {
    // "can take up to" — an upper bound, deliberately: the FE cannot tell a
    // damped regeneration from the two never-damped queued cases (first
    // generation, review-triggered regen — plan decisions 3/7), where the
    // job fires on the normal window. An exact claim would over-promise the
    // wait there; the bound is true in every case. Revisit trigger recorded
    // in the plan (echo the applied window on the generation summary).
    return {
      kind: "damped",
      text: `Draft mode — the brief can take up to ${formatWindow(policy.debounceSeconds)} to refresh after the last push.`,
    };
  }
  return null;
}

/** "about a minute" under 2 minutes, else "about N minutes" (rounded). */
function formatWindow(seconds: number): string {
  if (seconds < 120) return "about a minute";
  return `about ${String(Math.round(seconds / 60))} minutes`;
}
