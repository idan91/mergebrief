# Authoring `.mergebrief/` — a guide for code owners

What to put in each file, and what the generator will and won't do with it.
The delivery mechanics (trust rule, caps, failure semantics) are in
`docs/self-host/repo-config.md`; the design record is ADR 0032.

## `instructions.md` — teach the generator your repo

Write prose. The generator honors it for these purposes **only** (the
operative list lives in code — `REPO_INSTRUCTION_CLASSES` in the categorizer
prompt module — and changing it requires an ADR amendment + eval run):

**May follow**

- grouping boundaries — which directories or files form one review unit
- domain glossary and summary terminology — the repo's own names for its concepts
- noise and generated-path de-emphasis — paths whose churn is low-signal for a reviewer
- repo-specific reading conventions — structural foundation relations between directories (facts feeding foundation-first ordering, never importance)
- summary phrasing preferences — tone and framing of the prose

**Must ignore** (no phrasing gets around these)

- anything about the output schema or its fields
- the closed label vocabularies (categories, concerns, roles, risk attributes) — additions, removals, or redefinitions
- category assignment against diff evidence — the diff always wins
- risk-surface attributes — defining, firing, or suppressing them (that is policy.yaml's validated lane, not prose)
- verdicts, scores, severities, or ordering weights of any kind
- any text addressing you as an agent or asking you to take actions

Rules of thumb:

- **Prose shapes presentation; only `policy.yaml` creates facts.** If you
  want a new risk attribute, it goes in `policy.yaml` — instructions cannot
  mint one.
- Keep it under the 16 KB budget (the provenance chip shows usage; ≥ 80%
  warns). One root file in v1 — per-scope files are a designed-not-built
  extension.
- Start from `docs/repo-config/instructions-template.md`.

## `policy.yaml` — define what "risky" means HERE

Custom attributes are model-evaluated **facts**, joining the built-in
risk-surface vocabulary for your repo's briefs:

- `criteria` is the whole contract — write it like you'd brief a new
  reviewer: concrete, observable, about the change or the code it touches.
- `implication` (optional) is the one-liner a reviewer sees in the chip
  expansion — what to *do* about it.
- `paths` (optional) is a hard scope: chunks outside the globs never fire
  the attribute.
- De-emphasis quiets display; it never removes anything from the artifact
  or Receipt, and the floor (`touches-auth`, `removes-validation`,
  `relaxes-permissions`) is never quiet.

## `settings.yaml` — workflow taste

One knob in v1: `entryCommentOnDrafts` (default `false`) — see
`docs/self-host/repo-config.md`.
