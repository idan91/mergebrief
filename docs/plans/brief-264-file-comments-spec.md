# File comments

Status: NORMATIVE. Locked 2026-09-08 on the wayfinder map [Let a reviewer comment on a whole file, not just a line](https://app.notion.com/p/3d55e9400eeb8114b9c0f340d3c9fbf8). Ready for `/to-tickets`. Commit of this file is the owner's call.

A **File comment** is a **Comment** with a file anchor instead of a line range. Same Review Session lifecycle (draft, edit, publish with the rest of the review). GitHub `subject_type: file`. Never a line-1 workaround.

Glossary: `CONTEXT.md` (**Comment**, **Line comment**, **File comment**). **Scope** remains Full vs Changes; do not reuse it here.

## Decisions

### Identity

One Comment type, two anchor shapes. A Chunk does not own a Comment. Drafts already key on file coordinates, not chunk id; the Chunk is where a Line comment is composed.

```ts
export const CommentAnchorKinds = { LINE: "line", FILE: "file" } as const;
```

The map lives in `packages/types/src/comments.ts` (`types` and `types/comments`) so the store and the Brief client share one copy. The surrounding unions stay with their owners:

```ts
interface DraftAnchorBase {
  kind: CommentAnchorKind;
  file: string;
}

interface LineDraftAnchor extends DraftAnchorBase {
  kind: typeof CommentAnchorKinds.LINE;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  startSide?: "old" | "new";
}

interface FileDraftAnchor extends DraftAnchorBase {
  kind: typeof CommentAnchorKinds.FILE;
}

type DraftAnchor = LineDraftAnchor | FileDraftAnchor;
```

The base must not grow optional `startLine` / `endLine`. Those exist only on the line arm. Same pattern as `GroupViewBase`.

Several File comments on one file are legal, same as several Line comments on one line.

### Placement (Brief view)

Match GitHub Files changed, mapped onto the existing ChunkCard. Do not clone Primer, Copilot, attach-files, reactions, or GitHub's "Comment" vs "Start a review" pair.

GitHub (owner screenshots, 2026-09-08):

1. A speech-bubble control on the **trailing end of the file header**, after Viewed, not on a line.
2. Opening it drops an **inline band under the header, before the first hunk** titled "Add comment on file" (Write/Preview, Cancel, submit). Not a floating modal over the page.
3. A saved file thread sits in that same slot, in a bordered band labeled "Comment on file", collapsible on its own, with the thread then a reply field. The diff starts below that band.

On the Brief, the analog is the ChunkCard header (twist + path + copy already on the left; loc + existing Viewed checkbox already on the right):

- Add a file-comment control at the **trailing end of that header**, after Viewed. Same job as GitHub's speech bubble.
- The composer and the file-comment thread occupy a band **between the header and the DiffTable** (before the first diff row). When the chunk is collapsed, the band hides with the body, same as the diff.
- Reuse `CommentComposer`, `CommentThread`, and inbound conversation threads. File-arm composer copy is "Add comment on file" (catalog); **no line-count meta** (`review.comment.lines` is line-only). Cancel + the existing draft-save / post-now / submit path stay ours.
- A saved or inbound file thread is labeled "Comment on file", not a `file:range`. Draft vs posted stays our existing CommentThread badges, not GitHub's Pending-review pill.
- The file-comment band can collapse on its own (GitHub's chevron on "Comment on file") without collapsing the chunk.

When a file is split across Chunks, each ChunkCard is a file header for that path. **One Comment, shown under every header for that path** (not a second Comment). The composer mounts on the header that opened it; the other headers show the same thread.

Inbound GitHub file threads (`subjectType: FILE`) use the same slot. `placeThread` must stop treating a missing line as `line-outside-chunks`.

### Which files

Any file that already appears in the Brief (the diff), including deleted, binary, and renamed. Unchanged files are out: they have no Brief surface.

### CLI

Same `draft create` and `reanchor`. `--file` without `--start` / `--end` is a File comment. Span flags stay required for a Line comment. Mixing `--file` with a partial span is exit 2.

### Storage

Postgres cannot store a union. The row stays wide. `kind` is the discriminant. A CHECK pairs it with the line columns. No extra index: the store still loads every draft for the session (`review_draft_comment_session_idx`).

```text
kind         'line' | 'file'     NOT NULL
file_path    text                NOT NULL
side         old | new          NULL iff kind = file
start_side   old | new          NULL unless a line range crosses sides
start_line   int                NULL iff kind = file
end_line     int                NULL iff kind = file
```

```sql
CHECK (
  (
    kind = 'line'
    AND start_line > 0
    AND end_line > 0
    AND (start_side IS NOT NULL OR end_line >= start_line)
  )
  OR (
    kind = 'file'
    AND start_line IS NULL
    AND end_line IS NULL
    AND side IS NULL
    AND start_side IS NULL
  )
);
```

Existing rows are `kind = 'line'`. New migration **replaces** `review_draft_comment_line_range_shape` (0019 is not edited). Vocabulary is CHECK-constrained in lockstep with the `as const` map, like the other session vocabs.

The store parses the wide row into `DraftAnchor` at the boundary. SQL is never the union.

### Carry-over

A File comment has no line to remap. Path is the identity.

- Path still appears in the new Brief → attached (`anchor_status` NULL). Never `moved`.
- Path gone (deleted from the PR, or renamed so the old path is absent) → **orphaned**. Same as a Line comment whose target disappeared.
- Do not follow Git renames. `remapThroughHops` is not called for the file arm.

Shipped File comments: GitHub never marks them outdated (`isCommentOutdated` already returns false when `subject_type` is not `line`). We read that; we do not recompute it.

### GitHub write

Never send a line on the file arm. Both write paths:

1. Submit: one GraphQL `addPullRequestReviewThread` per comment on a pending review, `subjectType: FILE` for the file arm (`shapeSubmitComment` / `toThreadInput`). REST's grouped `comments[]` drops `subject_type`, so a file comment cannot ride it.
2. Post-now: `createInlineReviewComment`.

File arm on the wire: `path`, `body`, `subjectType: FILE` on the thread mutation; `path`, `body`, `commit_id`, `subject_type: "file"` on post-now. Omit `line`, `side`, `start_line`, `start_side`.

Line arm unchanged: omit `start_line` when the range is a single line (GitHub 422s `start_line` equal to `line`).

### Degradation fold

A File comment has no selected text. Fold as `` **`path`** `` plus the body, no `:range`. GitHub can still reject a File comment (path not in the diff, `thread: null`); only that comment folds, and the response counts it in `commentsFolded` of `commentsTotal`.

### Receipt and attention

Location labels for a File comment are the path, not `:start-end`. Signature-line "inline comments" still counts File comments: they are Comments. Attention items for an orphaned File comment locate by path only (`AttentionLocation` grows the same discriminant).

### Web session

`CommentAnchor` becomes the same union. `createCommentAnchor` stays the line constructor (row selection). A `createFileCommentAnchor` (or equivalent) takes the path; it does not invent a `chunkId` as identity.

`useChunkReviewComments(chunkId)` stays line-only. File comments are selected by `anchor.file === chunk.file`. Rendering under every matching header follows from that.

Composer uniqueness: file-arm client ids must not go through `` `${chunkId}-…-${startLine}-${endLine}` ``. Key on kind + path + a unique suffix.

`chunkForDraft` must not place a File comment by `startLine`. Path-in-brief is the only home test.

## Surfaces that assume a line today

Every reader of `startLine` / `endLine` / `side` on a draft must take the file arm. Known call sites (not a PR split):

- `packages/persistence/src/schema/review-draft-comment.ts` and the line-range CHECK
- `packages/persistence/src/stores/review-session.ts` insert/select
- `packages/persistence/src/stores/carry-over.ts` `carryComment` / `PreviousDraftComment`
- `packages/contract/src/session.ts` `DraftCommentPayload`
- `packages/contract/src/attention.ts` `AttentionLocation`
- `apps/api/src/routes/repos/pr/session/schemas.ts` `anchorSchema`
- `apps/api/src/routes/repos/pr/session/logic/payload/`
- `apps/api/src/routes/repos/pr/session/logic/attention.ts`
- `apps/api/src/routes/repos/pr/review/logic/submit-comments.ts`
- `packages/github/src/operations/review.ts` `ReviewCommentInput`
- `packages/github/src/operations/inline-comment.ts`
- `apps/web/src/features/review/utils/comments.ts` `CommentAnchor`
- `apps/web/src/features/review/utils/submit.ts` `mapAnchorToWire`
- `apps/web/src/features/review/utils/receipt.ts` / `state.ts` location labels
- `apps/web/src/features/review/session/serverState.ts` `chunkForDraft`
- `apps/web/src/features/review/session/provider.tsx` `useChunkReviewComments`
- `apps/web/src/features/review/session/payloadGuards.ts`
- `apps/web/src/features/review/session/store.ts` `getUniqueCommentId`
- `apps/web/src/features/conversation/utils/anchor.ts` `placeThread`
- `apps/cli` draft create / reanchor span flags
- i18n catalog for the header control and any new deterministic 400

Deterministic 400s are an FE contract: a new rejection needs mirrored client-side copy.

## Out of scope

- Unchanged files (no Brief surface)
- Suggested changes on a File comment (no line range to suggest against)
- Following Git renames on carry-over
- Editing migration 0019
- A separate CLI command
- Commenting from the Fast-lane or Changes scope beyond whatever file chrome those views already have (they are not the Brief story DiffTable)
