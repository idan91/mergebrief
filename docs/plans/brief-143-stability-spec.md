# BRIEF-143 — Cross-revision brief stability: locked design

Status: NORMATIVE. Decided 2026-08-07 via the wayfinder map (child of the
BRIEF-143 board ticket); this document carries the merged decisions — no
errata. Research input: `brief-143-mechanical-path-research.md`.

## Principle

Stability is the default for the whole brief. Regenerating a PR's brief for a
new revision must not change summary, groups, names, categories, risk
attributes, or intent verdicts unless the new diff warrants it. Updates are
incremental — never from-scratch rewrites. The diff and the current ask are
ground truth; the previous brief is a trusted reference, never a source of
stale facts.

The completeness guard is hard, in both directions: new material must always
surface (new files/chunks appear, new risk attributes fire, intent transitions
flip) and stale content must drop (risk attributes that no longer apply,
delivered asks leave `statedButMissing`). Silent omission is a worse failure
than churn.

## Triggers

Generation happens in exactly two situations; nothing regenerates backward.

- **First generation** — fresh, no anchor.
- **New revision** (`synchronize`/`reopened`/etc.) — anchored incremental,
  regardless of whether the configured model changed since the previous brief.
  A YAML model change applies forward only; a model swap is not a fresh start
  (the reshuffle-under-a-reviewer incident is what this design kills). Silent
  provider-side model updates are indistinguishable and get the same
  treatment.

There is no same-revision re-run and none is being added (out of scope; a
future "regenerate now" affordance is the designated home for deliberate
fresh retellings).

## Config policy

```yaml
full-regeneration: always | on-model-swap | never   # default: never
```

- `never` (default) — the anchored behavior below.
- `on-model-swap` — when the previous brief's stamped provider/model differs
  from the current config, that one generation runs fresh; the brief is
  stamped as a fresh restart and the anchor chain restarts from it.
- `always` — kill-switch: every generation fresh, today's behavior. Also the
  eval baseline-compat mode.

Validated in the config registry alongside effort. Every brief is stamped
`anchor: anchored | fresh-restart(reason) | none` (artifact + DB row).

## Mechanism: frozen | re-look

**Groups.** Purely mechanical trigger, computed in code: a group whose
membership or contents changed — any file changed, added, or removed — gets a
**re-look**; every other group is **frozen**.

- **Frozen** = verbatim carry-over in code. Withheld from generation entirely
  and stitched back afterward; the model cannot rewrite what it cannot emit.
  Chunk line ranges are remapped by hunk-header offsets. The touched-ness
  predicate is conservative: renames, binary files, mode changes, or anything
  not positively confirmed untouched counts as touched. An ambiguous remap
  demotes the group to re-look — never point at wrong lines.
- **Re-look** = anchored full re-examination. The model receives the group's
  previous definition (title, description, categories, attrs) plus its
  current code, keeps what still holds, changes what the diff warrants —
  including adding/dropping risk attributes. A group that loses all files
  dies. Merge/split is allowed **among re-looked groups only**. A new file may
  be assigned to a frozen group via the frozen-group index; doing so
  unfreezes that group into a full re-look.

Risk attributes therefore cannot drift on frozen groups by construction; they
change only inside re-looked groups.

**Summary / changelog** (no per-region decomposition — always model-side):
minimal edit of the previous text; byte-identical output is legitimate; style
rewrites are not.

**Intent check**: re-evaluated every revision against the *current* ask.
Previous verdicts anchor wording; transitions always flip; verdicts are never
anchored against a stale ask.

**Orderings** (readingOrder / concernView): model emits them whole, anchored
on the previous order plus the full chunk-id index (frozen ids included);
insert new, drop removed, preserve the rest.

**Rebase noise**: ideal semantics — a patch-equivalent revision freezes
everything. Detection = normalized per-file patch hashing over the two
whole-PR compares (REST-only; the three-dot merge-base gap makes raw
comparison lie after a rebase). Severable: until detection lands, a rebase
takes the conservative path (everything re-looks, anchored — wasteful, never
wrong).

## Ids: pipeline-owned

