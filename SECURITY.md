# Security policy

## Reporting a vulnerability

Please don't open a public issue or pull request for a vulnerability.

Report it privately through GitHub: open this repository's **Security** tab
and choose **Report a vulnerability**. The report stays visible only to you
and the maintainer until a fix ships.

If you can't use GitHub's form, email `security@mergebrief.com`.

## What to include

- The MergeBrief version (the release tag, or the image tag you run) and how
  it's deployed: the shipped compose file, the container image on its own,
  or the CLI.
- The component involved: the API, the web tier, the worker, the CLI, or the
  GitHub App setup.
- Steps to reproduce, with a proof of concept if you have one.
- What an attacker gains: whose data they can read or change, and what they
  need first (a signed-in account, write access to a repository, a crafted
  pull request).
- Any configuration that matters, such as instance config keys or a
  repository's own config file. Leave out real secrets and tokens.

## What happens next

The maintainer aims to acknowledge a report within 7 days. That's best
effort. MergeBrief has one maintainer and no on-call rotation.

After that you'll hear whether the report is confirmed, and you'll get a
fix plan when there is one. The fix ships as a new release whose notes are
marked as a security release. Running instances show it in an update band
that can't be dismissed and log it at `warn`.
[Upgrade and roll back](docs/self-host/upgrade.md)
describes both.

There is no bug bounty.

## Supported versions

Only the latest release gets security fixes. Older releases are not
patched, so the fix for an older install is to upgrade.
