import type { OpenPullRequest } from "brief-core/pr-stack";
import type { RepoReader } from "../client/types";
import { buildDiffIncompleteError } from "../errors";
import { countDiffFiles } from "../operations/pull-request/diff-completeness";
import type {
  CheckedCompareDiffRef,
  CompareDiffRef,
  PullRequestRef,
  RepositoryRef,
} from "../operations/pull-request/types";
import {
  foldNotFoundToAbsent,
  RepoFileKinds,
  type GetRepoFileInput,
  type RepoFileResult,
} from "../operations/repo-file";
import type { FakeRunner } from "./runners";
import type { FakeCompare } from "./types";
import {
  answerNotFound,
  answerOk,
  buildFailure,
  type FakeAnswer,
} from "./utils";
import {
  getCompareKey,
  getFileKey,
  type FakeWorld,
  type PullRequestState,
} from "./world";

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

function readMergeBase(
  world: FakeWorld,
  span: CompareDiffRef,
): FakeAnswer<string> {
  const key = getCompareKey(span.base, span.head);
  const compare = world.findRepo(span)?.compares.get(key);
  return answerOk(compare?.mergeBase ?? span.base);
}

/** The arranged diff, refused as the real check refuses a file count other than the expected one. */
function readCheckedCompareDiff(
  world: FakeWorld,
  span: CheckedCompareDiffRef,
): FakeAnswer<string> {
  const answer = readCompare(world, span, (compare) => compare.diff);
  const isFileCountWrong =
    answer.ok &&
    span.expectedFileCount !== undefined &&
    countDiffFiles(answer.value) !== span.expectedFileCount;
  if (isFileCountWrong) {
    return { ok: false, error: buildDiffIncompleteError("compare commits") };
  }
  return answer;
}

function readRepoFile(
  world: FakeWorld,
  input: GetRepoFileInput,
): FakeAnswer<RepoFileResult> {
  const key = getFileKey(input.path, input.ref);
  const repo = world.findRepo(input);
  const failure = repo?.fileFailures.get(key);
  if (failure !== undefined) {
    return { ok: false, error: buildFailure(failure, "read repo file") };
  }
  const file = repo?.files.get(key);
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
      draft: info.draft,
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
    fetchCheckedCompareDiff(span) {
      const input = { ...span, ...bound };
      return run({
        operation: "fetchCheckedCompareDiff",
        input,
        reach: { commits: [span.base, span.head] },
        answer: () => readCheckedCompareDiff(world, input),
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
    fetchMergeBase(span) {
      const input = { ...span, ...bound };
      return run({
        operation: "fetchMergeBase",
        input,
        reach: { commits: [span.base, span.head] },
        answer: () => readMergeBase(world, input),
      });
    },
    async fetchRepoFile(file) {
      const input = { ...file, ...bound };
      const result = await run({
        operation: "fetchRepoFile",
        input,
        reach: { commits: [file.ref] },
        answer: () => readRepoFile(world, input),
      });
      return foldNotFoundToAbsent(result);
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
