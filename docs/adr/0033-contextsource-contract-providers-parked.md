# ContextSource Contract Locked; All Providers Parked to v2

The `ContextSource` seam (ADR 0014 #5) got its design pass (BRIEF-13 wayfinder map,
2026-07-17/18): the **provider contract, trust posture, and enrichment scope are locked**
so that any future provider is an implementation, not a redesign — and **no provider
ships in v1**. The local/git retrieval provider was killed by its own gating spike
(no story improvement attributable to retrieval); external context managers (BRIEF-61)
are deferred to v2 by scope discipline, not evidence — v1 can't ship everything.
Today's `<linked_context>` fetch and the `.mergebrief/` repo-config surface are
untouched and remain v1's only generation context beyond the PR itself.

## Context

- The 2026-07 reprioritization reframed the seam story-first: the known comprehension
  gaps are repo-reading gaps (a summary can't see a changed call site's callee outside
  the diff), not missing risk detectors. BRIEF-13 was bumped to design the seam with
  BRIEF-61 inheriting the contract.
- Hard constraint carried in: the generator is a **single structured call with no
  tools** (ADR 0032 #12's injection posture rests on it; re-verified against the
  ADR 0030 harness adapters). Retrieval is harness-side and deterministic, never
  model-directed.
- The map resolved three design tickets (contract, scope, retrieval heuristics) before
  Idan rescoped both providers to v2; the remaining detail tickets (seam location,
  budgets, citation validator, eval-hook spec) were closed **undesigned** — deliberate:
  detail designed months ahead of build goes stale.

## Decision

### 1. Contract (locked — binding on any future provider)

- **Query derivation:** a structured `ContextQuery`, mechanically derived pre-model —
  title, body, ticket refs, per touched file `path + changedRanges + identifiers`
  (lexical extraction). **No raw diff in the contract; no model-produced summaries as
  queries** (they're produced by the call the context feeds). Two field tiers —
  **metadata** (title/body/paths/ticket refs) and **content** (changed ranges +
  identifiers); each provider type declares its tier; **external providers get
  metadata-only by default**, content by explicit per-provider instance opt-in
  (BRIEF-61's data-egress consent = one registration field).
- **Result shape:** flat `ContextSnippet` list — stable per-generation `id` (`ctx-N`),
  `providerId`, resolvable `source` locator, `text`. Citations are **snippet-id based**
  (mechanically checkable); **no provider relevance scores or rankings** (a score is a
  verdict-shaped import, ADR 0014). Order/truncation = harness budget logic.
- **Fan-out:** parallel across providers pre-assembly; per-provider timeout;
  **fail-open per provider** with loud provenance outcomes (repo-config vocabulary);
  nothing in the phase can fail a generation; fresh per generation, no cache.
- **Registration:** static `as const` registry of provider **types** (token, Zod
  options schema, egress tier, factory) + an instance-config `contextSources:` list of
  instances; construction returns `Result` and refuses boot on invalid config
  (operator lane, ADR 0032 #1). Absent block = empty list = today's behavior,
  byte-identical.
- **Prompt mechanics:** one `<external_context id provider source>` fence on the
  untrusted tier; the breakout-strip is **centralized** over the union of all known
  fence tags (extends `stripForgedRepoFences`). `fetchLinkedContext` is structurally
  the first ContextSource (ADR 0014 #5); its migration into a provider is
  designed-not-built, trigger = BRIEF-61 landing.

### 2. Enrichment scope (locked)

- **Structure is configuration-shaped, never evidence-shaped.** Retrieved context may
  inform **prose** (PR summary, group summaries/titles, narrative) and
  **citation-backed risk attributes** — never grouping boundaries, reading order, or
  category/concern/role assignment. Same diff + same config ⇒ same skeleton, with or
  without retrieval. `instructions.md` keeps its grouping influence: it is an
  *instruction to MergeBrief* (code-owner-authored, default-branch write-gated,
  stable, provenance-stamped); retrieved context is *evidence about the change*
  (untrusted, machine-sampled, run-varying). Extends ADR 0032 #3's two-lane table
  with a structure/prose column.
- **Brief call only** — delta cores and the revision narrative consume the (enriched)
  Brief and inherit second-hand.
- **Gate: every brief when providers are configured** — amends ADR 0014 #5's
  escalation-tier sequencing (per-change-group probes are never built; enrichment
  became one capped fan-out per generation, bounded by budgets and timeouts).
- Trust tier inherited unchanged from ADR 0032 #9: untrusted, PR-head,
  cite-or-stay-silent.

### 3. Local/git provider: parked on spike evidence

The mandatory gating spike (12 briefs: 3 real PRs × baseline / expanded-hunk-context /
outward imports+definitions / inward capped caller-sites, injected on the linked-context
lane) plus a baseline variance check (2 extra plain runs × 2 PRs) showed **every
apparent improvement was run-to-run model variance, not retrieval**: one "context-only"
edge case was in the PR's own diff (plain reruns caught it 2/2); the best brief of the
experiment came from an arm injected with one junk snippet. Plain-run quality swing ≥
every observed improvement → the pre-agreed kill criterion fired. The **default-ON
posture died with it** (it was explicitly gated on the spike). Spike findings live on
the wayfinder ticket ("Retrieval heuristics — local/git provider").

### 4. External context managers (BRIEF-61): v2 by scope

No adverse evidence — the value case (tickets/docs carry intent the diff can't show) is
the *stronger* one and `<linked_context>` already validates the lane. Deferred because
v1 doesn't ship everything: the contract above is its insurance policy.

### 5. Undesigned residuals (v2 revival work, deliberately not pre-designed)

Seam location/package; budget model + caps; cite-or-stay-silent validator mechanics +
provenance display; eval-hook spec (BRIEF-59 fixtures for context value); parked
attributes' promotion (`unresolved-reference`, `diverges-from-sibling-pattern` — stay
parked per ADR 0026, names stay reserved in `PARKED_ATTRIBUTE_CANDIDATES`).

## Why This Way

The contract is cheap to lock and expensive to retrofit — it is exactly the part
BRIEF-61 would otherwise re-litigate. The provider builds are the opposite: expensive
to build, cheap to defer, and the spike showed the flagship v1 provider had no
demonstrated value on well-documented repos. Killing it on its own pre-agreed criterion
(rather than softening to "maybe later, on by default") keeps the budget where v1's
story actually improves.

## Consequences

- **ADR 0014** amended: #2's enrichment remains deferred, now with a locked contract;
  #5's escalation-tier gate is superseded by every-brief-when-configured.
- **ADR 0026** unchanged: the parked pair stays parked; collision vocabulary keeps
  reserving their names.
- **Roadmap:** `oss-roadmap.md` gains the v1/v2 split (2026-07-18); BRIEF-13 moves
  Next → Backlog (v2), BRIEF-61 stays Backlog (v2). Wayfinder map closed:
  <https://app.notion.com/p/3a05e9400eeb815d8304c22cfc64aa80>.
- **Revisit triggers:** local/git provider — briefs visibly starving on repos with
  thin PR hygiene (this repo was a worst-case test bed: rich descriptions, documented
  code); BRIEF-61 — post-launch demand (unchanged); structure enrichment — ≥2 real
  repos with grouping wrong *because* of missing external context.
