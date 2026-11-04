# 0048: JSON documents are stored as checked `text`

Status: accepted
Date: 2026-11-04

Amends D6 of ADR 0018, which stored artifact bodies inline as `TEXT`: this
record adds the checks, the write guard and the reasons, and removes
`byte_size`.

## Context

Nine columns hold a JSON document:

| Column                    | Holds                                                      | Read                                   |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `brief.body`              | The full brief: summary, change groups, chunks, risk flags | Served as stored; the worker parses it |
| `delta.body`              | A Delta Brief, or a skip or no-change record               | Served as stored; the app parses it    |
| `revision_narrative.body` | A revision narrative, or a skip or no-change record        | Served as stored; the app parses it    |
| `comparison_marks.body`   | Two SHAs and per-file marks, coordinates only              | Whole row, in the app                  |
| `chunk_layout.body`       | Row counts per chunk and per file                          | Served inside `{"layout":...}`         |
| `generation_part.body`    | A multi-call run's saved output, for resuming              | Worker only, swept after a week        |
| `hunk_span.spans`         | Files and hunk positions                                   | Whole list, parsed for carry-over      |
| `brief.repo_config`       | Repo config origin and policy snapshot                     | Whole value, through the API           |
| `generation.repo_config`  | A run's per-file config outcomes                           | Whole value                            |

Each is written as a unit and read whole. No runtime query reads inside any of
them. A value SQL does need already has a column of its own: `carried_chunk_ids`
and `used_group_ids`, the session counts, `skipped` and `unchanged`.

## Decision

- **The column type stays `text`.** The `jsonDocument` column type in
  `schema/columns.ts` is the one way to declare such a column.
- **Postgres checks the shape.** Each column carries an `IS JSON OBJECT` CHECK,
  or `IS JSON ARRAY` for `hunk_span.spans`. A NULL `repo_config` passes.
- **The column cleans what a cast would refuse.** `jsonDocument` replaces NUL and
  lone surrogates with U+FFFD at write, in `db/json-text.ts`, so every write
  passes through it and no store can skip it. Every other byte stays as it was.
  Replacing the characters rather than refusing them means a brief the model has
  already been paid for is saved instead of failing and retrying.
- **Stored rows move with the rule.** The migration replaces the same characters
  in existing rows, by the same walk: one escape at a time, because a pattern
  cannot tell a real escape from a doubled backslash followed by `u0000`, which is
  ordinary text. A surrogate pair stays only when both halves are real escapes.
- **A row off the shape gets an answer per column.** Derived rows that are not
  valid (`chunk_layout`, `comparison_marks`, `generation_part`, `hunk_span`) are
  removed, because a later run rebuilds them or the reader goes on without them.
  An invalid `repo_config` becomes NULL. A `brief`, `delta` or
  `revision_narrative` body that is not a JSON object stops the migration with a
  message naming the table and the query to find it. Those rows cost a model call,
  and deleting a brief also removes its narrative, layout and review sessions, with
  their drafts and read marks, so an operator decides.
- **`byte_size` is gone.** Nothing read it.

## What the decision rests on

Measured on Postgres 17 over 58 stored documents (median 6 KB, largest 30 KB),
each written 5 times:

|                                      | `text`   | `json`   | `jsonb` |
| ------------------------------------ | -------- | -------- | ------- |
| Average write                        | 1.5 ms   | 1.4 ms   | 2.3 ms  |
| Stored size per row                  | 3,055 B  | 3,055 B  | 3,656 B |
| Documents keeping their exact bytes  | 58 of 58 | 58 of 58 | 0 of 58 |
| Accepts `\u0000` and lone surrogates | Yes      | Yes      | No      |

Speed decides nothing here: a document is written once per generation.

Measured over 20,000 small synthetic rows:

|                          | `text` with a cast                                                      | `jsonb`                    |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------- |
| Btree index on one field | Builds, used by the planner, 0.59 ms                                    | Builds, 0.76 ms            |
| GIN index                | Builds on `(body::jsonb)`; the planner did not use it for an `@>` query | Builds; that query not run |
| Scan with no index       | 12 ms                                                                   | 1.65 ms                    |

