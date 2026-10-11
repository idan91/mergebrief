// Cross-package test double on the `github/testing` subpath: an in-memory
// GitHub behind the production binding signatures. Production never imports it.
export { makeFakeGitHub } from "./fake-github";
export {
  stubOwnedOperatorToken,
  stubPendingOperatorToken,
} from "./operator-owner";
export { CredentialKinds, FakeFactsHidings, FakeFailures } from "./types";
export type {
  CredentialKind,
  FakeCompare,
  FakeCredential,
  FakeFactsHiding,
  FakeFailure,
  FakeFileRef,
  FakeGitHub,
  FakeGitHubCall,
  FakePullRequest,
  FakeReview,
  GitHubOperation,
} from "./types";
