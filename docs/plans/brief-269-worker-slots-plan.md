# BRIEF-269 build plan: more than one worker slot

Ticket: https://app.notion.com/p/3d75e9400eeb8190b947e24ae2c4cd9c (In progress / Now / Backend / M).
The ticket body's Decided section (10 items, 2026-09-15) is the contract; this plan is how to build it.
Plan written 2026-09-15 by init-plan. Untracked on purpose; never commit it.

## Run mode: hands-off, end to end

Idan reviews at the end. The build session runs the whole sequence below without pausing: no confirmation questions, no checkpoints at PR seams, no waiting for review rounds to be acknowledged. Every decision a skill would normally ask is pre-answered in this plan; where the plan is silent, make the call, state it in the PR body, and keep going. The only stops are the Before-merge list (Idan's hands) and a real blocker the plan cannot resolve, stated once with the alternatives.

## What exists on main already (do not rebuild)

BRIEF-266 (#528-#531, main at 9a20887eb) shipped:
- `WORKER_CONCURRENCY` parsed in `apps/worker/src/config.ts` (`parseConcurrency`, floor 1, default 1) and passed to `startWorker`.
- `startRun` in `packages/persistence/src/stores/generation.ts`: count + `running` mark in one transaction under `pg_advisory_xact_lock(hashtext('generation-cap:' || repo_id))`. Count = `countStartedRuns(executor, {repoId, from, to})`, joins `pull_request` for `repo_id`, sums `greatest(attempts, 1)` over brief-kind rows not in the excluded statuses.
- Migration 0035 (`generation_pull_request_created_at_idx`, `pull_request_repo_idx`), 0036 (`queued` to `pending`).
- `generation.start` log event with `waitMs`; compose comment for `WORKER_CONCURRENCY`; compose.md env row; generators.md "Worker slots" section with an unfilled sizing sentence.
- CONTEXT.md terms Job, Slot, Queued, Generation. Slot stays "per process".

The current checkout is `feature/BRIEF-279/submit-cta-count`, forked BEFORE 266 and carrying another session's uncommitted edits. Build from `main` in a fresh worktree or after that branch is parked. Never touch BRIEF-279's files.

## Git requirements (git-eng, mandatory for every git operation)

Invoke the `git-eng` skill explicitly for branching, commits, push and PR creation. Answers already given by Idan on 2026-09-15:

- Commits: chunked, agent commits, one commit per logical unit.
- Pre-commit review gate before EVERY commit: `security-reviewer` and `performance-reviewer` in parallel on the staged diff. `performance-reviewer` has no Bash: write `git diff --cached` to a scratchpad file and hand it the path. Findings at confidence 80 or above get fixed, re-staged, re-run until clean.
- Authorship: no `Co-Authored-By` trailer, no AI attribution line in commits or PR bodies (git-eng overrides the harness reminder).
- Push and PR creation without asking: push with `git push -u origin HEAD`, open each PR READY for review (not draft), base `main` for PR 1 and PR 1's branch for PR 2.
- Stacked PRs: PR 2 branches off PR 1. Titles per git-eng: `[BRIEF-269] feat: ...` in Title Case. PR body = overview, surprises, one verification line; run `/unslop` on it. No commit list, no ticket ids in tracked files.
- After the stack is up: one Fable `reviewer` subagent per PR (forbid checkout/switch/stash; read with `git show <ref>:<path>`, diff with `git diff A...B`), max two rounds, medium-and-above findings only. Fix upstream first. Merging and branch deletion are Idan's; `watch-pr-stack` handles realign and retarget.
- Gates before every push: `pnpm lint >/dev/null 2>&1; echo $?` on node 24.17.0 (`nvm use 24.17.0`; node 23 breaks depcruise), `pnpm test`, lint bottom-up across the stack. CI is billing-dead; local gates are the proof.

Branches:
- `feature/BRIEF-269/1-instance-cap` off `main`
- `feature/BRIEF-269/2-worker-count` off `feature/BRIEF-269/1-instance-cap`

## Specialist skills (confirmed by Idan, mandatory)

- `typescript-eng`: persistence store and schema, generators config schema, worker spend gate.
- `tdd`: red first for every behaviour change listed below; the real-Postgres suite counts as the integration test.

Repo rules that bite here: `zod/v4`; no bare `as` outside tests; `Result` for expected failures; named exports; comments only for constraints the code cannot show; no em-dash anywhere in tracked files; test titles under 70 chars, no parenthetical; migrations are SQL files plus a drizzle snapshot.

## Part and PR breakdown

Two subtasks, one PR each. Both are under the 500 LOC ideal (drizzle snapshot JSON excluded from the count). Split reason is review context, not size: PR 1 changes a spend guardrail's semantics and a lock; PR 2 is capacity dials and operator docs.

| PR | Branch | Scope | Est. LOC | Model / effort | Invocation |
|---|---|---|---|---|---|
| 1 | `1-instance-cap` | cap counted per instance, `perRepo` deleted, key renamed, migration 0037, docs of the cap | 350 to 450 | Fable 5.1, high (lock semantics, migration, test rewrite) | main thread |
| 2 | `2-worker-count` | `WORKER_COUNT` in compose, `.env.example` rows, ownership table, slot cost by provider class, sizing rule, multi-worker paragraph | 120 to 180 | Opus 5, medium (docs and yaml; no logic) | main thread, after PR 1 is pushed |

Fable quota fallback: Opus 5 high, and say so in the PR body.

## PR 1: count the daily generation cap per instance

Decided 3, 4, 5 on the ticket.

### Red tests first (tdd)

1. `packages/generators/test/spend-policy.test.ts`: `maxGenerationsPerDay` parses; `dailyGenerationCap` is refused as an unrecognized key; `perRepo` is refused as an unrecognized key; the collision cases are deleted. `packages/generators/test/config.test.ts`: the root loader's spend fixtures renamed.
2. `packages/persistence/test/generation-spend.test.ts` and `owner-scope.test.ts`: `countStartedRuns({from, to})` sums across two repos and two installations; a run in repo B counts against repo A's start. Rename every `countStartedRunsForRepo` call.
3. `packages/persistence/test/generation-cap-postgres.test.ts`: two fixtures in DIFFERENT repos, cap 1, both `startRun` concurrently; exactly one starts. Keep the existing same-repo case.
4. `apps/worker/test/generate.test.ts` (45 cap mentions today): the gate reads one cap; `spend.cap.trip` still carries `repo`; the capped Entry comment path unchanged. Delete per-repo override cases.

### Green

- `packages/generators/src/config/spendPolicy.ts`: `SpendPolicy` becomes `{ maxGenerationsPerDay: number | null }`; schema `z.strictObject({ maxGenerationsPerDay: capSchema.optional() })`; delete `REPO_SLUG`, the collision loop, `capForRepo`; export `capForInstance(policy): number | null` or read the field directly (author's call, say why in the PR). Update `packages/generators/src/index.ts` exports.
- `packages/persistence/src/stores/generation.ts`: `countStartedRuns(executor, {from, to})` drops the `pull_request` join and the `repo_id` predicate; interface method renamed `countStartedRuns`; `StartRunInput` loses `repoId`; the lock key becomes the constant `generation-cap` (`pg_advisory_xact_lock(hashtext('generation-cap'))`). Doc comment: serializes starts per instance across every slot and process; starvation across repos accepted.
- Migration `0037_generation-cap-instance-index.sql`: `CREATE INDEX "generation_created_at_idx" ON "generation" USING btree ("created_at")` plus the drizzle snapshot (`pnpm -C packages/persistence` drizzle generate, then check the SQL by hand). Keep 0035's indexes; `pull_request_repo_idx` is harmless. Schema: add the index in `packages/persistence/src/schema/generation.ts` beside the 0035 one, with the one-line constraint comment moved to the new index.
- `apps/worker/src/task/generate/logic/spend-gate.ts`: `cap = deps.spend?.maxGenerationsPerDay ?? null`; drop `repoId` from `startInput`; `spend.cap.trip` keeps `repo`, `cap`, `dayUtc`. `SpendGateInputs` may lose `repoSlug` if nothing else reads it (check `recordCappedRun`: it logs it, so keep).
- `apps/worker/src/task/entry-comment.ts:43`: comment says "the instance hit its daily generation cap".
- `mergebrief.config.example.yaml` spend block: one key, comment "per UTC calendar day, resets 00:00 UTC, counted across every repo this instance serves".
- Docs: `docs/self-host/generators.md` "Daily generation cap" (per instance, starvation sentence, resets paragraph kept); `docs/self-host/observability.md:47` alert text ("the instance stuck at it"); `apps/worker/AGENTS.md:28-30` (cap sentence); `packages/persistence/AGENTS.md` if it names the per-repo lock (grep `generation-cap`); `docs/api-changelog.md` gets a line for the yaml key rename.
- `pnpm -C apps/cli docs:check` if the cli embeds any of these docs (run it; judge by exit code).

### Not in PR 1

No rolling window. No `.mergebrief/` change. No i18n change: the capped copy "Daily generation cap reached" already fits.

## PR 2: worker count dial and slot sizing docs

Decided 2, 6, 7, 9 on the ticket.

- `docker-compose.yml` and `docker-compose.external-db.yml` worker service: `deploy: { replicas: ${WORKER_COUNT:-1} }`; rewrite the `WORKER_CONCURRENCY` comment (cost depends on provider class); note that `--scale worker=N` overrides for that run. The service has no `container_name` and no ports, so scaling needs nothing else; confirm with `docker compose config` on both files.
- `.env.example`: a "Worker capacity" block with `WORKER_CONCURRENCY` and `WORKER_COUNT`, both commented, the product sentence, and the pointer to generators.md.
- `docs/self-host/compose.md`: env table rows for both dials; new "Who owns which setting" table: setting, owner file, precedence. Rule sentence: capacity and secrets are env, policy and provider are yaml, nothing lives in both. Rows: slots per worker, worker count, `maxGenerationsPerDay`, provider/model/effort, credentials/DSN/origin, `MERGEBRIEF_CONFIG` path itself.
- `docs/self-host/generators.md` "Worker slots": replace the unfilled sentence with the sizing rule per provider class: API providers hold one in-process stream per slot; CLI providers hold one child per slot, `N x child RSS + worker baseline` must fit the host; the child RSS numbers come from Idan's measurement (the numbers will not be in hand: write the rule with a clearly marked placeholder per provider, say so in the PR body, and keep going).
- `docs/self-host/operations.md`: one paragraph "Running more than one worker": row locking makes claims safe; `sweep-audit` runs once per tick because graphile keys crontab jobs (confirm against graphile-worker's cron docs in `node_modules/graphile-worker` before writing the sentence; if the claim does not hold, write the paragraph without it, say so in the PR body, and keep going).
- `apps/worker/src/config.ts` and `runner.ts` comments: keep "one slot is the bounded default"; the memory sentence no longer claims a child for every slot.
- CONTEXT.md: no new term. `WORKER_COUNT` is compose vocabulary, not domain vocabulary.

Verification line for the PR body: `docker compose config` clean on both files; `WORKER_COUNT=2 docker compose up -d` shows two worker containers in `docker compose ps`.

## Before merge (Idan runs; the agent prepares the commands and never spends)

1. Peak RSS per CLI child, one line per provider, into generators.md:
   `/usr/bin/time -l claude -p "say ok" --output-format json 2>&1 | grep "maximum resident"` (macOS reports bytes), same for `codex` and `cursor-agent` with the lockdown flags from `packages/generators/src/adapters/*.ts`.
2. Two concurrent `claude -p` children from one login: run the line above twice with `&` and `wait`; both exit 0 with a JSON result and no keychain or lock error on stderr.
3. Real-Postgres cap suite at three slots: `DATABASE_URL=<local docker DSN> pnpm -C packages/persistence vitest run test/generation-cap-postgres.test.ts` on the PR 1 branch; migration 0037 applied by `ensureAppSchema`.
4. Compose scale: `WORKER_COUNT=2 docker compose up -d`, push two PRs, `docker compose logs worker | grep generation.start` shows both containers starting a run; the jobs table shows one `sweep-audit` job per schedule tick.
5. Eval selection: none; no generation surface moves.

## Sequence

1. git-eng: worktree or branch off `main`, `feature/BRIEF-269/1-instance-cap`.
2. PR 1 red tests, green, docs, gates, pre-commit reviews per commit, push, PR ready for review.
3. `feature/BRIEF-269/2-worker-count` off PR 1. Same loop.
4. Reviewer subagents on both PRs, fix upstream first, gates bottom-up. Two rounds max, applied without asking.
5. Arm `watch-pr-stack`, then end with one report: PR links, what surprised, the Before-merge list with its commands, and anything left open.
6. On merge: ticket to Done is Idan's; update the memory file `brief-269-worker-slots-grilled-2026-09.md`.