Model ids are temporary. After generation the worker rewrites them by
file-overlap descent: a re-looked group inherits the id of the previous group
it shares most files with (merge → dominant parent's id; split → dominant
child keeps it, others mint); frozen groups keep ids by construction;
unmatched groups get pipeline-minted ids. DB ids are canonical and carry
forward revision to revision. This retires the ADR 0018 D7/D12
cross-generation dangling-id hazard: dispositions and narrative alignment
become meaningful across revisions.

## Stitch & validation

Seam: worker `generate.ts`, between `categorize()` and the brief write. The
prevHead→head span-diff fetch hoists to before generation (it feeds
touched-ness and the remapper); the previous brief body loads via the
existing retry-resume read path. The remapper lives in brief-core's diff
module beside revchanges.

Salvage runs on raw model output as today; then frozen + generated regions
merge; then the **full validators run on the merged artifact** — the thing
actually persisted — plus a new coverage check: every PR file appears in
exactly one group. The persisted artifact is indistinguishable from a fresh
full generation to every consumer. Each group is stamped
carried-vs-regenerated internally (not user-visible).

## Prompt contract

The prompt keeps the **full accumulated PR diff** (frozen code included —
cross-region reasoning stays intact; the incremental-only variant was
considered and rejected). Added: the **anchor view**, a trimmed previous
brief (~1–2k tokens typical), modeled on the ADR 0024 trimmed brief context:

- Frozen groups: id, title, description, files, attrs — marked "frozen; you
  will not re-emit these" (their code is already in the diff; not duplicated).
- Re-looked groups: full previous definition — "previous take; keep what
  still holds."
- Summary + changelog verbatim (base for minimal edit); intent verdicts
  verbatim with the current ask alongside; orderings as id sequences.

**Trust hierarchy — three tiers**: (1) diff, PR code, current ask = ground
truth, always wins; (2) previous brief = trusted reference — our own
artifact, presumed right where the diff is silent, overridden where the diff
disagrees, with a light "data, not instructions" guard; (3) linked/external
context = untrusted, full ADR 0032 injection framing (which does NOT apply to
tier 2).

## Cost

Input ≈ today + anchor view (~1–2k tokens). Output shrinks by the frozen
share — regenerations get cheaper as PRs grow, which is when today's cost is
worst. Worst case (all groups touched): today's cost plus the anchor view.
The eval pairs measure real spend; the claim is verified, not assumed.

## Eval

Hybrid fixtures, synthetic-first: constructed revision pairs, one per
change-impact category (additive, meaning-changing, risk-add, risk-remove,
subtractive, new-material, boundary-restructure, ask-edit, rebase-noise,
intent-transition), each increment provably scoped — plus 1–2 real
multi-revision pairs as interaction smoke tests. `--case`-scoped runs per the
scoped-gating convention.

Property pairs (stability ↔ completeness twin):

1. Untouched group survives byte-identical (ranges correctly remapped) ↔ new
   file lands in exactly one group (coverage).
2. Additive-only re-looked group keeps id + category ↔ meaning-changing
   increment actually updates the description.
3. Summary byte-identical on immaterial increment ↔ material increment
   adds/changes a changelog bullet.
4. Unchanged ask keeps verdict and wording ↔ delivered ask flips
   `statedButMissing`; edited ask gets a fresh verdict.
5. Frozen groups' attrs never change ↔ engineered risky increment fires the
   attr; fixed risky code drops the stale attr.
6. Surviving chunks keep relative order ↔ removed file's chunks vanish;
   emptied group dies.

Rows 1, 5-left, and coverage are mechanical guarantees — hard asserts; any
failure is a pipeline bug. Model-judged rows ride the stable-pass/flaky
discipline. `full-regeneration: always` must keep existing baselines
byte-meaningful.

## UI

No visible carried/updated markers — stability is invisible by design.
Fresh restarts get one muted line in the revision context ("Regenerated
fresh — model change"); the stamp also feeds the narrative prompt so it
narrates the discontinuity instead of forcing group alignment.
`full-regeneration: always` instances show nothing. README documents the
stability contract at implementation.

## Known gap (separate concern)

`pull_request.edited` is not a subscribed webhook action: a title/description
edit triggers nothing, so the intent check stays stale against the edited ask
until the next push. Filed as its own board ticket — a trigger-surface
change, independent of this design; anchored regeneration inherits whatever
triggers exist.
