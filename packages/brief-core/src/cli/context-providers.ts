import { createBuiltInContextProviders } from "../context/registry";
import type { TrackerRootDeps } from "../context/trackers/types";
import type { ContextProvider } from "../context/types";
import { ghIssueReader } from "../github/issue";

/** What the CLIs offer a tracker's read: the env, and GitHub through the same `gh` login that fetches the PR. */
export function createCliRootDeps(
  env: Record<string, string | undefined>,
): TrackerRootDeps {
  return { env, github: { issueReader: ghIssueReader } };
}

/** The generic sources the CLIs run beside the tracker read: the URL chaser. */
export function createCliContextProviders(): ContextProvider[] {
  return createBuiltInContextProviders();
}
