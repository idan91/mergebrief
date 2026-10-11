// The page's stacks as GitHub has them now: one open-PR list per repository
// on the page, read with the viewer's token and held per session, under a
// wall-clock budget so Home never waits on a slow repository: what has
// answered by the deadline places its rows, the rest fall back to the row
// (a closed row's record, nothing for an open one), and the late lists
// still land in the cache for the next load.
import { resolvePrStack, type OpenPullRequest } from "brief-core/pr-stack";
import type { InboxStackView } from "contract";
import type { GitHubApiError, RepositoryRef } from "github";
import type { Logger } from "logging";
import type { InboxRow, PullRequestRowId, RepoId } from "persistence";
import { isGitHubDenial } from "../../../shared-errors/failures";
import type {
  GitHubCallFailed,
  GitHubCallOutcome,
  GitHubCallTokenUnreadable,
} from "../../auth/reviewer-github-client";
import { runInPool } from "../../batches";
import { buildOpenPullsCacheKey } from "../../open-pulls-cache";
import { parseOwnerAndName } from "../../repos/utils";
import type { TtlCache } from "../../ttl-cache";
import {
  INBOX_LIVE_BUDGET_MS,
  INBOX_OPEN_PULLS_CACHE_TTL_MS,
  INBOX_STACKS_CONCURRENCY,
} from "../consts";

export interface LiveStacksDeps {
  /** One repository's open list under the viewer's token. */
  readonly listOpenPulls: (
    target: RepositoryRef,
  ) => Promise<GitHubCallOutcome<readonly OpenPullRequest[], GitHubApiError>>;
  readonly openPullsCache: TtlCache<readonly OpenPullRequest[]>;
  readonly log: Logger;
}

export interface LiveStacksInput {
  readonly sessionTokenHash: string;
  readonly rows: readonly InboxRow[];
  /** GitHub-verified `owner/name` per repository an installation reaches. */
  readonly repoNames: ReadonlyMap<RepoId, { readonly fullName: string }>;
  readonly budgetMs?: number;
}

export type LiveStacks = ReadonlyMap<PullRequestRowId, InboxStackView | null>;

interface RepoGroup {
  readonly repoId: RepoId;
  readonly rows: InboxRow[];
}

function groupByRepo(rows: readonly InboxRow[]): RepoGroup[] {
  const groups = new Map<RepoId, RepoGroup>();
  for (const row of rows) {
    const { repoId } = row.pullRequest;
    const known = groups.get(repoId);
    if (known !== undefined) {
      known.rows.push(row);
      continue;
    }
    groups.set(repoId, { repoId, rows: [row] });
  }
  return [...groups.values()];
}

/**
 * The repository's current name: the installation walk's for a row an
 * installation reaches, else a reachable url row's own label, which its
 * last live read recorded after matching the id. An unreachable row's
 * label is the one the id check refused, so it lends nothing.
 */
function resolveRepoName(
  input: LiveStacksInput,
  group: RepoGroup,
): string | undefined {
  const known = input.repoNames.get(group.repoId);
  if (known !== undefined) {
    return known.fullName;
  }
  const urlRow = group.rows.find(
    (row) =>
      row.pullRequest.installationId === null &&
      row.pullRequest.githubUnreachableAt === null,
  );
  return urlRow?.pullRequest.repoSlug ?? undefined;
}

type ListOutcome =
  | { readonly open: readonly OpenPullRequest[] }
  | { readonly refused: true; readonly tokenDead: boolean };

const NO_LIST: ListOutcome = { refused: true, tokenDead: false };

/** A denial is the viewer's standing for the cache window; anything else may pass. */
function recordRefusal(
  deps: LiveStacksDeps,
  cacheKey: string,
  repoId: RepoId,
  failure: GitHubCallFailed<GitHubApiError> | GitHubCallTokenUnreadable,
): ListOutcome {
  const fields = { repoId: String(repoId) };
  if (failure.tokenUnreadable) {
    deps.log.warn("viewer token unreadable, no live stack for any row", {
      ...fields,
      code: failure.error.kind,
    });
    return { refused: true, tokenDead: true };
  }
  const error = failure.error;
  if (isGitHubDenial(error)) {
    const cachedAt = Date.now();
    deps.openPullsCache.set(
      cacheKey,
      [],
      cachedAt + INBOX_OPEN_PULLS_CACHE_TTL_MS,
      cachedAt,
    );
    deps.log.debug(
      "open list denied to the viewer, no live stacks for the repo",
      {
        ...fields,
        code: error.code,
      },
    );
    return NO_LIST;
  }
  deps.log.warn("open list failed, no live stacks for the repo", {
    ...fields,
    code: error.code,
  });
  return NO_LIST;
}

