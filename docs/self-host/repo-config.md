# Repo-local configuration: the `.mergebrief/` directory

A repository can commit a `.mergebrief/` directory to shape its own briefs.
This is the **code-owner's** surface — distinct from the
operator's instance config (`mergebrief.config.yaml`, env-located, never in
the repo): instance config decides provider/model/spend and refuses boot when
invalid; repo config decides policy/text/workflow and degrades **that
repo's** briefs loudly when invalid, never the instance.

```
.mergebrief/
  instructions.md    # text guidance to generation (semi-trusted, bounded)
  settings.yaml      # workflow behavior (v1: entryCommentOnDrafts, tracker)
  policy.yaml        # risk policy: custom attributes + display de-emphasis
  rules/             # RESERVED for future generated output — leave empty
```

Every file is read from the **default branch only**, fetched fresh per
generation — a PR can never weaken its own scrutiny by editing config on its
head. A PR that changes a config file is analyzed like any other diff; the
change applies after merge.

Every brief records exactly which config shaped it: per-file
`path + blob SHA + outcome` (`applied` / `absent` / `invalid` /
`over-budget` / `fetch-failed`) on the generation record and the brief, an
understated "repo config @ sha" chip in the header (warning state on any
error — visible to author and reviewer), and a permanent copy on the
Receipt.

## `instructions.md` (16 KB budget)

Free-form text the generator may follow **only** within the enumerated
instruction classes — see the authoring guide
(`docs/repo-config/authoring.md`) and the template
(`docs/repo-config/instructions-template.md`). Text shapes presentation and
comprehension; it can never mint a risk attribute, change a label
vocabulary, or alter the output schema — that asymmetry is why `policy.yaml`
exists separately. Over 16 KB the file is rejected whole (loudly), never
truncated.

## `settings.yaml` (4 KB, versioned)

```yaml
version: 1
entryCommentOnDrafts: false   # default
```

`entryCommentOnDrafts` — the branded Entry comment stays **off draft PRs**
by default; it posts when the PR flips to ready-for-review. Repos that
genuinely review drafts opt in with `true`. Generation itself always runs
for drafts (subject to the instance `drafts:` knob below); this gates the
comment only.

### `tracker:` — where this repo's tickets live

```yaml
version: 1
tracker:
  kind: notion            # notion | github
  keyPrefix: BRIEF        # notion: required; keys never match without it
  databaseId: 3935e9400eeb80b0ad46000b1ce17b37   # notion: required; database or data source id, dashes optional
  # kind: github
  # issuesRepo: owner/name   # optional: where a bare #N resolves
```

The brief's Intent check names one **primary ticket** per PR, found in the
description, title or branch name, and reads it through a tracker
provider (see [trackers.md](trackers.md)). This block tells it which
tracker the repo uses:

- `PREFIX-N` keys match **only** the configured `keyPrefix`
  (case-insensitive, word-bounded). With no `tracker:` block, keys never
  match.
- `#N`, `owner/repo#N`, GitHub issue URLs and a branch segment starting
  `N-` always match, whatever the kind. A bare `#N` resolves against
  `issuesRepo` when set, else the PR's own repo.
- When a PR names several references, ones on the configured tracker
  come first: in a Notion repo, `[BRIEF-12]` in the title outranks `#467`
  in the description, which is usually a pull request. Within that pool a
  closing keyword wins, then reading order.
- An invalid block rejects the whole file, like any other key.

## `policy.yaml` (32 KB, versioned)

```yaml
version: 1
attributes:
  touches-billing:                 # lower-kebab-case, ≤ 50 chars, ≤ 20 entries
    criteria: >                    # ≤ 4,000 chars, model-evaluated
      modifies invoicing, payment, or ledger code
    implication: needs a finance-aware reviewer   # optional, ≤ 500 chars
    paths:                         # optional glob scope (deterministic pre-filter)
      - services/billing/**
deEmphasize:                       # optional display tuning — quiet, never suppress
  - attribute: widens-error-handling
  - attribute: no-tests
    paths: [generated/**]
```

- Custom attributes are **flat facts** — no tier, severity, or weight can
  exist (unknown keys reject the whole file).
- Names colliding with a built-in, parked candidate, or reserved word are
  ignored with a disclosure chip — **built-in wins**, identically day-one or
  after an upgrade.
- **De-emphasis, never suppression**: detection always runs and every
  attribute lands in the artifact and Receipt; de-emphasis only quiets the
  render and drops the attribute from the jump-rail. The floor —
  `touches-auth`, `removes-validation`, `relaxes-permissions` — cannot be
  de-emphasized, and a quiet attribute co-firing with a floor attribute
  renders loud.
- Glob scope language: `**` spans directories, `*` within a segment, `?`
  one character.

## Failure semantics

Invalid YAML, unknown keys, an unknown/missing `version`, or an over-cap
file → the file is rejected **whole** (never partially used); generation
proceeds without it and the error shows on the origin chip to both
author and reviewer. A GitHub fetch failure fails **open**: the brief
generates without repo config, recorded loudly as `fetch-failed`.

## Local-only mode (CLI) — first slice built

The dotdir also serves a second mode: the `categorize` and `delta` CLIs
read `.mergebrief/settings.yaml` from the **working tree** they run in
(your own machine, your own trust context). Today they read the `tracker:`
block only, version-gated, ignoring other keys; a file that does not parse
yields no tracker and one warning line, never a failed run. Instructions
and policy still come only from the server's default-branch fetch.

## Related instance block: `drafts:` (operator-side)

`mergebrief.config.yaml` (instance config) carries a `drafts` block — the
operator's draft-PR spend knobs:

```yaml
drafts:
  generate: on        # on|off — whether drafts generate at all (default on)
  debounceSeconds: 900  # optional draft REgeneration window; unset = normal 60s
```

Default **on**: the author-side surface (own-draft view, mark-ready CTA)
depends on draft generations existing. Under `generate: off` a draft PR is
state-tracked only and gets its **first** brief when marked ready (the
`ready_for_review` trigger); the web view still shows PR conversation and
meta meanwhile. **Precedence:** `generate: off` makes the repo-level
`entryCommentOnDrafts: true` above moot until ready — no generation means
no entry comment, automatically. Spend knobs are instance config — a repo
file may narrow instance behavior, never widen spend.

`debounceSeconds` damps WIP push-storm spend: draft regenerations wait out
the long trailing window instead of the normal one. A draft's first brief
always uses the normal window, and `ready_for_review` always enqueues on a
short (~10s) flip window so a just-readied PR is fresh when the reviewer
arrives.