Four findings decided it:

- **Indexing does not need a type change.** An expression index on
  `(body::jsonb ->> 'field')` works on `text`, so the main reason to choose
  `jsonb` in advance does not apply.
- **The API serves stored text as it is.** `read-artifact.ts` returns the column
  and builds `{"layout":...}` by concatenation. The driver hands `jsonb` back as
  an object, which would add a parse and a serialize to every read.
- **`jsonb` adds a silent failure.** A Drizzle `jsonb` column given a string
  stores a JSON string, not an object, and reading it through Drizzle returns an
  object, which hides the fault. Every writer here passes a string.
- **`jsonb` moves a rare failure to an expensive place.** It refuses `\u0000` and
  lone surrogates at write, which comes after the model call, and the retry pays
  again. The same characters in a `text` column would instead fail any later
  `::jsonb` cast, and a migration holding that cast would stop the instance at
  boot. The write guard closes both.

## Alternatives

- **`jsonb`.** Postgres's documentation says most applications should prefer it,
  and its operators and scans are better when SQL works inside a document. Here
  nothing does. It costs about 20% more storage, loses key order, and needs a
  custom column type and a `jsonb_typeof` check to be safe. It is also the choice
  a reader expects, so this record exists to answer that question.
- **`json`.** Keeps exact bytes, checks validity and supports `->>` without a
  cast, so it is the closest fit by type. The driver parses it on read, so it
  would need a per-connection parser setting for the API to keep serving stored
  text. An `IS JSON` CHECK gives the same guarantee without that.
- **Real columns or child rows for everything.** GitLab's guidance prefers this
  for fields shared by every row, and it is the rule here for anything SQL
  filters on. These documents are nested model output written and read as a unit.
  `chunk_layout` as rows would mean hundreds of inserts per brief, read back all
  at once.

How other projects store comparable data, read from their schemas. The link
between `text` and supporting several databases is an inference:

| Project         | Data                                     | Type on Postgres                                    |
| --------------- | ---------------------------------------- | --------------------------------------------------- |
| Grafana         | Dashboard JSON                           | `text`; targets several databases                   |
| Metabase        | Action queries, `visualization_settings` | `text`; targets several databases                   |
| n8n             | Execution data                           | `text`, with `json` for `workflowData` beside it    |
| Graphile Worker | Job payload                              | `json`                                              |
| Outline         | Document content snapshot                | `jsonb`                                             |
| Mattermost      | Post `props`                             | Began as `VARCHAR(8000)`, later migrated to `jsonb` |

Grafana and Metabase show the pattern works in widely used products with the same
access pattern. They do not show it is best for a Postgres-only application, and
a CHECK is what such an application adds in return.

## Consequences

- SQL that reads inside a document casts: `body::jsonb ->> 'field'`. The
  migration and the write guard together make that cast safe on every row.
- The migration is forward only, like every migration here. The replaced
  characters, the removed rows and `byte_size` do not come back, so restoring
  them means restoring a backup.
- Ad hoc scans over these columns are slower than they would be on `jsonb`.
- `span-keys.ts` loads and parses two full bodies to ask whether a span was too
  large. That is the one place the format costs real work, and a `skip_reason`
  column would remove it. It stays as it is until it matters.
- `audit_log.metadata`, `generation.error_params` and `pull_request.stack` remain
  `jsonb`. They are small values the app writes as objects, and nothing gains
  from moving them.

## When to revisit

- **A new query needs a value inside a document:** give the value its own column.
- **A column does not fit:** add an expression index on the cast.
- **Searching arbitrary fields inside briefs becomes a product feature, across
  repositories or by shape:** move the document columns to `jsonb`. Fields that
  cannot be planned in advance are what `jsonb` and GIN exist for.
- **Body size becomes the limit:** look at retention, then at the object storage
  ADR 0018 D6 deferred. A column type does not change this.

Moving to `jsonb` later takes one `ALTER COLUMN ... TYPE jsonb USING col::jsonb`
per column, a table rewrite, under the expand-and-contract rule. It also takes
the `jsonb_typeof` checks and a read path that handles objects. The checks, the
migration and the write guard here mean every row will convert.
