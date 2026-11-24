# Repository config for operators

The people who maintain each repository can commit a `.mergebrief/` directory to shape that repository's briefs: which pushes generate, its ticket trackers, its trusted bots, its risk policy and its instructions to the model. Their guide is [Configure your repository](../repo-config/README.md). This page covers what that means for you as the operator.

## What a repository controls, and what you keep

| Setting | Who sets it | How they combine |
| --- | --- | --- |
| Provider, model, spend cap, who may sign in | You, in `mergebrief.config.yaml` ([configuration.md](./configuration.md)) | Repositories cannot change these. |
| Trigger conditions | You for every repository, and each repository for itself | Merged per kind: a kind the repository sets replaces yours, and it can switch yours off ([How the instance's conditions merge](../repo-config/trigger-conditions.md#how-the-instances-conditions-merge-with-yours)). Only a repository sets `paths`. |
| Ticket trackers | You for every repository, and each repository for itself | A repository that lists any tracker replaces your list whole. Notion and Jira credentials stay yours ([trackers.md](./trackers.md)). |
| Trusted bots, Entry comment on drafts, risk policy, instructions | Each repository | Yours has no equivalent. |

A broken instance file refuses boot. A broken repository file only degrades that repository's briefs: the file is dropped whole, the brief says so on its Repo config chip, and every other repository is unaffected.

## Set conditions for every repository

Write a `triggerConditions:` block in `mergebrief.config.yaml`. It takes the same kinds and recipes as a repository's ([Trigger conditions](../repo-config/trigger-conditions.md)) except `paths`, and a bad block refuses `worker` boot ([configuration.md](./configuration.md#triggerconditions)). A held push names each unmet condition as the instance's or the repository's, so authors know whom to ask.

## Damp draft regeneration

The `drafts` block in `mergebrief.config.yaml` lengthens the wait before a draft pull request regenerates, to cut spend while its author pushes work in progress:

```yaml
# mergebrief.config.yaml
drafts:
  debounceSeconds: 900
```

Unset, a draft waits the normal 60 seconds like any pull request. With a window set, a draft's first push in a burst fixes the start time, and later pushes inside the window only move the head the run will brief, so the window bounds how late a run starts rather than pushing it back on every push. A draft's first brief always uses the normal window, and marking a pull request ready for review queues it on a short window of about 10 seconds, so the brief is fresh when the reviewer arrives.

To hold drafts until they are ready instead, set [`readyForReview: on`](../repo-config/trigger-conditions.md#hold-drafts-until-they-are-ready-for-review) under `triggerConditions:`. The removed `drafts.generate` key refuses boot and names that replacement.
