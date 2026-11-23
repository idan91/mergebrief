# Attachments: images in review comments

A reviewer can paste or drop an image into a comment composer, and the CLI
can attach one to a draft. The image is not uploaded to MergeBrief. It is
pushed, on the App's installation token, to an orphan branch named
`mergebrief/attachments` in the pull request's own repository, and the
comment carries a link to that file. GitHub renders the link inline like any
other image, and the brief serves it through the API with the viewer's own
token, so a private repository's images stay as private as its code.

This is the one push the App ever makes. It is why the App's `Contents`
permission is read and write ([github-app.md](github-app.md)).

## What lands where

- One commit per image, on `mergebrief/attachments`, named
  `<uuid>.<png|jpg|gif|webp>`. The first upload creates the branch with no
  parent commit; it never touches any other branch and holds nothing but
  images.
- The comment links
  `https://github.com/<owner>/<repo>/blob/mergebrief/attachments/<uuid>.<ext>?raw=true`.
  That link is a GitHub URL, so a comment posted to GitHub keeps working
  after this instance is gone.
- PNG, JPEG, GIF and WebP, 10 MB or less per file. The API checks the bytes,
  not just the declared type.

Any signed-in reader of a repository the App is installed on can attach; the
commit is the App's, never the reviewer's. A pasted-URL brief (a repository
the App is not installed on) has nothing to push with, so its composer
offers no attach control.

## Upload quota

Read access is enough to attach, and the push is the App's, so each reviewer
is bounded: 10 files or 30 MB per 10 minutes by default. Past either limit
the API answers `429 attachment-limit-reached` with a `Retry-After` header,
makes no GitHub call, and the composer says so; `mergebrief draft attach`
exits 7 with the wait in its error line. Every attempt that reaches
GitHub counts, a failed push included. A browser session and an API token of
the same reviewer share one count.

The limits are keys of the `attachments` block in `mergebrief.config.yaml`:

| Key | Default | What it bounds |
| --- | --- | --- |
| `quotaFiles` | `10` | Files per reviewer per window |
| `quotaMb` | `30` | Megabytes per reviewer per window; at least `10`, the size limit of one file |
| `quotaWindowMinutes` | `10` | Window length; it starts at the reviewer's first upload |

```yaml
attachments:
  quotaFiles: 10
  quotaMb: 30
  quotaWindowMinutes: 10
```

Each is a positive whole number; an omitted key takes the default, anything
else refuses boot. The count lives in the api process: a restart clears it,
and each replica counts on its own
([data-and-scaling.md](data-and-scaling.md#run-more-than-one-api)).

## Reading images and videos

Every image or video a brief shows from a private source, whether pasted
into the pull request or committed to its repository, is read by the API on
the viewer's own access and streamed to the browser same-origin. Nothing is
cached; every reply is `no-store`, sandboxed and `nosniff`, under a content
type from the API's own list (PNG, JPEG, GIF, WebP, MP4, WebM, QuickTime;
SVG for a committed file only). A committed file's type is read from its
bytes; a pasted asset keeps the type GitHub names only when that type is on
the list, and a pasted video's first bytes must also carry a video
signature.

A video is streamed in ranged pieces, never by redirecting the browser to
GitHub's short-lived address: each reply is a `206` of at most 4 MiB, and
the player asks for the next piece itself. The API waits at most 15 seconds
for GitHub's headers, and a reader who leaves cancels the upstream read.

| Key | Default | What it bounds |
| --- | --- | --- |
| `attachments.mediaMaxMb` | `100` | The largest video or image, in megabytes, the API streams; judged on the file's full size, so a larger one answers `413 media-too-large` and shows as could not load |

At most 64 media streams are open per api process, whole images included;
past that a read answers `503 media-streams-busy` until one ends. A piece
has 30 seconds from its headers to finish; past that a reader too slow for
it gets the bytes served so far, and a player asks for the rest as its next
piece. A whole image cannot be resumed, so it gets the time its full size
takes at the same pace (about 1.1 Mbit/s), never under 30 seconds and never
over the time `attachments.mediaMaxMb` takes; one of no stated size is
given the time of a 10 MB image, and one stating a size past the cap
answers `413 media-too-large` before it holds a stream. A Git LFS pointer committed under a
video name is refused like any file whose bytes are not the type its name
claims.

The Media strip asks for small previews with `?thumbnail=strip`. The API
reads the original whole, checks from its bytes that it is a PNG, JPEG, WebP
or GIF, and answers one WebP size (fitting 496x156, never enlarged, metadata
dropped; an animated GIF gives its first frame) under the same headers.
Nothing is cached. An SVG, a video, an original over 20 MB (or over
`attachments.mediaMaxMb` when that is lower), one whose header declares
more than 40 megapixels, or one the resizer cannot read answers `404`, and the page shows the original instead. At most 4 resizes
run at once per api process; a request waits up to 10 seconds for a turn,
then answers `503 thumbnails-busy`. The image carries the notices, licence
texts and source links of the libvips the resizer uses in
`/app/THIRD_PARTY_NOTICES/`.

## Refusing pushes

A repository ruleset or branch protection matching `mergebrief/*` refuses
the push. The API answers `403 attachments-disabled`, the composer says so,
and later attach attempts on that repository stay off for the session. Keep
such a rule if you never want the App to write to a repository; nothing else
breaks. An App whose `Contents` permission was left at read-only, or an
archived repository, answers `403 github-permission` instead, and the copy
names the permission rather than a rule.

## Deleting the branch

A repository admin can delete the branch from Home: the row menu of any
pull request in that repository offers **Delete attachment branch**, behind
a dialog that names the consequence and takes the repository's name typed
back. Every comment that embedded an image from the branch, on GitHub and in
every brief here, then shows a broken image. The next attachment creates the
branch again, empty.

The decision is the admin's on a fresh read of the repository, never a
cached bit, and only a browser session can confirm it: an API token gets
`403 human-only`. The branch can also be deleted on GitHub like any other.

## What the audit log records

Both operations are `external-write` rows keyed on the repository rather
than a pull request: `upload-attachment` and `purge-attachments`, with
`target_type = repository` and the repository's id. A push or purge refused
past the gate (a non-admin, a token, a rule on the branch) is a denial
naming the same repository; the gate's own refusal, a 404 to someone with
no access, carries no target, as everywhere. See
[data-and-scaling.md](data-and-scaling.md#query-the-audit-log).
