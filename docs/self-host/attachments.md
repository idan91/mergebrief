# Images in review comments

A reviewer can paste or drop an image into a comment in MergeBrief, and the CLI can attach one to a draft. MergeBrief does not store the image. The App pushes it to a branch named `mergebrief/attachments` in the pull request's own repository, and the comment links to that file, so GitHub shows it inline and a private repository's images stay as private as its code.

This is the only push the App makes, and the reason its **Contents** permission is read and write.

## Enable attachments

Attachments work once three things are true for a repository:

1. **The App is installed on it.** A pull request added by pasting its URL, from a repository the App is not installed on, offers no attach control.
2. **The App's Contents permission is Read and write,** accepted on the installation ([github-app.md](./github-app.md#permissions-least-privilege-exactly-these)). With Contents at read-only, an attach fails with "The MergeBrief App may not write to this repository (its Contents permission is read-only), so the image was not attached."
3. **No ruleset or branch protection matches `mergebrief/*`.** A rule there refuses the push, and the composer says "This repository blocks attachment pushes (a rule on its mergebrief/* branches), so the image was not attached." Keep such a rule on any repository the App must never write to; nothing else breaks.

Any signed-in reader of the repository can then attach; the commit is the App's, never the reviewer's.

**Check:**

1. Open a pull request's brief in MergeBrief, start a comment, and paste an image into it, or choose **Attach image**. The composer's hint reads "Paste or drop an image; it is pushed to this repository's `mergebrief/attachments` branch".
2. Once it uploads, the comment holds a link to the image.
3. On GitHub, the repository's branch list shows `mergebrief/attachments`, holding one `<uuid>.png` (or `.jpg`, `.gif`, `.webp`) commit per image.

From the terminal, `mergebrief draft attach 7 screenshot.png` uploads a file and prints its URL; it needs an `external-write` token ([cli.md](../use/cli.md#commands)).

## What lands where

- One commit per image, on `mergebrief/attachments`, named `<uuid>.<png|jpg|gif|webp>`. The first upload creates the branch with no parent commit. It never touches any other branch and holds nothing but images.
- The comment links `https://github.com/<owner>/<repo>/blob/mergebrief/attachments/<uuid>.<ext>?raw=true`, a GitHub URL, so a comment posted to GitHub keeps working after this instance is gone.
- PNG, JPEG, GIF and WebP, 10 MB or less per file. The API checks the file's bytes, not only its declared type.

## Limit uploads per reviewer

Each reviewer may attach only so many files and megabytes per window ([defaults](./configuration.md#attachments)). Change the limits in `mergebrief.config.yaml`, for example to a smaller budget:

```yaml
# mergebrief.config.yaml
attachments:
  quotaFiles: 5            # files per reviewer per window
  quotaMb: 20              # megabytes per reviewer per window, at least 10
  quotaWindowMinutes: 10   # the window starts at the reviewer's first upload
```

Only the api reads the block ([Apply a change](./configuration.md#apply-a-change)):

```sh
docker compose restart api
```

The limit exists because reading a repository is enough to attach, and the push is the App's. Each key is a positive whole number, and an omitted key keeps its default; anything else refuses `api` boot, naming the key on the last line of `docker compose logs api`. Past either limit the composer says "You have attached as many images as this server allows for now", the API answers `429 attachment-limit-reached` with a `Retry-After` header, and `mergebrief draft attach` exits 7. Every attempt that reaches GitHub counts, a failed push included, and a reviewer's browser session and API tokens share one count. The count lives in the api process: a restart clears it, and each api replica counts on its own ([data-and-scaling.md](./data-and-scaling.md#run-more-than-one-api)).

## Limit the size of images and videos shown

A brief shows images and videos from the pull request's description and its repository. `mediaMaxMb` sets the largest one the API streams ([default](./configuration.md#attachments)):

```yaml
# mergebrief.config.yaml
attachments:
  mediaMaxMb: 50
```

```sh
docker compose restart api
```

`mediaMaxMb` sits in the same `attachments` block as the upload limits. It is judged on the file's full size: a larger file answers `413 media-too-large`, and the page shows that it could not load, with an **Open on GitHub** link.

## Delete the attachment branch

A repository admin can delete the branch from Home: the row menu of any pull request in that repository offers **Delete attachment branch**, behind a dialog that takes the repository's name typed back. Every comment that embedded an image from the branch, on GitHub and in every brief, then shows a broken image. The next attachment creates the branch again, empty.

Only a browser session can confirm it, on a fresh check of the admin permission: an API token gets `403 human-only`. The branch can also be deleted on GitHub like any other.

## Reference

### How images and videos are served

Every image or video a brief shows from a private source, pasted into the pull request or committed to its repository, is read by the API with the viewer's own access and streamed to the browser from the instance's own origin. Nothing is cached; every reply is `no-store`, sandboxed and `nosniff`, under a content type from the API's own list: PNG, JPEG, GIF, WebP, MP4, WebM and QuickTime, and SVG for a committed file only. A committed file's type is read from its bytes; a pasted file keeps the type GitHub names only when it is on the list. A Git LFS pointer committed under a video name is refused like any file whose bytes are not the type its name claims.

Limits per api process:

| Limit | Value | Past it |
| --- | --- | --- |
| Open media streams | 64, whole images included | `503 media-streams-busy` until one ends |
| One video piece | 4 MiB per `206` reply, 30 seconds from its headers | the player asks for the rest as its next piece |
| GitHub's headers | 15 seconds | the read fails |
| Strip previews resizing at once | 4, each waiting up to 10 seconds for a turn | `503 thumbnails-busy` |
| A strip preview's original | PNG, JPEG, WebP or GIF, at most 20 MB (or `mediaMaxMb` when lower) and 40 megapixels | `404`, and the page shows the original |

The Media strip's previews are one WebP size, fitting 496x156, never enlarged, with metadata dropped; an animated GIF gives its first frame. The image carries the notices and licence texts of the libvips the resizer uses in `/app/THIRD_PARTY_NOTICES/`.

### What the audit log records

Both operations are `external-write` rows keyed on the repository rather than a pull request: `upload-attachment` and `purge-attachments`, with `target_type = repository` and the repository's id. A push or purge refused past the gate (a non-admin, a token, a rule on the branch) is a denial naming the same repository ([Query the audit log](./data-and-scaling.md#query-the-audit-log)).
