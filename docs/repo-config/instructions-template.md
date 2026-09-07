# `.mergebrief/instructions.md` template

Copy into `.mergebrief/instructions.md` on your default branch and edit.
Every section is optional — delete what you don't need. The generator
honors these classes only (see `docs/repo-config/authoring.md`):

- grouping boundaries — which directories or files form one review unit
- domain glossary and summary terminology — the repo's own names for its concepts
- noise and generated-path de-emphasis — paths whose churn is low-signal for a reviewer
- repo-specific reading conventions — structural foundation relations between directories (facts feeding foundation-first ordering, never importance)
- summary phrasing preferences — tone and framing of the text

```markdown
## Grouping

- Treat `apps/api` and `apps/api-client` as one review unit — they
  always change together.
- `infra/**` changes are their own group even when a feature PR touches them.

## Glossary

- "The ledger" = `services/billing/ledger` — never call it the database.
- A "tenant" here is an *installation*, not a user.

## Noise

- `generated/**` and `*.snap` churn is low-signal; de-emphasize it in
  summaries.
- Lockfile-only chunks need no text.

## Reading conventions

- `packages/schema` is the foundation of `packages/engine`; schema changes
  come first in reading order.

## Phrasing

- Prefer plain, terse summaries; skip marketing verbs.
- Refer to feature flags by their config key, not their internal name.
```
