# Configure your repository

These pages are for the people who maintain a repository that a MergeBrief instance reads. A `.mergebrief/` directory on your default branch changes how that repository's briefs are made: which pushes get one, which risks they flag, and how they group and word your code. You need write access to the repository, nothing on the MergeBrief server.

The instance's operator keeps the model, the spend cap, who may sign in, and instance-wide defaults for trigger conditions and trackers in `mergebrief.config.yaml` ([configuration.md](../self-host/configuration.md)). Your files override those defaults for your repository where the pages below say so.

## The three files

| File | What it changes | Size limit | Guide |
| --- | --- | --- | --- |
| `.mergebrief/settings.yaml` | Which pushes get a brief, the Entry comment on drafts, your ticket tracker, and which bots' pull requests generate without a click | 4 KB | [Settings](./settings.md), [Trigger conditions](./trigger-conditions.md) |
| `.mergebrief/policy.yaml` | Risk attributes your repository adds, and built-in ones it quiets | 32 KB | [Risk policy](./policy.md) |
| `.mergebrief/instructions.md` | Free text on grouping, glossary, noise paths, reading order and phrasing | 16 KB | [Instructions](./instructions.md), [template](./instructions-template.md) |

Every file is optional. MergeBrief reads these three paths and nothing else in the directory. `.mergebrief/rules/` is reserved for a later version; leave it empty.

## Add your first file

1. On a branch, create `.mergebrief/settings.yaml`:

   ```yaml
   version: 1
   triggerConditions:
     readyForReview: on
   ```

   This holds draft pull requests until they are marked ready for review.

2. Open a pull request and merge it to the default branch. MergeBrief reads the file from the default branch only, so it applies from the next generation after the merge.
3. Push to a draft pull request. It shows **No brief for this push yet** in MergeBrief instead of generating.
4. Mark it ready for review. The brief generates, and its details show the file as Applied (next section).

## Check that your config applied

Open the brief in MergeBrief and press the `i` button (Brief details) in its header. The Repo config section lists each file you committed as **Applied** or **Not applied**. With no file committed it reads "No .mergebrief configuration applied to this generation."

When something needs your attention, the brief's header also shows a warning chip, **Repo config @** and a short SHA (just **Repo config** when no file applied). Open it to see all three files with their outcome, blob SHA, bytes used of the limit, and the reason. The chip appears when:

| You see | Cause | Fix |
| --- | --- | --- |
| Not applied, `not valid YAML` | The file does not parse as YAML. | Fix the syntax. A YAML linter finds the line. |
| Not applied, `schema validation failed (...)` | A key or value the file does not accept. The parentheses name where, such as `triggerConditions.labels: custom` or `<root>: unrecognized_keys` for an unknown top-level key. `custom` means the value broke one of that key's rules, such as a list entry repeated or `tracker` and `trackers` set together; each page lists its rules. The reason never quotes your file. | Compare that key with the page's rules. |
| Not applied, `over budget: N of M bytes` | The file is over its size limit. | Shorten it. Nothing is cut: the file is used whole or not at all. |
| Not applied, with a GitHub error | GitHub failed to serve the file. The brief generated without it. | Nothing: the next generation reads it again. |
| Applied, with a warning | The file is at 80% of its limit or more, or `policy.yaml` named an attribute that does not exist under `deEmphasize`. | Trim the file, or fix the attribute name. |
| **Built-in wins over custom name:** | A custom attribute in `policy.yaml` reuses a built-in or reserved name. | Rename it ([Naming rules](./policy.md#naming-rules)). |

A rejected `settings.yaml` also drops your trigger conditions, so the instance's apply alone. A held push then lists its conditions as **Instance** only.

## How MergeBrief reads the files

- **Default branch only.** Each file is read fresh from the default branch for every generation. A pull request that edits a file is briefed like any other diff, and its edit applies once merged, so a pull request cannot loosen its own checks.
- **Whole or nothing.** Invalid YAML, an unknown key, a missing `version` or one other than `1`, a bad value, or a file over its limit rejects that file whole. A typo such as `atributes:` is rejected, never silently ignored. The other two files still apply.
- **Never blocking.** A rejected or unreadable file never stops a brief, the instance, or another repository. The brief generates without it and says so.
- **On the record.** Every brief stores which files shaped it, with each file's path, blob SHA and outcome, and the Receipt keeps a permanent copy.
