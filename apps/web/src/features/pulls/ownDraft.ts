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
