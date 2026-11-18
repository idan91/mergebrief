# The demo's example brief

The demo build answers the brief page from these files. They are one real pull request of this project, "fix: Sign Out Everywhere Revokes Every Session", shown as `idan91/mergebrief` #625. The browser tests keep their own fixture set in `apps/web/e2e/fixtures` and never read this folder.

`index.test.ts` holds every file here to the product's own readers. Change a file and that test says whether the app can still read it.

## Where each part comes from

| File                        | Source                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `rev-2.diffs.json`          | The pull request's diff from its base to its last commit, one entry per file, as GitHub serves it. Unedited. |
| `rev-2.brief.json`          | The brief MergeBrief wrote for that diff, with the edits listed below.                                       |
| `rev-1.diffs.json`          | The diff from the same base to the pull request's first commit. Unedited.                                    |
| `rev-1.brief.json`          | Derived from the revision 2 brief, as described below. The product never wrote a brief at this commit.       |
| `rev-1-to-2.diffs.json`     | The diff between the two commits. Unedited.                                                                  |
| `rev-1-to-2.marks.json`     | The changed lines of that diff, in the shape the product computes them.                                      |
| `rev-1-to-2.narrative.json` | Written by hand from that diff.                                                                              |

## What was edited in the revision 2 brief

The groups, the chunks and their line ranges, the Split, the risk surface, the reading order, the summary and the Intent check's findings are as the product wrote them. These parts are not:

- **Generation stamp.** Rewritten to an API provider. The brief was generated through a subscription CLI, which the demo must not present as a deployed setup.
- **Product diff.** Written by hand from the diff and its tests. The brief predates that section.
- **Repository and owner.** The pull request was opened in a private repository that no longer exists under that name. It is shown under this one.
- **Ticket.** The ticket key is removed and the ticket's address replaced with the tracker's home page. The ticket's title and what the Intent check read from it stay.
- **Description.** Two parts are cut: the screenshots, which a visitor could not load, and one paragraph of review notes.

## Why the first revision is derived

The pull request's real pushes were rebases over a moving base: its own diff was the same at each one, so the product had nothing to say about what changed between them. The demo shows the pull request after its first commit, which adds the endpoint, and after its last, which adds the menu row that calls it. Both are real states of the code. The boundary between them is chosen.

The revision 1 brief is the revision 2 brief cut down to that first commit:

- The menu row's group and its chunks are removed. The remaining group keeps its title and summary.
- Each remaining chunk takes the lines its file changes in `rev-1.diffs.json`. Every file holds one chunk in both briefs, so no line is assigned by judgement.
- The Split and the totals are recounted from those chunks.
- The summary, the reading order's one reason, the Intent check's alignment sentence and its two "stated but missing" items are written by hand: the description promises the menu row and the changelog entry, and this revision has neither.
- The Product diff keeps the four changes that belong to the endpoint.
