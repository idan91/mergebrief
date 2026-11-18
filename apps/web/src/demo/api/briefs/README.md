# The demo's example brief

These files are the demo build's example: one real pull request of this project, "fix: Sign Out Everywhere Revokes Every Session", shown as `idan91/mergebrief` #625. The browser tests keep their own fixture set in `apps/web/e2e/fixtures` and never read this folder.

`index.test.ts` runs the product's own readers over the files here and holds their line totals to the patches. It does not check a chunk's line ranges one by one.

## Where each part comes from

| File               | Source                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `rev-2.diffs.json` | The pull request's diff from its base to its last commit, one entry per file, as GitHub serves it. Unedited. |
| `rev-2.brief.json` | The brief MergeBrief wrote for that diff, with the edits listed below.                                       |

## What was edited in the brief

The groups, the chunks and their line ranges, the Split, the risk surface, the reading order, the summary and the Intent check's findings are as the product wrote them. These parts are not:

- **Generation stamp.** Rewritten to an API provider. The brief was generated through a subscription CLI, which the demo must not present as a deployed setup.
- **Product diff.** Written by hand from the diff and its tests. The brief predates that section.
- **Repository and owner.** The pull request was opened in a private repository that no longer exists under that name. It is shown under this one.
- **Ticket.** The ticket key is removed and the ticket's address replaced with the tracker's home page. The ticket's title and what the Intent check read from it stay.
- **Description.** Two parts are cut: the screenshots, which a visitor could not load, with the sentence that described them, and one paragraph of review notes.
