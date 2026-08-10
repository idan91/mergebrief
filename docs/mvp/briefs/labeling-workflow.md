# Labeling Workflow

How to fill in a Phase 1 brief. Follow this order — different from the order the brief file lists its sections. The order here produces better calibration.

## Step 0 — Open Tabs

- The PR diff view (e.g., `https://github.com/<owner>/<repo>/pull/<n>/files`)
- **`docs/mvp/labeling-schema.md`** — the controlled vocabulary (all valid Category / Concern / Role / Risk-Surface tokens + quick rules). Your cheat-sheet. If you need a token that isn't here, register it here first.
- `docs/mvp/playbooks.md` — per-Category checklists
- `docs/mvp/risk-surface.md` — per-attribute detail
- The brief stub you're filling in (e.g., `medusa-15605.md`)

## Step 1 — Read the Diff Cold (~15 min)

- Read the diff **before** reading the PR description. PR descriptions anchor you to the author's framing — read after, as a cross-check.
- Don't label anything yet. Just understand what the PR does. Form your own mental model.
- After the diff, read the PR description and title. Note where the author's framing matches your read and where it diverges. **Divergence is signal worth saving** — capture it in `## Labeling Scratch` at the bottom of the brief.

## Step 2 — Inventory Each Chunk: Concern, Role, LoC (~20 min)

> **A chunk is sub-file.** It's a contiguous run of changed lines sharing one Concern and one Change-group — NOT necessarily a whole file or a whole git hunk. If a file (or a single git hunk) contains parts with **different concerns or different intents**, split it into multiple chunk rows and label each separately. The inventory tables in the stubs pre-list one row per file as a *starting point* — add rows when a file splits.
>
> **Exception (the one unhandled case):** if the multiplicity is *interleaved within one inseparable span* (e.g., a move and a logic-fix woven line-by-line, impossible to split cleanly), keep it as one chunk and capture the secondary operation via the group's secondary Category + a text note in the Summary. This is the deferred sub-operation tree (ADR 0005) — don't force a split that isn't there.

Fill the **Chunk Inventory** table. For each chunk:

- **Concern** — what artifact does it touch? `implementation` / `test` / `doc` / `spec` / `config` / `generated`. Mostly from file path (`*.test.*` → test, `*.md` → doc, lockfiles/bundles → generated). Verify the suggested value; override if wrong.
- **Role** — `core` or `supporting`. Default: `implementation` → core, everything else → supporting. **Flip** only when a supporting artifact is itself the PR's purpose (flaky-test fix, coverage backfill) — then that chunk becomes core and takes the group's intent.
- **Adjusted LoC** — `+added/−deleted`, but exclude moved & generated lines:
  - **Moves:** for relocated code, show `moved N` and do NOT count those lines in +/− (net logic change is zero). Inspect content (`gh pr diff <n> --repo <owner>/<repo>`) to separate moved bytes from edited bytes.
  - **Generated:** mark the chunk `generated` Concern; its LoC is collapsed, excluded from the split.

## Step 3 — Apply Risk-Surface (~15 min)

- For each chunk, walk the three buckets:
  - **About the code** — `no-tests`? `no-types`? `legacy-area`? `dense-logic`?
  - **About the change** — `touches-auth`? `mutates-state`? `removes-validation`? `relaxes-permissions`? `widens-error-handling`? `adds-feature-flag`?
  - **About the blast radius** — `external-io`? `cross-service`? `schema-adjacent`? `hot-path`? `widely-imported`? `release-imminent`?
- Apply **factually, not judgmentally.** `mutates-state` = "this code writes state" not "this is risky". If you wouldn't bet $100 the attribute applies, don't apply it.
- Most chunks will have 0–3 attributes. If a chunk has 6+, you're being too generous — tighten.

## Step 4 — Form Change-groups: Cluster, Summarize, Categorize, Playbook (~30 min)

Cluster the chunks into **Change-groups**. The boundary rule:

- One group = the largest chunk set you can express as **ONE Summary + ONE Dominant Category**.
- If a set needs two unrelated summaries → split into two groups.
- A single-intent PR is one group. A grab-bag PR (fix + lib bump + README typo) is several.
- Author commit structure is a **hint** for understanding intent — read it, don't bind boundaries to it.

For each group:

1. **Assign member chunks** (core chunks + their supporting chunks). Intent lives on the core chunk(s); supporting test/doc chunks serve it — do NOT independently categorize them.
2. **Summary** — one descriptive sentence. *What* not *why*.
   - Good: "Cache.ts scopes prefetch params per-route-segment instead of leaking across segments."
   - Bad: "Elegantly fixes a long-standing cross-segment caching bug by isolating the param scope."
   - Why/narrative belongs in the PR description + linked issue. Drift here collapses the wedge into Linear Diffs' lane. See `../../next-steps.md`.
