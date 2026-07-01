# Comparison Baselines and Generated Revision Narratives

The Brief page now has an explicit **Compare** model: the user can view a full **Brief** with no comparison, compare it against the shared **Previous Brief**, or compare it against their personal last-review **Checkpoint**. When a comparison is selected, the same baseline drives both FE line highlights and the changed-only narrative, so users do not have to learn two unrelated concepts ("global revision lines" versus "personal delta brief").

For the shared **Previous Brief** comparison, non-first full **Briefs** get a generated **Revision narrative** for the immediately previous briefed head → current head span, alongside mechanical **Revision changes** marks. This supersedes ADR 0021's "opportunistic callout only" stance: the marks remain cheap and mechanical, but line-level summaries are product behavior, not an accident of a reviewer-scoped **Delta Brief** happening to exist.

The Revision narrative is its own lean artifact and prompt, not the existing Delta Brief schema reused under a different name. It is generated from the incremental `prevHead→head` diff plus the current full Brief as context, attaches narrative chunks to the full Brief's existing Change-group IDs, and carries no reviewer Checkpoint, comments-addressed analysis, carry-over state, or "since you last looked" language.

## Considered Options

- **Reuse Delta Brief unchanged.** Rejected because the schema and prompt are reviewer-returning concepts: comments addressed, whole-PR impact, and "since you last looked" copy would leak into a shared full-Brief surface.
- **Lean Revision narrative artifact.** Chosen because the full Brief only needs run-level summaries and group context for shared `prevHead→head` changes.
- **Generate independent changed groups.** Rejected because it would create a parallel grouping system inside the full Brief.
- **Attach to full Brief Change-groups.** Chosen because the full Brief owns the taxonomy and the Revision narrative only explains the newest lines.
- **Generate from incremental diff only.** Rejected because it would likely invent a parallel grouping vocabulary beside the current full Brief.
- **Generate from incremental diff plus current full Brief.** Chosen so summaries stay grounded in the changed lines and aligned with the full Brief the reviewer is reading.
- **Keep global revision highlights and personal Delta Brief as separate surfaces.** Rejected because it forces users to understand two different comparison models.
- **Use one Compare control for shared and personal baselines, plus Off.** Chosen because "compare this Brief against X" is the product concept when a comparison is active, while `Off` preserves the normal full-PR Brief without forcing a fake baseline.

## Generation

- Every debounced push still generates the full **Brief** for the current head.
- Every selectable comparison span gets a mechanical changed-line sidecar keyed by `(baselineSha, headSha)`. These sidecars are the source of truth for FE highlighting and do not depend on LLM output.
- If this is not the first Brief for the PR, generation also produces the **Previous Brief** comparison: mechanical marks for `prevHead→head` plus the lean **Revision narrative**.
- For known returning reviewers, generation/pre-warming also produces the personal comparison from their **Checkpoint** to the current head: mechanical marks for `checkpoint→head` plus the existing **Delta Brief** narrative/carry-over overlay.
- Revision narrative failure must not fail the full Brief. The UI can still render mechanical marks and honest "summary unavailable" states.

## Frontend

- Timeline navigation remains one point per full **Brief** head, preserving ADR 0019's revision navigation model.
- Replace the current `Full / Delta` lens with two controls: **View** and **Compare**.
- Replace the narrow Revision changes toggle with the broader **Compare** control.
- `Compare: Previous Brief` selects shared `prevHead→head` marks and the Revision narrative.
- `Compare: Your last review` selects personal `checkpoint→head` marks and the existing Delta Brief.
- `Compare: Off` is available only in `Full Brief`; it selects no comparison baseline, so there are no comparison highlights, callouts, or filters.
- When both comparisons exist, they are peer options in one Compare control. **Your last review** is the default for returning reviewers; **Previous Brief** remains directly selectable rather than hidden in overflow.
- **View** is orthogonal: `Full Brief` renders the full artifact; `Changes Only` renders a compact change-focused view.
- With `Compare: Previous Brief`, `Changes Only` renders the Revision narrative.
- With `Compare: Your last review`, `Changes Only` renders the existing Delta Brief.
- `Changes Only` requires an active comparison. If the user enters `Changes Only` while comparison is off, the UI selects the product default comparison; if no comparison exists, `Changes Only` is unavailable.
- User-facing UI uses two controls: **View** (`Full Brief`, `Changes Only`) chooses rendering density; **Compare** (`Your last review`, `Previous Brief`, `Off`) chooses whether an extra comparison is applied in full view. "Delta Brief" remains an internal/domain artifact name, not the visible label for the changed-only view.
- Defaults are product-aware: first-time reviewers default to `Full Brief + Off`; returning reviewers with an older Checkpoint default to **Your last review**. **Previous Brief** remains directly selectable whenever available.
- Highlighting is mechanical and deterministic; generated narratives only supply summaries/callouts and never decide which lines are marked.

## Consequences

- Non-first Brief generation now performs an additional LLM call after the full Brief and mechanical Revision changes are available.
- The Revision narrative can fail independently: the full Brief and mechanical Revision changes still render, with unavailable summaries.
- ADR 0021's rendering and mechanical-marking model still stands. Superseded pieces: its "do not generate solely for the overlay" decision, and its decision 5 toggle (on-by-default, persisted per user) — replaced by the **Compare** control, whose defaults are product-aware (first-time reviewers get `Off`) and whose state is session-only (URL + in-session stickiness; defaults recompute per arrival, no per-user persistence).
- FE and generation now share the same comparison-baseline vocabulary, reducing the global-versus-personal delta confusion.
