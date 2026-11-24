# Risk policy: `policy.yaml`

`.mergebrief/policy.yaml` adds your repository's own **risk attributes**, scoped to the paths where they matter, and quiets built-in ones that are noise for you. A risk attribute is a fact a reviewer should know about a chunk of a change, such as `touches-auth` or `no-tests`. Every brief marks each chunk with the ones that apply, and MergeBrief ships a fixed set of them ([Built-in attributes](#built-in-attributes)). To confirm the file applied, see [Check that your config applied](./README.md#check-that-your-config-applied).

## Add a risk attribute

```yaml
version: 1
attributes:
  touches-billing:
    criteria: >
      Modifies invoicing, payment or ledger code, or the data those
      read and write.
    implication: Needs a reviewer from the billing team.
```

Describe the fact in `criteria`; the model checks each chunk against it. `implication` is the one line a reviewer sees when they open the attribute's chip: what to do about it. Write `criteria` the way you would brief a new reviewer: concrete, observable, about the change or the code it touches.

To check: merge the file, then push to a pull request that changes billing code. The chunks that meet the criteria carry a `touches-billing` chip, and opening it shows your implication.

## Limit an attribute to some paths

```yaml
version: 1
attributes:
  touches-billing:
    criteria: Modifies invoicing, payment or ledger code.
    implication: Needs a reviewer from the billing team.
    paths:
      - services/billing/**
      - packages/ledger/**
```

`paths` is a hard scope: a chunk in a file outside every glob never fires the attribute, whatever the model thinks. Without `paths`, every file is in scope. See [Glob patterns](#glob-patterns) for what a glob matches.

## Quiet a built-in attribute

```yaml
version: 1
attributes: {}
deEmphasize:
  - attribute: no-tests
    paths: ["scripts/**"]
  - attribute: widens-error-handling
```

`deEmphasize` lowers an attribute's weight where it is noise, here `no-tests` on scripts and `widens-error-handling` everywhere. `attributes:` is required even when you add none: write `attributes: {}`, or the file is rejected.

A quiet attribute still fires and stays in the brief and the Receipt. Its chip renders quietly, and the brief's attribute list, which jumps to the groups carrying each attribute, leaves it out. On a chunk that also carries a [floor attribute](#attributes-you-cannot-quiet), it renders at full weight, because the combination is the signal. `paths` works as it does for a custom attribute, matched against the chunk's file; without it the rule applies everywhere.

You can quiet your own custom attributes the same way. An entry naming an attribute that does not exist is dropped with a warning on the Repo config chip, and the rest of the file applies.

To check: on the next brief, the attribute's chip on matching chunks is muted, and the attribute is missing from the brief's attribute list unless another chunk fires it at full weight.

## Attributes you cannot quiet

Five built-in attributes are the floor: `touches-auth`, `removes-validation`, `relaxes-permissions`, `adds-secret` and `changes-package-source`. They always render at full weight. A `deEmphasize` entry naming one rejects the whole file:

```yaml
# Rejected: touches-auth is a floor attribute
version: 1
attributes: {}
deEmphasize:
  - attribute: touches-auth
```

## Naming rules

- A custom attribute name is lowercase words joined by hyphens, starting with a letter (`touches-billing`), at most 50 characters. Any other name rejects the file.
- At most 20 custom attributes. `criteria` is at most 4,000 characters, `implication` at most 500.
- An attribute is a fact, never a verdict: there is no severity, tier or weight. Each attribute takes only `criteria`, `implication` and `paths`, and any other key rejects the file.
- A name that is already a built-in attribute, or one of the reserved words `unresolved-reference`, `diverges-from-sibling-pattern` and `uncertain`, is dropped and the built-in wins. The file still applies, and the Repo config chip shows **Built-in wins over custom name:** with the name.

## Glob patterns

`paths` in this file, and the `paths` [trigger condition](./trigger-conditions.md#brief-only-changes-to-some-paths), use one small glob language:

- A pattern matches the whole path from the repository root. `src/*.ts` matches `src/app.ts`, not `lib/src/app.ts`.
- `*` matches any run of characters inside one directory. `?` matches one character other than `/`.
- `**` matches any run of characters across directories. `**/` matches zero or more whole directories, so `src/**/fixtures/*` matches `src/fixtures/a.json` and `src/api/fixtures/a.json`.
- Matching is case-sensitive.
- Every other character is literal: no braces (`{a,b}`), no character classes (`[abc]`), no `!` negation. Write two globs instead of `{a,b}`.

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `services/billing/**` | `services/billing/api.ts`, `services/billing/db/ledger.sql` | `services/billing-v2/api.ts` |
| `*.sql` | `schema.sql` | `db/schema.sql` |
| `**/*.sql` | `schema.sql`, `db/migrations/001.sql` | `db/schema.SQL` |
| `docs/?.md` | `docs/a.md` | `docs/ab.md` |

## Built-in attributes

These are the names you can quiet (except the floor) and cannot reuse. What each one means, and how a reviewer checks it, is in [Risk flags](../use/risk-flags.md).

| About | Attributes |
| --- | --- |
| The code | `no-tests`, `no-types`, `legacy-area`, `dense-logic` |
| The change | `touches-auth` (floor), `mutates-state`, `removes-validation` (floor), `relaxes-permissions` (floor), `widens-error-handling`, `adds-feature-flag`, `new-dependency`, `new-abstraction`, `comment-contradicts-code`, `adds-secret` (floor), `changes-package-source` (floor) |
| The blast radius | `external-io`, `cross-service`, `schema-adjacent`, `hot-path`, `widely-imported`, `release-imminent` |

## Keys

The file starts with `version: 1` and stays within its [size limit](./README.md#the-three-files).

| Key | Required | Value |
| --- | --- | --- |
| `version` | yes | `1` |
| `attributes` | yes | A map of custom attribute name to `criteria` (required), `implication` and `paths`. `{}` for none. |
| `deEmphasize` | no | A list of `attribute` (required) and `paths` |
