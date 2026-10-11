import type { OpenPullRequest } from "brief-core/pr-stack";
import type { RepoReader } from "../client/types";
import type {
  CompareDiffRef,
  PullRequestRef,
  RepositoryRef,
} from "../operations/pull-request/types";
import {
  RepoFileKinds,
  type GetRepoFileInput,
  type RepoFileResult,
} from "../operations/repo-file";
import type { FakeRunner } from "./runners";
import type { FakeCompare } from "./types";
import { answerNotFound, answerOk, type FakeAnswer } from "./utils";
import {
  getCompareKey,
  getFileKey,
  type FakeWorld,
  type PullRequestState,
} from "./world";

const ABSENT_FILE: RepoFileResult = { kind: RepoFileKinds.ABSENT };

export function readPullRequest<Value>(
  world: FakeWorld,
  ref: PullRequestRef,
  read: (pull: PullRequestState) => Value,
): FakeAnswer<Value> {
  const pull = world.findPullRequest(ref);
  if (pull === undefined) {
    return answerNotFound("read pull request");
  }
  return answerOk(read(pull));
}

function readCompare<Value>(
  world: FakeWorld,
  span: CompareDiffRef,
  read: (compare: FakeCompare) => Value | undefined,
): FakeAnswer<Value> {
  const key = getCompareKey(span.base, span.head);
  const compare = world.findRepo(span)?.compares.get(key);
  const value = compare === undefined ? undefined : read(compare);
  if (value === undefined) {
    return answerNotFound("compare commits");
  }
  return answerOk(value);
}

function readRepoFile(
  world: FakeWorld,
  input: GetRepoFileInput,
): FakeAnswer<RepoFileResult> {
  const key = getFileKey(input.path, input.ref);
  const file = world.findRepo(input)?.files.get(key);
  if (file === undefined) {
    return answerNotFound("read repo file");
  }
  const tooLarge =
    file.kind === RepoFileKinds.FILE && file.size > input.maxBytes;
  if (tooLarge) {
    return answerOk({
      kind: RepoFileKinds.TOO_LARGE,
      blobSha: file.blobSha,
      size: file.size,
    });
  }
  return answerOk(file);
}

/** Open pull requests in arrangement order; an absent head repo is the base. */
export function listOpenPullRequests(
  world: FakeWorld,
  repo: RepositoryRef,
): FakeAnswer<OpenPullRequest[]> {
  const state = world.findRepo(repo);
  if (state === undefined) {
    return answerNotFound("list open pull requests");
  }
  const open: OpenPullRequest[] = [];
  for (const [prNumber, { info }] of state.pullRequests) {
    if (info.state !== "open") {
      continue;
    }
    open.push({
      number: prNumber,
      title: info.title,
      headRef: info.headRef,
      baseRef: info.baseRef ?? "",
      headRepo: info.headRepo ?? { owner: repo.owner, repo: repo.repo },
      baseRepo: info.baseRepo ?? { owner: repo.owner, repo: repo.repo },
    });
  }
  return answerOk(open);
}

export function buildRepoReader(
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): RepoReader {
  const bound = { owner: repo.owner, repo: repo.repo };

  return {
    fetchPullRequest(prNumber) {
      const input = { ...bound, prNumber };
      return run({
        operation: "fetchPullRequest",
        input,
        reach: { prNumber },
        answer: () => readPullRequest(world, input, (pull) => pull.info),
      });
    },
    fetchPullRequestFiles(prNumber) {
      const input = { ...bound, prNumber };
      return run({
        operation: "fetchPullRequestFiles",
        input,
        reach: { prNumber },
        answer: () => readPullRequest(world, input, (pull) => [...pull.files]),
      });
    },
    fetchDiff(prNumber) {
      const input = { ...bound, prNumber };
      return run({
        operation: "fetchDiff",
        input,
        reach: { prNumber },
        answer: () => readPullRequest(world, input, (pull) => pull.diff),
      });
    },
    fetchCompareDiff(span) {
      const input = { ...span, ...bound };
      return run({
        operation: "fetchCompareDiff",
        input,
        reach: { commits: [span.base, span.head] },
        answer: () => readCompare(world, input, (compare) => compare.diff),
      });
    },
    fetchCompareFiles(span) {
      const input = { ...span, ...bound };
      return run({
        operation: "fetchCompareFiles",
        input,
        reach: { commits: [span.base, span.head] },
        answer: () => readCompare(world, input, (compare) => compare.files),
      });
    },
    fetchRepoFile(file) {
      const input = { ...file, ...bound };
      return run({
        operation: "fetchRepoFile",
        input,
        reach: { commits: [file.ref] },
        answer: () => readRepoFile(world, input),
        onNotFound: () => ABSENT_FILE,
      });
    },
    fetchPullRequestConversation(prNumber) {
      const input = { ...bound, prNumber };
      return run({
        operation: "fetchPullRequestConversation",
        input,
        reach: { prNumber },
        answer: () =>
          readPullRequest(world, input, (pull) => pull.conversation),
      });
    },
    fetchRenderedImageSources(prNumber) {
      const input = { ...bound, prNumber };
      return run({
        operation: "fetchRenderedImageSources",
        input,
        reach: { prNumber },
        answer: () =>
          readPullRequest(world, input, (pull) => pull.imageSources),
      });
    },
  };
}
