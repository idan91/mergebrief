import type { Result } from "types/utils";
import type {
  ConfigError,
  ContextSourcesConfig,
  LinkFetchPolicy,
} from "generators";
import {
  createBuiltInContextProviders,
  GitHubTransports,
  JiraTransports,
  NotionTransports,
  resolveTrackerReads,
  type ContextProvider,
  type PrimarySnippet,
  type TrackerReads,
  type TrackerRootDeps,
} from "brief-core";
import type { TrackerConfig } from "generators/trackers";

/**
 * What the CLIs offer a tracker's read: the shared deps (env for tokens by
 * NAME, the instance config's `contextSources:` entries) and one transport
 * per tracker they serve. GitHub rides the same `gh` login that fetches the
 * PR.
 */
export function createCliRootDeps(
  env: Record<string, string | undefined>,
  contextSources: ContextSourcesConfig,
): TrackerRootDeps {
  return {
    env,
    contextSources,
    transports: {
      github: GitHubTransports.GH.create(),
      notion: NotionTransports.HTTP.create(),
      jira: JiraTransports.HTTP.create(),
    },
  };
}

/** The generic sources the CLIs run beside the tracker read: the URL chaser. */
export function createCliContextProviders(
  linkFetch: LinkFetchPolicy,
): ContextProvider[] {
  return createBuiltInContextProviders(linkFetch);
}

/**
 * The CLIs' reads, or none: `--context <file>` supplies the ticket, so no
 * tracker is built and no tracker credential is required. Otherwise one
 * read per tracker the root can read, refused when the repo's tracker
 * cannot build.
 */
export function resolveCliTrackerReads(
  supplied: PrimarySnippet | undefined,
  trackers: readonly TrackerConfig[],
  root: TrackerRootDeps,
): Result<TrackerReads | undefined, ConfigError> {
  if (supplied !== undefined) {
    return { ok: true, value: undefined };
  }
  return resolveTrackerReads(trackers, root);
}
