# Cap daily generation spend

The daily cap limits how many generation runs the instance starts in one UTC day, across every repository it serves. It is on by default at 300 runs a day. It is what stands between a burst of webhooks and your model provider bill, since the webhook route has no rate limit of its own. Only the operator sets it: no repository file can raise or lower it.

The cap counts runs, not money. It is a ceiling on what you are willing to spend in a day, not an invoice; set a spend limit at your provider too.

## Set the cap

Add a `spend:` block to `mergebrief.config.yaml`:

```yaml
# mergebrief.config.yaml
spend:
  maxGenerationsPerDay: 50
```

The value is a positive whole number, or `unlimited` to run with no cap. Then restart the two services that read it:

```sh
docker compose restart api worker
```

A bad value refuses boot; `docker compose logs worker` and `docker compose logs api` name it.

**Check:** [see today's count](#see-todays-count): the line now ends "of its 50 runs today" (Settings) or "of 50 runs started today" (CLI).

There is no per-repository share: one busy repository can use the day's runs for the others. If that bites, raise the number.

## See today's count

Only an [operator](./security-model.md#an-operator) can read it.

- **In the browser:** open Settings, then the **Instance** tab. **Daily runs** says "This instance has started 37 of its 50 runs today." and when the count resets in your time zone.
- **From the terminal:**

  ```sh
  mergebrief spend
  ```

  ```text
  37 of 50 runs started today · resets at 00:00 UTC
  ```

  `mergebrief spend --json` prints `startedRuns` and `cap`; `cap` is absent with no cap.

The count resets at 00:00 UTC.

## What happens at the cap

The worker skips the push before any provider call:

- The pull request's brief page says "Daily generation cap reached." with the reset time in the viewer's time zone. It is not shown as a failure.
- An Entry comment that already exists on the pull request is updated to say so. A capped pull request with no Entry comment gets none.
- The worker logs `spend.cap.trip` at `warn` with `repo`, `prId`, `headSha`, `cap` and `dayUtc` ([observability.md](./observability.md#event-vocabulary)). Alert on it.
- Nothing is queued for later. After the reset, the pull request gets its brief on its next push, review or other event that queues it. A pull request added by pasting its URL is briefed when its URL is pasted again.

## What counts

The counter is one record per started run, on the UTC day the run started:

- **Every started run counts,** in every repository, whether it succeeds, fails, or is superseded by a newer push. A push that is queued again (another push lands, a review is submitted) counts again, and so does every automatic retry. One busy pull request can use a day's runs by itself.
- **A run that makes no model call costs nothing.** A push that changed nothing, so its brief carries over whole, keeps its record at zero.
- **Queued jobs and capped skips do not count,** so a burst of webhooks cannot trip the cap before a token is spent.
- **A job that finds its brief already stored** (a review submitted after the brief, a retry whose brief landed before it failed) counts only if it still owes a model call, such as a delta for a reviewer, once, at that call. While the instance sits at the cap it is refused before any work.
- **Deleting a pull request does not give its runs back.**

One run can make several model calls: the brief, a revision narrative against the previous brief, and one delta per reviewer checkpoint. On a public or internal repository only the owner, organization members, collaborators and others with write access set a checkpoint, so outside reviewers add no calls; on a private repository every reviewer sets one.

### Large pull requests

A pull request too large for one model call is briefed in parts ([The large pool](./generators.md#the-large-pool)). It counts one run when it starts and one more for each part, claimed together once the plan names the parts. If the day has fewer runs left than the parts need, the run stops before any part is briefed, and the brief page says how many runs it needs and how many are left. A retry pays only for the parts it has not stored yet. **Daily runs** in Settings shows how many runs were briefed in parts and how many they took.

### Calls the cap does not count

Two extra model calls ride on a run without counting, but your provider bills them:

- **Summary Media.** A pull request whose description holds images or videos makes one call after the brief to pick its Summary Media. If it fails, the brief ships without it and carries a `summary-media-failed` warning.
- **Product diff.** A brief written in one call is followed by one more that writes its Product diff, reading the diff a second time: expect roughly the brief call's input tokens again and a small answer. If it fails, the brief ships without it and carries a `product-diff-failed` warning. A pull request briefed in parts makes no such call.

The count is exact across slots and worker processes: every start takes one instance-wide lock, so several slots cannot start past the cap together.
