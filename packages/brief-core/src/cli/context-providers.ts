import type { Result } from "types/utils";
import type { ConfigError, ContextSourcesConfig } from "generators";
import { createBuiltInContextProviders } from "../context/registry";
import { resolveTrackerReads, type TrackerReads } from "../context/trackers";
import type { TrackerRootDeps } from "../context/trackers/types";
import type { TrackerConfig } from "../context/tracker";
import type { ContextProvider, PrimarySnippet } from "../context/types";
import { GitHubTransports } from "../context/trackers/github";
import { NotionTransports } from "../context/trackers/notion";

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
    },
  };
}

/** The generic sources the CLIs run beside the tracker read: the URL chaser. */
export function createCliContextProviders(): ContextProvider[] {
  return createBuiltInContextProviders();
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
  if (supplied !== undefined) return { ok: true, value: undefined };
  return resolveTrackerReads(trackers, root);
}
