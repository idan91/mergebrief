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
[operations.md](operations.md#the-audit-log).