3. **Categorization** — dominant Category + secondary (zero or more). "Mostly a bugfix, includes a move" = `{ dominant: bugfix, secondary: [pure-move] }`.
4. **Playbook** — copy the dominant Category's items from `playbooks.md` **verbatim** (no paraphrase — Phase 2 benchmark relies on consistency). Add supporting-Concern checks for the group's test/doc/spec chunks.
5. **Adjusted LoC** — roll up across the group's chunks.

If a core chunk doesn't fit any Category, or a chunk resists every group's single-summary test → note it in `## Labeling Scratch`. Don't force it. Taxonomy gap, feeds Phase 2.

## Step 5 — Concern View Rollup (~5 min)

- Roll up adjusted LoC per Concern across the whole PR (implementation / test / doc / spec / config / generated).
- This is the attention-routing split — "how much is real implementation vs supporting scaffolding."
- Sanity check: if `implementation` LoC is tiny and `test` is large, the brief should make a reviewer realize the real logic change is small. That realization IS the feature working.

## Step 6 — Write the Tricky-Cases Note (~15 min)

This is the **pre-registration** for the Phase 1 success metric. The hardest step. Get this right or the gate is meaningless.

- List 2–4 specific things a non-engaged reviewer would miss. Each item must be: a concrete observable claim about the diff that a reviewer's comment can either mention or fail to mention.
- **Good tricky-case:** "The deletion in `[slug]/layout.tsx` and addition in `with-fallback-params/layout.tsx` are a move with edits. A reviewer who treats them as independent will miss the edits hidden in the move."
- **Bad tricky-case:** "The reviewer should engage deeply." (Not observable.) "The test coverage is good." (Not a thing to *catch*.)
- Once written, **freeze it.** Do not edit after observation sessions begin. Moving goalposts after seeing data invalidates the gate.

## Time Budget

- **First PR (calibration):** ~90 minutes end-to-end. You're learning the process.
- **PRs 2–6:** ~45 minutes each as the workflow becomes automatic.
- **Stress-test PRs:** highly variable — could be quick (clearly outside taxonomy) or long (genuinely ambiguous). Cap at 60 minutes per stress-test PR; if you can't categorize in 60 min, that itself is the finding.

## After Filling a Brief

1. Delete the instruction callout from the top of the brief.
2. Generate the `.baseline.md` (**Baseline B′**) — copy the full brief, then **strip the three differentiator fields**: Category labels (dominant + secondary), all playbook items, and risk-surface attributes. **Keep** everything else: change-groups, member chunks, core/supporting roles, concern split, adjusted LoC, and the descriptive per-group summaries. B′ is the grouped substrate Linear already ships — the within-subject test measures what your differentiator layer adds on top of it. (B′ is a derived rendering of the same labeling, not a separate labeling pass.)
3. Commit both files.
4. Ping for review. Reviewer (Claude or human) checks:
   - Do the Change-group boundaries hold (one summary + one dominant Category each)?
   - Does intent sit on core chunks, with test/doc chunks marked supporting (not independently categorized)?
   - Are Concern + Role assignments right? Adjusted LoC excludes moves & generated?
   - Are risk-surface attributes truly factual, or did any verdict slip in?
   - Are tricky-cases concrete enough to grade reviewer comments against?
   - Did anything force a `Labeling Scratch` note? Worth grilling if so.

## Anti-Patterns

- **Reading the PR description before the diff.** Anchors you to the author's framing. Always diff first.
- **Forcing every chunk into a category.** Only core chunks get a Category, and only via their group. If a core chunk doesn't fit, capture the gap. The taxonomy is what you're testing, too.
- **Independently categorizing supporting chunks.** A test chunk in a bugfix group is `test` Concern, `supporting` Role — NOT its own "bugfix" or "new-feature". Intent flows from the core chunk. The only exception is a flipped-role test-as-purpose chunk.
- **Counting moved or generated lines in adjusted LoC.** Moves are `moved N` (excluded); generated is collapsed (excluded). Raw git numbers stay reachable but are never the displayed adjusted value.
- **Editorial summary.** "This PR cleverly handles X" smuggles a verdict. Stick to "This PR does X by changing Y."
- **Narrative drift in per-category summaries.** Writing "the author elegantly solves the race by…" or "step 1 is setting up the fixture, step 2 is fixing the cache" is *narrative-mode summary*. That's Linear Diffs' lane. Yours is descriptive-mode summary: "the bugfix portion scopes params per-route-segment." Stay in observable *what*.
- **Vague tricky-cases.** "Reviewer should think about edge cases" is not gradeable. "Reviewer should catch that the new layout removes the param boundary previously enforced at the `[slug]` level" is gradeable.
- **Adjusting tricky-cases after observation.** Forbidden. If they were wrong, that's data — keep them as written and learn from the gap.
- **Inconsistent playbook copying.** Don't reword items across briefs. Phase 2 measures categorizer accuracy against the gold set, including playbook items per category.
