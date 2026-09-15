# Repo-Local Configuration Surface (`.mergebrief/`)

> **Renumber note (2026-07-17):** the board ticket referenced below as **BRIEF-53**
> (draft generation policy: draft-aware debounce + instance `drafts:` knob) was
> renumbered to **BRIEF-64** by Notion's auto-increment; same ticket, same scope.

Repos gain a single config namespace — the `.mergebrief/` directory — carrying **validated policy** (`policy.yaml`: custom risk attributes, display weight), **workflow settings** (`settings.yaml`), and **text instructions to generation** (`instructions.md`, the CLAUDE.md idiom for the Brief generator). Every repo-local file is read from the **default branch only**, fetched fresh per generation, capped, fenced, and stamped onto the Brief's origin record. The surface is split from instance config by one line: **instance config is the operator's (pays and runs it); repo config is the code-owner's (owns the code it describes)** — no key exists in both. Decides the shared delivery mechanics for BRIEF-52 + BRIEF-58, fixes BRIEF-53's naming collision, and closes the per-repo-YAML dangling reference left in ADR 0020 by the BRIEF-11 amendments.

## Context

- **BRIEF-52** (repo-local risk policies) and **BRIEF-58** (repo instructions file) both need repo-committed files; they were filed as two artifacts on one config surface (YAML = validated policy, MD = text context) with one joint grill for the delivery mechanics — this ADR is that grill's output (2026-07-16).
- **BRIEF-11 (2026-07-12)** killed per-repo *runtime* YAML entirely (ADR 0006 #3 / ADR 0013 #6 as amended): provider, model, debounce, spend all live in one instance-level `mergebrief.config.yaml`. But ADR 0020 #5 still described draft-first as "per-repo opt-in (repo YAML)" — never amended, and nothing reads any repo file today (no `getContent` anywhere in `packages/github`). This ADR resolves the contradiction rather than extending it.
- **BRIEF-53** noted a naming collision: its instance knob file is `mergebrief.config.yaml` while BRIEF-52's ticket used a "mergebrief.config idiom" for a *repo* file.
- Prior art: Unblocked's risk policies (2026-07) — user-defined YAML (name + tier + ≤4k-char natural-language criteria) feeding a PR-level risk score with auto-approve at low tiers. Same bottleneck thesis, opposite conclusion. We take the criteria field and the default-branch trust rule; we refuse the tier, the score, and the auto-approve (ADR 0002).
- Verified at grill time: generation is a **single structured call with no tools** (engine = the categorizer package, reused behind the `Generator` port by `packages/worker/src/task/generate.ts`; adapters in `packages/generators`); `<linked_context>` / `<review_comment>` are fenced as untrusted, zero instruction-following; output schema + closed vocabulary are enforced server-side at the port (`packages/generators/src/validation/enforceSchema.ts`), adapter-agnostic.

## Considered Options

- **Naming/layout:** root files (`MERGEBRIEF.md` + `mergebrief.yaml`) · `.github/` placement · root MD + dotdir YAML · **everything in `.mergebrief/` (chosen)** — root siblings with similar names invite confusion, growth pollutes the root, and one dotdir is trivially gitignorable for local-only CLI use.
- **Built-in attribute tuning:** add-only · full suppression · suppression-except-security-floor · **de-emphasis-never-suppression + floor (chosen)** — suppression saves zero compute (attributes come from the same call), punches undescribable holes in the Receipt, silently degrades combination signals, and starves headless API consumers over a human display preference.
- **Instructions trust:** zero trust (makes the file decorative) · full trust (injection + drift) · mechanical section extraction (fights the text idiom) · **bounded instruction classes (chosen)**.
- **Fetch:** per-generation fresh (chosen) · SHA-keyed cache · webhook-invalidated cache · TTL — a generation already makes many GitHub calls; +3 is noise, and no cache means no invalidation semantics.
- **Risk as reading-order tie-breaker:** **dropped** — the jump-rail already routes to flagged groups; attributes flip across revisions and would reorder groups mid-review for no story reason (ADR 0021 overlay churn); "risk never affects order" stays asterisk-free.

## Decision

### 1. The operator / code-owner line

- **Instance config** (`mergebrief.config.yaml`, env-located, never in the repo) = decisions of whoever pays and operates: provider, model, effort, API-key names, debounce, spend knobs (incl. BRIEF-53's `drafts: on|off`, generation-for-drafts **defaulted on**, documented so operators can turn it off). Invalid → **refuses boot** (unchanged, ADR 0013).
- **Repo config** (`.mergebrief/`) = decisions of whoever owns the code: risk policy, text context, workflow taste. Invalid → degrades that repo's briefs **loudly**, never touches the instance or other repos.
- **No key exists in both schemas.** Straddle rule, recorded now with zero straddling knobs shipped: a repo file may *narrow* instance behavior, never *widen* spend.

### 2. Layout and naming rules

```
.mergebrief/
  instructions.md    # text guidance to generation (BRIEF-58)
  settings.yaml      # workflow behavior (v1: entryCommentOnDrafts)
  policy.yaml        # risk policy (BRIEF-52: custom attributes, de-emphasis)
  rules/             # RESERVED — generated comment-to-rule output (v2+)
```

- The `.config.` infix belongs to **instance** artifacts exclusively; repo artifacts never carry it (fixes BRIEF-53's collision).
- The repo-local surface is the `.mergebrief/` namespace, nothing else, ever — a new repo artifact must justify why it can't live in the dotdir. Machine-generated content goes under `rules/` (or future siblings), never repo root.
- The dotdir serves two modes: **committed** = shared repo config under the default-branch trust rule (below); **gitignored** = personal local config, read from the working tree by the CLI only (a different trust context — the user's own machine and files).

### 3. Default-branch trust rule (all repo-local files)

Any repo-local file MergeBrief honors is read from the **default branch, never the PR head** — a PR must not be able to weaken its own scrutiny. Applies to all three files and to future `rules/` output. A PR that *changes* a config file is analyzed like any other diff (the file is ordinary `doc`/`config`-Concern data in that lane); the config loader ignores the PR-head version, and the brief may note "repo config changed in this PR — applies after merge." First-PR bootstrap gets no benefit until merged — accepted.

**Three lanes, three postures** (the instructions-vs-evidence distinction):

| Lane | What it is | Read from | Trust |
|---|---|---|---|
| Repo config (this ADR) | Instructions **to MergeBrief**, written for MergeBrief | Default branch | Validated (YAML) / semi-trusted (MD) |
| Code context (future `ContextSource`, ADR 0014) | **Evidence** about the change | PR head (it IS the code under review) | Untrusted data; cite-or-stay-silent |
| Third-party agent files (`AGENTS.md`/`CLAUDE.md`) | Instructions to other tools | — | **Not read.** Revisit trigger: ≥2 independent adopters ask why they must duplicate their AGENTS.md → consider an explicit opt-in include directive inside `instructions.md` (still MD-tier fenced), never silent auto-ingestion |

### 4. Fetch semantics

Fetched **fresh per generation**: three fixed paths against the default branch, 404 = absent (cached like any outcome for that generation only). No cache machinery. Each response's **blob SHA** feeds origin tracking directly. Fetch failure (GitHub 5xx/timeout) → **fail-open**: generate without repo config, origin tracking records `fetch-failed` loudly. A PR author cannot induce a GitHub 5xx, so fail-open is not a scrutiny-evasion channel. *Revisit trigger:* rate-limit pressure on large instances → content-addressed cache keyed by blob SHA behind one ref-resolve call (semantics unchanged).

### 5. Failure semantics

- **Syntactic invalidity** (parse error, unknown keys, unknown/missing `version`, over-cap): the file is **rejected whole** — we never use part of a config file. Loud error on the generation surface; generation proceeds without it.
- **Name collision** (valid schema, custom attribute name matching a built-in, a parked candidate, or a reserved word): **built-in wins**, the colliding custom definition is ignored, a chip discloses it — identical behavior whether the collision is day-one or upgrade-induced (a new release shipping a built-in that collides with an existing custom name produces the same chip, not a broken file). Collisions can only fail *toward* built-in semantics.
- Config errors surface to **both author and reviewer** (same chip, warning state).

### 6. Size caps = injected-content budget

| File | Cap | Enforcement |
|---|---|---|
| `instructions.md` | 16 KB **injected budget** per generation | Single file over budget → rejected whole, loud. Future scoped files: root always injected; scoped files dropped largest-first, loud, never truncated inside a file |
| `policy.yaml` | 32 KB file · ≤4,000 chars per criteria string · ≤20 custom attributes | Reject-whole |
| `settings.yaml` | 4 KB | Reject-whole |

Caps are schema constants versioned with the schema — raising one is a deliberate versioned change. Origin tracking shows actual usage ("6.2 KB of 16 KB"); nearing the ceiling warns before anything is rejected. The cap exists for brief *quality* (the prompt must carry the diff; oversized text crowds out the thing under review) and as an accident guard — not for spend (BYOK).

### 7. Schema versioning

Each YAML file carries a required integer `version: 1`. The loader supports the current version only; unknown/missing version and unknown keys take the invalid-file path (strict — `atributes:` typos must not silently no-op). `instructions.md` is unversioned text; its contract is the instruction classes (#10), which live prompt-side.

### 8. Provenance

Per generation, per file: `path + blob SHA + outcome` (`applied` / `absent` / `invalid` / `over-budget` / `fetch-failed`), stored on the generation record. Display: one understated **header chip** on the Brief ("repo config @ `a1b2c3d`", expandable to per-file detail; warning state on any error, visible to author and reviewer); the **Receipt** carries the full per-file table permanently, including de-emphasis tuning in effect ("N attributes de-emphasized by repo policy @ SHA"). Same register as Generation origin (CONTEXT.md).

### 9. Trust tiers (naming, not designing, the future)

| Tier | Source | Posture |
|---|---|---|
| Validated | `policy.yaml`, `settings.yaml` | Schema-enforced; only criteria/implication strings reach the prompt, fenced |
| Semi-trusted | `instructions.md` (default branch, write-gated) | Directives honored within enumerated classes only (#10) |
| Untrusted | `<linked_context>`, `<review_comment>`, future external `ContextSource` (BRIEF-61) | Reference data; zero instruction-following |

### 10. `instructions.md` semantics (BRIEF-58)

- Injected whole as one fenced block `<repo_instructions path="…" sha="…">` with a contract preamble. **May follow, for these purposes only:** grouping boundaries (which dirs form one unit) · domain glossary / summary terminology · noise & generated path de-emphasis · repo-specific reading conventions (foundation *relations* between dirs — structural facts feeding ADR 0025's mechanical rule, never importance) · summary phrasing preferences. **Must ignore:** anything touching the output schema, the closed label vocabulary, category assignment against diff evidence, risk attributes (that is `policy.yaml`'s validated lane), verdicts/scores/ordering weights, or text addressing the model as an agent.
- **Prose shapes presentation and comprehension; only validated YAML creates facts.** `instructions.md` can never mint an attribute — that asymmetry is why two files exist.
- The class list's operative source of truth is a single exported constant in the categorizer's prompt module (`REPO_INSTRUCTION_CLASSES`), unit-tested to appear in the assembled prompt, mirrored in this ADR and the authoring docs. **Changing the classes = ADR amendment + prompt change + eval-harness run.**
- v1 is **root file only**. Scoped instruction files (`.mergebrief/instructions/<scope>.md`, glob frontmatter, deterministic path-keyed injection within the 16 KB budget) are the designed-not-built extension — separate ticket, revisit on real monorepo budget pressure or cross-scope noise complaints. Nested per-package dotdirs are rejected outright (directory discovery per generation; config scattered across the tree).

### 11. `policy.yaml` semantics (BRIEF-52)

- **Custom attributes are flat facts** — `name: { criteria (≤4k chars, model-evaluated), implication? (≤500 chars), paths? (globs) }`. No `tier`/`severity`/`weight` and none can sneak in (unknown keys reject). `paths` gives deterministic pre-filtering (chunks outside the glob never reach model evaluation for that attribute); path language in criteria text remains a model-judgment bonus on top. Custom criteria are evaluated **in the same single generation call**, injected as a fenced repo-defined block.
- **De-emphasis, never suppression.** Detection always runs; every attribute always lands in the artifact and Receipt. Non-floor attributes can be `de-emphasized` (path-scopable): quiet render, excluded from the jump-rail, tagged "de-emphasized by repo policy" everywhere shown. **Floor attributes** — `touches-auth`, `removes-validation`, `relaxes-permissions`, declared per-attribute in `risk-surface.md` — cannot even be de-emphasized. A de-emphasized attribute co-firing on a chunk with a floor attribute renders un-quieted (the combination is the signal).
- **Name collisions**: custom names are validated against the built-in registry, **parked candidates** (`unresolved-reference`, `diverges-from-sibling-pattern`), and reserved words (`uncertain`); resolution per #5 (built-in wins + chip). Stored attributes carry a structural source marker (`built-in` vs `repo-policy`) — never a string prefix — keeping labeling-schema.md the single closed global vocabulary.
- **Display**: group headers show the deduped union of member-chunk attribute chips (floor first, de-emphasized behind "+n"; no counts-as-severity, no aggregate glyph). Chunk chips keep one anatomy; repo-defined attributes get an understated source variant with "defined by repo policy" + the `implication` in the expansion. The **jump-rail** is a separate collapsible row near the group TOC — **attribute-keyed, never group-ranked** (a "high-risk groups" rail would be a ranking, i.e. the banned ordering verdict rebuilt as navigation): fired attribute names with counts, click → cycle through carrying groups in story order; floor pinned first; de-emphasized excluded. Collapsed by default unless a floor attribute fired.
- **Risk never affects reading order.** The tie-breaker (risk ordering independent same-depth groups) is dropped. *Revisit trigger:* ≥2 independent reviewers report hunting for flagged groups despite the rail → reconsider as repo-policy opt-in, never a default.
- v1 display weight is applied from the **generation-time policy snapshot** stored with the artifact (self-contained historical rendering); live-policy retroactive re-render is a deferred nicety, not a v1 requirement.

### 12. Injection posture (defense-in-depth)

The generator has **no agentic surface** — single structured call, no tools, no file access, no actions. Injection blast radius is text inside the brief, nothing else. Narrowing that:

| Layer | Defense |
|---|---|
| Who can write | Default-branch trust rule — write-gated to maintainers; a PR can't inject into its own review |
| Payload size | 16 KB budget / 4k-char criteria / 500-char implication caps |
| Prompt placement | Fenced tags in the data section (never system-level), contract preamble with explicit must-ignore list — same pattern as `<linked_context>` |
| Output, structural | Server-side Zod validation at the generator port; closed vocabulary via hand-built json_schema (enums kept); unknown tokens rejected — adapter-agnostic (`enforceSchema.ts`) |
| Output, semantic | Warn-and-drop validators; floor/de-emphasis applied harness-side from validated YAML, never from model output |
| Detection | Provenance chip: every brief names the exact file versions applied |
| Regression | Eval-harness **adversarial fixture** — an `instructions.md`/`policy.yaml` attempting schema override, verdict insertion, attribute suppression — asserting all invariants hold (soft dependency on BRIEF-59; lands as categorizer tests until the harness exists) |

Residual risk, stated honestly: a malicious maintainer can degrade *their own repo's* text quality — equivalent to writing a misleading PR description, self-inflicted within their own trust domain. No cross-repo or cross-tenant path (BYOK, self-hosted; config errors reported as path + SHA, never content echo).

### 13. `settings.yaml` v1 and the ADR 0020 closure

> **Amended 2026-09-15:** the default flipped to `entryCommentOnDrafts: true`. In practice every PR opens as a draft and the Entry is the reader's way into the brief, so an off default meant no comment until ready-for-review on most PRs. Repos that keep drafts private opt out with `false`; the gate, ready-flip and sweep semantics below are unchanged, with the sweep now firing only on an explicit `false`.

v1 carries one key: **`entryCommentOnDrafts` (default `false`)**. The default implements ADR 0020 #4's documented-not-built universal rule — the branded entry comment stays off draft PRs (verified: no draft gate exists in `generate.ts` today); the comment posts when `ready_for_review` arrives (webhook already parses it). Repos that genuinely review drafts opt in with `true`. ADR 0020 #5's per-repo draft-first opt-in is **retired as absorbed**: its Entry-holding semantics ARE the universal rule, and its author-side residual shipped via BRIEF-43 (own-draft view, mark-ready CTA). ADR 0020 is amended accordingly.

## Why This Way

One line — operator vs code-owner — decides every placement question this surface will ever face, and the failure asymmetry (boot-refusing instance config vs fail-open repo config) falls out of it: an operator's mistake should stop the instance; a repo's mistake should only mark that repo's briefs, loudly. De-emphasis over suppression keeps the Receipt uniform and honest (ADR 0002's logic extended: facts don't disappear by config) at zero compute cost. Semi-trust for text is safe *because* the invariants never depended on the prompt behaving — schema and vocabulary are enforced mechanically downstream, so the file can only influence what was already model judgment. And keeping risk strictly display-side (rail, chips, never order) preserves the product's cleanest sentence: the story is the best path to understanding the PR; risk can live anywhere on it.

## Consequences

- **ADR 0020** amended: #4 built as the universal default via `entryCommentOnDrafts: false`; #5's repo-YAML opt-in retired; the dangling per-repo YAML reference is resolved (BRIEF-11's kill applied to runtime config; this ADR re-introduces repo files for policy/text/workflow under a different contract).
- **`risk-surface.md`** gains a per-attribute `floor` marker (initial: `touches-auth`, `removes-validation`, `relaxes-permissions`); `widens-error-handling` stays de-emphasizable. **CONTEXT.md** glossary gains the repo-config terms (de-emphasis, floor, jump-rail, repo instructions).
- **BRIEF-53** proceeds under the settled naming: its `drafts:` knob stays instance-level; draft→ready debounce-flip semantics remain its scope.
- New ticket filed: **scoped instruction files** (Later) with the #10 sketch + revisit triggers.
- Implementation plan: `docs/plans/repo-config-surface.md` (BRIEF-52 + BRIEF-58, one stack).
- The comment-to-rule loop (v2+) inherits `.mergebrief/rules/` and the default-branch trust rule for free.

### Amendment (2026-07-18, BRIEF-4 follow-up)

The BRIEF-52 implementation had added a "Risk surface — attributes, not
verdicts" chip lane to the Brief summary section alongside the #11 display
surfaces. With the BRIEF-4 two-column summary it rendered directly above the
(floor-fired, therefore open) jump-rail as a near-duplicate list. **Removed:
the attribute jump-rail is now the single page-level risk-surface summary.**
The #11 display decisions stand unchanged — group-header chip unions, chunk
chips, and the rail's semantics (attribute-keyed, floor pinned, de-emphasized
excluded, collapsed unless floor fired). Accepted consequences: de-emphasized
attributes have no page-level surface (they remain on group/chunk chips), and
the Changes Only view carries no page-level risk surface. Revisit trigger:
reviewers reporting they miss quiet attributes at a glance, or a no-floor
brief reading as "no risk surface" → reconsider a compact lane, not a
second full list.
