# tools/baselines — agent notes

The gate behind the repo's two baseline promises: `oxlint-suppressions.json` and `.dependency-cruiser-known-violations.json` only ever lose entries, and a file a branch edits clears its own entries. `pnpm check:baselines` is its entry point, and it runs inside `pnpm lint`.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants (enforced, don't weaken)

- **The base ref is explicit.** `--base <ref>`, else `MERGEBRIEF_BASELINE_BASE`, else `main`. The comparison point is `merge-base(<ref>, HEAD)`, matching CI's own two-dot selection. A ref this checkout does not carry fails the gate with the fetch instruction; it never passes silently, because a silent pass is indistinguishable from a clean branch.
- **The working tree is what is judged**, not HEAD: `pnpm lint` reads the tree, so the gate must too, untracked files included.
- **A git failure is an error, never an empty change set.** An empty change set disables both cleanup-on-edit refusals while every other check still passes, so the run would read as clean. `--name-status -z` framing is part of this: a quoted path would not match its baseline key. A status letter the gate does not model, `U` unmerged above all, fails rather than being dropped.
- **Four refusals.** A new entry, a grown count, a rule total that grew across all files, and an edited file that kept its debt. The third exists because moving debt between files or rules hides growth from the other two.
- **A rename is checked under both names.** Leaving the old key in place would otherwise carry a file's debt out of reach of the edited-file check.
- **Names only.** The gate reads the two baseline files, `.oxlintrc.json`, the root `package.json`, and git's name and blob output. It never reads a working-tree source file, so it can never read an env file.
- **The escape hatch cannot outlive its baseline.** Once `.dependency-cruiser-known-violations.json` is gone, the root lint command must not still pass `--ignore-known`, and re-creating the file is itself a refusal.

## Report

Retired entries are split three ways so a green run cannot be read as more progress than it is: `fixed` (the rule is still configured and the file lost violations), `policy` (the rule is no longer in `.oxlintrc.json`), and `deleted` (the file left the tree). Only `fixed` means someone fixed something.

## Verification

```sh
pnpm -C tools/baselines test        # temporary git histories, one per refusal
pnpm check:baselines                # the gate against this checkout
```
