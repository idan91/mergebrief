import {
  isDenial,
  isWithinReach,
  selectOperatorFallback,
  type OperatorFallback,
} from "../client/operator-fallback";
import type { InstallationId } from "persistence";
import { createTokenState, runOnReviewerToken } from "../client/reviewer-token";
import type {
  GitHubCall,
  ReadReach,
  ReviewerBindingOptions,
  ReviewerCredential,
} from "../client/types";
import { isUnauthorized } from "../client/utils";
import { GitHubApiErrorCodes } from "../errors";
import type { RepositoryRef } from "../operations/pull-request/types";
import {
  CredentialKinds,
  FakeFailures,
  type CredentialKind,
  type FakeCredential,
  type FakeFailure,
  type FakeGitHubCall,
  type GitHubOperation,
} from "./types";
import { answerNotFound, buildFailure, type FakeAnswer } from "./utils";

export interface FakeRequest<Value> {
  readonly operation: GitHubOperation;
  readonly input: unknown;
  readonly answer: (credential: FakeCredential) => FakeAnswer<Value>;
  /** What a 404 folds to, as the real operation folds it. */
  readonly onNotFound?: () => Value;
  /** Present on a `RepoReader` read, the only kind the operator may answer. */
  readonly reach?: ReadReach;
}

export type FakeRunner = <Value>(
  request: FakeRequest<Value>,
) => GitHubCall<Value>;

export type FakeSend = <Value>(
  credential: FakeCredential,
  request: FakeRequest<Value>,
) => FakeAnswer<Value>;

/** What GitHub answers, before any binding rule; every call is recorded. */
export interface FakeExchange {
  readonly calls: FakeGitHubCall[];
  readonly send: FakeSend;
  failOn(
    operation: GitHubOperation,
    failure: FakeFailure,
    credential?: CredentialKind,
  ): void;
  rejectToken(token: string): void;
}

const ANY_CREDENTIAL = "any";

function getFailureKey(operation: GitHubOperation, scope: string): string {
  return `${operation}:${scope}`;
}

function foldNotFound<Value>(
  request: FakeRequest<Value>,
  answered: FakeAnswer<Value>,
): FakeAnswer<Value> {
  const isNotFound =
    !answered.ok && answered.error.code === GitHubApiErrorCodes.NOT_FOUND;
  if (!isNotFound || request.onNotFound === undefined) {
    return answered;
  }
  return { ok: true, value: request.onNotFound() };
}

export function createExchange(): FakeExchange {
  const calls: FakeGitHubCall[] = [];
  const failures = new Map<string, FakeFailure>();
  const rejectedTokens = new Set<string>();

  function selectFailure(
    operation: GitHubOperation,
    credential: FakeCredential,
  ): FakeFailure | undefined {
    const rejected =
      "token" in credential && rejectedTokens.has(credential.token);
    if (rejected) {
      return FakeFailures.UNAUTHORIZED;
    }
    const scoped = failures.get(getFailureKey(operation, credential.kind));
    return scoped ?? failures.get(getFailureKey(operation, ANY_CREDENTIAL));
  }

  const send: FakeSend = (credential, request) => {
    calls.push({
      operation: request.operation,
      credential,
      input: request.input,
    });
    const failure = selectFailure(request.operation, credential);
    if (failure !== undefined) {
      const error = buildFailure(failure, request.operation);
      return foldNotFound(request, { ok: false, error });
    }
    return foldNotFound(request, request.answer(credential));
  };

  return {
    calls,
    send,
    failOn(operation, failure, credential) {
      failures.set(
        getFailureKey(operation, credential ?? ANY_CREDENTIAL),
        failure,
      );
    },
    rejectToken(token) {
      rejectedTokens.add(token);
    },
  };
}

/** Installation and operator calls: one credential, no renewal, no fallback. */
export function createFixedRunner(
  send: FakeSend,
  credential: FakeCredential,
): FakeRunner {
  return async (request) => send(credential, request);
}

/**
 * A removed installation's token mint answers 404 inside the call, as
 * octokit's lazy mint does, so the call's own 404 handling applies.
 */
export function createInstallationRunner(
  send: FakeSend,
  installationId: InstallationId,
  isRemoved: (installationId: InstallationId) => boolean,
): FakeRunner {
  const credential: FakeCredential = {
    kind: CredentialKinds.INSTALLATION,
    installationId,
  };
  return async (request) => {
    if (!isRemoved(installationId)) {
      return send(credential, request);
    }
    return send(credential, {
      ...request,
      answer: () => answerNotFound(request.operation),
    });
  };
}

function buildReviewerCredential(token: string): FakeCredential {
  return { kind: CredentialKinds.REVIEWER, token };
}

async function runWithFallback<Value>(
  own: FakeRunner,
  send: FakeSend,
  fallback: OperatorFallback,
  request: FakeRequest<Value>,
): GitHubCall<Value> {
  const ownResult = await own(request);
  if (ownResult.ok || !isDenial(ownResult.error)) {
    return ownResult;
  }
  const inReach =
    request.reach !== undefined &&
    (await isWithinReach(fallback.reads, request.reach));
  if (!inReach) {
    return ownResult;
  }

  const operator = send(
    { kind: CredentialKinds.OPERATOR, token: fallback.reads.token },
    request,
  );
  if (!isUnauthorized(operator)) {
    return operator;
  }
  fallback.log.warn("operator token rejected by GitHub", {
    owner: fallback.reads.repo.owner,
    repo: fallback.reads.repo.repo,
  });
  return ownResult;
}

export interface ReviewerRunners {
  /** The reviewer's token only. */
  readonly own: FakeRunner;
  /** The reviewer's token, then the operator's on a denied read in reach. */
  forRepo(repo: RepositoryRef): FakeRunner;
}

export function createReviewerRunners(
  send: FakeSend,
  credential: ReviewerCredential,
  options: ReviewerBindingOptions,
): ReviewerRunners {
  const tokens = createTokenState(credential);
  const own: FakeRunner = (request) =>
    runOnReviewerToken(tokens, async (token) =>
      send(buildReviewerCredential(token), request),
    );

  return {
    own,
    forRepo(repo) {
      const fallback = selectOperatorFallback(
        options.operatorReads,
        repo,
        options.log,
      );
      if (fallback === undefined) {
        return own;
      }
      return (request) => runWithFallback(own, send, fallback, request);
    },
  };
}
