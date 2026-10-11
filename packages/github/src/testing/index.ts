// Cross-package test double on the `github/testing` subpath: an in-memory
// GitHub behind the production binding signatures. Production never imports it.
export { makeFakeGitHub } from "./fake-github";
export { CredentialKinds, FakeFailures } from "./types";
export type {
  CredentialKind,
  FakeCompare,
  FakeCredential,
  FakeFailure,
  FakeFileRef,
  FakeGitHub,
  FakeGitHubCall,
  FakePullRequest,
  FakeReview,
  GitHubOperation,
} from "./types";
