# 0026: AI-Authorship Risk Attributes — Model-Observed, Positioning-Only

Status: amended (see Amendments)

The AI-authored-code review lens ships in v1 as **three model-observed Risk-Surface
attributes** — `new-dependency`, `new-abstraction`, `comment-contradicts-code` — emitted by
the existing categorization pass, with mechanical validator confirmation for
`new-dependency`. It ships **without** a deterministic detector tier, **without**
`unresolved-import`, and **without** any in-product "AI signals" grouping: the attributes are
authorship-agnostic facts in the brief; the AI-failure-mode framing lives in positioning copy
(README, demo) only (amended, see Amendments). `diverges-from-sibling-pattern` and the narrower `unresolved-reference`
are parked behind the `ContextSource` boundary (ADR 0014).

## Context

The roadmap candidate (`oss-roadmap.md`) framed the lens as a "deterministic / static factual
slice — no LLM-confidence needed": five attributes targeting where AI-authored code
characteristically fails (hallucinated surface, needless dependency/abstraction, convention
drift, lying comments; scope creep already covered by the **Intent check**).

Grilling (2026-07-03) audited that claim against the pipeline's actual inputs and standing
decisions:

- **Only 2 of 5 proposed attributes were actually deterministic**, and one of those
  (`unresolved-import`) needs repo-tree access the pipeline doesn't have — inputs are PR diff
  + metadata + linked context (then fetched via `gh`, now read through the worker's tracker
  transports in `packages/brief-core/src/context/trackers/`), no checkout ("a brief must
  still be producible from the diff alone", now in `packages/brief-core/src/context/fan-out.ts`).
- **`unresolved-import` is redundant where it matters.** In typed repos with CI — exactly the
  repos of the self-hosting audience — `tsc` / `import/no-unresolved` fails the build before
  a human reviews. Re-flagging it re-implements the compiler and violates the
  runs-alongside positioning (ADR 0003).
- **The existing 16 attributes are already model-emitted observations** (`dense-logic` has
  thresholds; `hot-path` requires labeler judgment). A purity split between "mechanically
  verified" and "model-believed" had only one surviving mechanical member
  (`new-dependency`) — too thin to justify an origin tier and distinct rendering.
- **`diverges-from-sibling-pattern` stacks three blockers:** sibling *selection* is a
  judgment problem with the worst FP shape of the set (accusing the author of inconsistency
  based on our sampling error); intentional divergence is routine (`logic-refactor` toward a
  new pattern *should* diverge); and ADR 0014 deliberately deferred consume-side repo
  enrichment behind the `ContextSource` boundary, escalation-tier (ADR 0010). Fetching itself is
  cheap (tree call + 2–4 sibling fetches per group); the blockers are judgment and sequencing.
- **Runtime cost was a non-factor.** LLM emission of new attributes is ~400 extra prompt
  tokens; the rejected alternative (stuffing the repo tree into the prompt so the LLM could
  check imports) was the only genuinely expensive option — and still less reliable than the
  compiler that already runs.

## Decision

1. **v1 = three attributes, LLM-emitted** through the existing categorization pass:
   `new-dependency`, `new-abstraction`, `comment-contradicts-code`. Registered in
   `labeling-schema.md`, detailed in `risk-surface.md`. The confidence / `Uncertain` wiring
   (decided 2026-06-19) applies; `comment-contradicts-code` is expected to carry `uncertain`
   most often and is first-to-drop under the deprecation rule if noisy.
2. **Mechanical confirmation for `new-dependency`:** the validator (existing warn-and-drop
   pattern) confirms the diff's manifests actually add a new direct package before the
   attribute passes; drops it otherwise. FP ≈ 0 on that attribute without a detector pass.
3. **No `unresolved-import`.** Compilers, linters, and CI own that lane. The un-compiled
   variant — string-keyed references (feature flags, env vars, translation keys, route
   strings) that nothing checks — is parked as **`unresolved-reference`**, gated on per-repo
   registry knowledge + `ContextSource`.
4. **`diverges-from-sibling-pattern` deferred** behind the general `ContextSource` build
   (ADR 0014), escalation-tier (ADR 0010). Never built as a one-off fetch for one attribute;
   when the boundary lands, it and `unresolved-reference` are the first candidates riding it.
5. **Positioning-only lens.** No in-product "AI-authorship" grouping, section, or chip
   family. The attributes are authorship-agnostic facts — humans add needless dependencies
   and write lying comments too — and a visible "AI-ish" grouping is verdict-adjacent: it
   implicitly asserts authorship the tool cannot know. The lens exists in README/marketing
   copy ("built for the reality that a machine wrote the code"); the brief stays neutral.
6. **No origin tier for now.** Revisit a mechanical-vs-model-observed distinction (with
   distinct rendering) only if mechanical attributes multiply.

## Why This Way

The no-verdict and anti-noise invariants survive intact: every new attribute is an
observation the reviewer can check in seconds, never a hypothesis about correctness — which
keeps the lens out of the bug-bot lane (ADR 0003) even though its marketing targets AI
failure modes. The brand story is carried by the *curated attribute set plus copy*, not by
detection machinery, so v1 needs zero new infrastructure: prompt + schema registration +
validator + FE chips. The explicit rejections are recorded so the obvious re-proposals
(`unresolved-import` "because hallucinated imports are the famous failure"; an in-product AI
badge "because it's the differentiator") get answered by this ADR instead of re-litigated.

## Consequences

- Implementation surface: categorization prompt + the `RiskSurfaceAttributes` map in
  `packages/brief-core/src/types.ts` + validator + labeling schema + FE attribute chips. No new inputs, no API probes, no detector pass.
- `comment-contradicts-code` carries the FP risk of logic-reading; the citation requirement
  (cite both sides or stay silent) and the deprecation rule (drop if noisy across 10+ PRs)
  bound it.
- README/demo copy may claim the AI-authorship lens while screenshots show neutral
  attributes; the copy must bridge ("these attributes target where AI-authored code
  characteristically fails") without the product asserting authorship.
- When `ContextSource` lands (ADR 0014), `diverges-from-sibling-pattern` and
  `unresolved-reference` are the queued consumers — both need the boundary plus their own
  FP-framing pass before promotion.
- Reaffirms ADR 0003 (category-scoped, no general bug hunt) and ADR 0014 (cited facts only,
  deferred enrichment).

## Amendments

### 2026-07-04: Positioning clause withdrawn

Writing the README copy showed the AI-failure-mode framing does not survive scrutiny:
every failure mode the trio targets (needless dependency, premature abstraction,
born-false comments) is authorship-independent, so the copy either over-claimed or
conceded its own headline. Positioning is now authorship-neutral: a clearer, story-first
review experience for author and reviewer, fewer review iterations. Decision points 1 to 4
and 6 stand; point 5's product half (authorship-agnostic attributes, no in-product AI
grouping) stands. Only "the lens lives in README/demo copy" is dropped.
