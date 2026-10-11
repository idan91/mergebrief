import type { OperatorReads, ReviewerGitHub } from "github";
import type { Logger } from "logging";
import {
  createArtifactStore,
  type AppDatabase,
  type PullRequestRow,
  type ScopeContext,
} from "persistence";
import type {
  AuthRouteDeps,
  ViewerPrincipal,
} from "../routes/auth/session/types";
import { parseOwnerAndName } from "../routes/repos/utils";
import { collectKnownCommits, type KnownCommits } from "./known-commits";
import { resolveOperatorTokenFor } from "./operator-token";
import {
  createSessionCredential,
  type SessionCredential,
} from "./session-credential";
import {
  AccessFootings,
  type OperatorRepoAccess,
  type RepoAccess,
} from "./types";

/** One request's reviewer credential and the GitHub bound over it. */
export interface RequestGitHub {
  readonly credential: SessionCredential;
  readonly github: ReviewerGitHub;
}

/** The row an operator-footed pass was granted, in the scope it lives in. */
export interface OperatorRow {
  readonly row: PullRequestRow;
  readonly rowScope: ScopeContext;
}

/** Binding builds closures only: the token decrypts on the first call. */
export function bindRequestGitHub(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): RequestGitHub {
  const credential = createSessionCredential(deps, session, log);
  const github = deps.auth.bindReviewerGitHub(credential, { log });
  return { credential, github };
}

async function loadKnownCommits(
  handle: AppDatabase,
  { row, rowScope }: OperatorRow,
): Promise<KnownCommits> {
  const artifacts = createArtifactStore(handle, rowScope);
  const [briefs, deltas] = await Promise.all([
    artifacts.briefs.listForPullRequest(row.id),
    artifacts.deltas.listForPullRequest(row.id),
  ]);
  return collectKnownCommits(row, briefs, deltas);
}

type KnownCommitsLoader = () => Promise<KnownCommits>;

const NO_KNOWN_COMMITS: KnownCommits = new Set();

/** The commits load once, and only when a denied read at commits asks. */
function buildOperatorReads(
  deps: AuthRouteDeps,
  access: OperatorRepoAccess,
  loadKnown: KnownCommitsLoader,
): OperatorReads | undefined {
  const token = resolveOperatorTokenFor(deps, access.session.reviewerId);
  const repo = parseOwnerAndName(access.repoFullName);
  if (token === undefined || repo === undefined) {
    return undefined;
  }
  let known: Promise<KnownCommits> | undefined;
  return {
    token,
    repo,
    prNumber: access.prNumber,
    loadKnownCommits() {
      known ??= loadKnown();
      return known;
    },
  };
}

/** Both bindings share the one request credential, so a renewal stays single. */
function bindWithOperatorReads(
  deps: AuthRouteDeps,
  access: RepoAccess,
  log: Logger,
  loadKnown: KnownCommitsLoader,
): ReviewerGitHub {
  if (access.footing !== AccessFootings.OPERATOR) {
    return access.github;
  }
  const operatorReads = buildOperatorReads(deps, access, loadKnown);
  if (operatorReads === undefined) {
    return access.github;
  }
  return deps.auth.bindReviewerGitHub(access.credential, {
    log,
    operatorReads,
  });
}

/**
 * The PR's GitHub: the repo access's own binding, except behind an operator
 * pass, where a denied read inside the granted PR retries on the operator
 * token.
 */
export function bindPullRequestGitHub(
  deps: AuthRouteDeps,
  access: RepoAccess,
  granted: OperatorRow,
  log: Logger,
): ReviewerGitHub {
  return bindWithOperatorReads(deps, access, log, () =>
    loadKnownCommits(deps.handle, granted),
  );
}

/**
 * `bindPullRequestGitHub` for an operation that loads no row: the granted PR's
 * reads keep the operator rung, and with no row no commit is known, so a read
 * at commits never takes it.
 */
export function bindGrantedPullRequestGitHub(
  deps: AuthRouteDeps,
  access: RepoAccess,
  log: Logger,
): ReviewerGitHub {
  return bindWithOperatorReads(deps, access, log, async () => NO_KNOWN_COMMITS);
}
