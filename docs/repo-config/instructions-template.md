# `instructions.md` template

Copy this into `.mergebrief/instructions.md` on your default branch and replace the examples with your repository's. Every section is optional: delete the ones you don't need. Each heading matches one thing instructions can change; [Instructions](./instructions.md) explains each one, what instructions cannot change, and the size limit.

```markdown
## Grouping

- Treat `apps/api` and `apps/api-client` as one review unit; they
  always change together.
- `infra/**` changes are their own group even when a feature PR touches them.

## Glossary

- "The ledger" = `services/billing/ledger`; never call it the database.
- A "tenant" here is an *installation*, not a user.

## Noise

- `generated/**` and `*.snap` churn is low-signal; de-emphasize it in
  summaries.
- Lockfile churn (`pnpm-lock.yaml`) is low-signal unless a dependency
  changes version.

## Reading conventions

- `packages/schema` is the foundation of `packages/engine`; schema changes
  come first in reading order.

## Phrasing

- Prefer plain, terse summaries; skip marketing verbs.
- Refer to feature flags by their config key, not their internal name.
```