async function readOpenList(
  deps: LiveStacksDeps,
  input: LiveStacksInput,
  group: RepoGroup,
): Promise<ListOutcome> {
  const cacheKey = buildOpenPullsCacheKey({
    sessionTokenHash: input.sessionTokenHash,
    repoId: group.repoId,
  });
  const now = Date.now();
  const cached = deps.openPullsCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { open: cached };
  }

  const name = resolveRepoName(input, group);
  const target = name === undefined ? undefined : parseOwnerAndName(name);
  if (target === undefined) {
    return NO_LIST;
  }
  const listed = await deps.listOpenPulls(target);
  if (!listed.ok) {
    return recordRefusal(deps, cacheKey, group.repoId, listed);
  }
  // Stamped when the list lands, not when it was asked for: a list that
  // outlives the budget must still serve the next load.
  const cachedAt = Date.now();
  deps.openPullsCache.set(
    cacheKey,
    listed.value,
    cachedAt + INBOX_OPEN_PULLS_CACHE_TTL_MS,
    cachedAt,
  );
  return { open: listed.value };
}

/** A linear chain has a position; a fork or a lone pull request has none. */
function shapeLiveStack(
  self: OpenPullRequest,
  open: readonly OpenPullRequest[],
): InboxStackView | null {
  const stack = resolvePrStack(self, open);
  if (stack === undefined || !("members" in stack)) {
    return null;
  }
  return { index: stack.index, size: stack.members.length };
}

function placeRows(
  stacks: Map<PullRequestRowId, InboxStackView | null>,
  group: RepoGroup,
  open: readonly OpenPullRequest[],
): void {
  for (const row of group.rows) {
    const self = open.find((item) => item.number === row.pullRequest.prNumber);
    if (self === undefined) {
      continue;
    }
    stacks.set(row.pullRequest.id, shapeLiveStack(self, open));
  }
}

interface Deadline {
  readonly passed: Promise<void>;
  readonly cancel: () => void;
}

function startDeadline(ms: number): Deadline {
  let timer: NodeJS.Timeout | undefined;
  const passed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { passed, cancel: () => clearTimeout(timer) };
}

/**
 * The live stack of every page row GitHub lists as open by the deadline; a
 * row the list does not hold, whose repository refused the list, or whose
 * list is still on its way gets no entry and falls back to the row. A
 * token that cannot be read fails every list alike, so the first such
 * refusal halts the rest.
 */
export async function readLiveStacks(
  deps: LiveStacksDeps,
  input: LiveStacksInput,
): Promise<LiveStacks> {
  const stacks = new Map<PullRequestRowId, InboxStackView | null>();
  const groups = groupByRepo(input.rows);
  const budgetMs = input.budgetMs ?? INBOX_LIVE_BUDGET_MS;
  let settled = false;
  let halted = false;

  const placing = runInPool(groups, INBOX_STACKS_CONCURRENCY, async (group) => {
    if (halted) {
      return;
    }
    try {
      const outcome = await readOpenList(deps, input, group);
      if ("refused" in outcome) {
        if (outcome.tokenDead) {
          halted = true;
        }
        return;
      }
      if (settled) {
        return;
      }
      placeRows(stacks, group, outcome.open);
    } catch (error) {
      deps.log.warn("open list read threw, no live stacks for the repo", {
        repoId: String(group.repoId),
        err: error,
      });
    }
  }).then(() => "placed" as const);
  const deadline = startDeadline(budgetMs);
  const outcome = await Promise.race([placing, deadline.passed]);
  settled = true;
  deadline.cancel();
  if (outcome !== "placed") {
    deps.log.debug(
      "live stacks past their budget, late rows fall back to the row",
      {
        repos: groups.length,
      },
    );
  }

  return stacks;
}
