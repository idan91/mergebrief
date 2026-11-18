import type { AccountReader, ReviewerGitHub } from "../client/types";
import {
  LIVE_READ_PAGE_SIZE,
  getLiveReadKey,
  type LiveReadPage,
  type PullRequestFacts,
} from "../operations/live-read";
import type {
  PullRequestInfo,
  PullRequestRef,
} from "../operations/pull-request/types";
import type { FakeRunner } from "./runners";
import { FakeFactsHidings, type FakeCredential } from "./types";
import { answerNotFound, answerOk, type FakeAnswer } from "./utils";
import type { FakeWorld } from "./world";

function shapeFacts(info: PullRequestInfo): PullRequestFacts {
  return {
    repoId: info.repoId,
    repoFullName: info.repoFullName,
    state: info.state,
    merged: info.merged,
    draft: info.draft,
    title: info.title,
    closedAt: info.closedAt,
    updatedAt: info.updatedAt,
    headSha: info.headSha,
    authorLogin: info.authorLogin,
  };
}

/** What `credential` sees of `ref`: the facts, null, or no entry at all. */
function findVisibleFacts(
  world: FakeWorld,
  ref: PullRequestRef,
  credential: FakeCredential,
): PullRequestFacts | null | undefined {
  const hiding = world.findFactsHiding(ref, credential.kind);
  if (hiding === FakeFactsHidings.WITHHELD) {
    return undefined;
  }
  const info = world.findPullRequest(ref)?.info;
  if (hiding === FakeFactsHidings.NOT_SHOWN || info === undefined) {
    return null;
  }
  return shapeFacts(info);
}

function readFacts(
  world: FakeWorld,
  refs: readonly PullRequestRef[],
  credential: FakeCredential,
): FakeAnswer<LiveReadPage> {
  if (refs.length > LIVE_READ_PAGE_SIZE) {
    throw new Error(`live read takes at most ${LIVE_READ_PAGE_SIZE} refs`);
  }
  const page = new Map<string, PullRequestFacts | null>();
  for (const ref of refs) {
    const facts = findVisibleFacts(world, ref, credential);
    if (facts !== undefined) {
      page.set(getLiveReadKey(ref), facts);
    }
  }
  return answerOk(page);
}

function answerFound<Value>(
  value: Value | undefined,
  context: string,
): FakeAnswer<Value> {
  if (value === undefined) {
    return answerNotFound(context);
  }
  return answerOk(value);
}

export function buildAccountReader(
  world: FakeWorld,
  run: FakeRunner,
): AccountReader {
  return {
    fetchRepositoryById(repoId) {
      return run({
        operation: "fetchRepositoryById",
        input: { repoId },
        answer: () =>
          answerFound(world.findRepository(repoId), "fetch repository"),
      });
    },
    readPullRequestFacts(refs) {
      return run({
        operation: "readPullRequestFacts",
        input: refs,
        answer: (credential) => readFacts(world, refs, credential),
      });
    },
    fetchIssue(ref) {
      return run({
        operation: "fetchIssue",
        input: ref,
        answer: () => answerFound(world.findIssue(ref), "fetch issue"),
      });
    },
    fetchRepositoryVisibility(repo) {
      return run({
        operation: "fetchRepositoryVisibility",
        input: repo,
        answer: () => answerOk(world.findRepositoryVisibility(repo)),
      });
    },
  };
}

type ReviewerAccount = Pick<
  ReviewerGitHub,
  "listUserInstallations" | "listInstallationRepositories"
>;

export function buildReviewerAccount(
  world: FakeWorld,
  run: FakeRunner,
): ReviewerAccount {
  return {
    listUserInstallations() {
      return run({
        operation: "listUserInstallations",
        input: undefined,
        answer: () => answerOk(world.listInstallations()),
      });
    },
    listInstallationRepositories(installationId) {
      return run({
        operation: "listInstallationRepositories",
        input: { installationId },
        answer: () =>
          answerFound(
            world.findInstallation(installationId)?.repositories,
            "list installation repositories",
          ),
      });
    },
  };
}
