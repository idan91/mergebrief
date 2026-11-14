import {
  buildContextQuery,
  fetchContextSnippets,
  GitHubTransports,
  listReadableTrackers,
  NotionTransports,
  resolveTrackerReads,
  type ContextFetch,
  type JiraTransport,
  type TrackerRootDeps,
} from "brief-core";
import {
  findIssuesRepo,
  resolveEffectiveTrackers,
  type RepoName,
  type TrackerConfig,
} from "generators/trackers";
import { createInstallationIssueApi } from "../../issue-api";
import type { ParsedGeneratePayload } from "../../payload";
import { acquireRepoConfig } from "../../repo-config";
import type { TicketContextInputs, TicketContextLoader } from "../types";

interface TransportBinding {
  readonly source: TicketContextInputs["source"];
  readonly locator: TicketContextInputs["locator"];
  readonly trackers: readonly TrackerConfig[];
  /** Runs on the viewer's grant, not the installation's. */
  readonly urlBox: boolean;
  readonly siblingRepos: boolean;
  readonly jira: JiraTransport | undefined;
}

/**
 * GitHub's reach for one job. A url-box job runs on the viewer's grant: it
 * stays inside the PR's repo and is offered no deployment credential, so
 * the repo's settings cannot borrow the operator's Notion integration or
 * Jira token. An installation job reads its repo and `issuesRepo`, every
 * repo the installation reaches only where the instance allows sibling repos,
 * and no issue from a repository less widely visible than the pull request's.
 */
function bindTrackerTransports(
  binding: TransportBinding,
): TrackerRootDeps["transports"] {
  const issues = createInstallationIssueApi(binding.source);
  const pullRequestRepo = binding.locator;
  if (binding.urlBox) {
    const onlyRepos = [pullRequestRepo];
    return {
      github: GitHubTransports.INSTALLATION.create(issues, {
        onlyRepos,
        pullRequestRepo,
      }),
    };
  }

  const notion = NotionTransports.HTTP.create();
  const { jira } = binding;
  if (binding.siblingRepos) {
    const github = GitHubTransports.INSTALLATION.create(issues, {
      pullRequestRepo,
    });
    return { github, notion, jira };
  }
  const onlyRepos: RepoName[] = [pullRequestRepo];
  const issuesRepo = findIssuesRepo(binding.trackers);
  if (issuesRepo !== undefined) {
    onlyRepos.push(issuesRepo);
  }
  const github = GitHubTransports.INSTALLATION.create(issues, {
    onlyRepos,
    pullRequestRepo,
  });
  return { github, notion, jira };
}

/**
 * The ticket context, fetched on first use and shared by every core: a rerun
 * that spends nothing fetches nothing. Fails open per provider and reports an
 * unreadable ticket rather than guessing.
 */
export function createTicketContextLoader(
  payload: ParsedGeneratePayload,
  inputs: TicketContextInputs,
): TicketContextLoader {
  const {
    deps,
    source,
    prInfo,
    locator,
    meta,
    repoConfig,
    coreMessageLog,
    log,
  } = inputs;

  const trackerRoot = deps.trackerRoot ?? { env: {}, contextSources: [] };
  let contextLoad: Promise<ContextFetch> | undefined;
  const loadContext = (): Promise<ContextFetch> => {
    contextLoad ??= fetchTicketContext();
    return contextLoad;
  };
  async function fetchTicketContext(): Promise<ContextFetch> {
    const config = repoConfig ?? (await acquireRepoConfig(source, log));
    const trackers = resolveEffectiveTrackers(
      config?.settings,
      trackerRoot.trackers ?? [],
    );
    const transports = bindTrackerTransports({
      source,
      locator,
      trackers,
      urlBox: payload.grantId !== undefined,
      siblingRepos: deps.siblingRepos === true,
      jira: deps.jiraTransport,
    });
    const reads = resolveTrackerReads(trackers, {
      ...trackerRoot,
      transports,
    });
    if (!reads.ok) {
      log.warn("generate: tracker read unavailable", {
        issues: reads.error.issues,
      });
    }
    const readable = reads.ok ? listReadableTrackers(reads.value) : [];

    const context = await fetchContextSnippets(
      buildContextQuery({
        title: meta.title,
        body: meta.body,
        branch: prInfo.headRef,
        repo: locator,
        trackers,
        readable,
        contextSources: trackerRoot.contextSources,
      }),
      deps.contextProviders,
      coreMessageLog,
      { reads: reads.ok ? reads.value : {} },
    );
    const { primaryTicket } = context;
    if (primaryTicket?.status === "unread") {
      const { reference, reason } = primaryTicket;
      log.warn("generate: primary ticket unread", {
        tracker: reference.tracker,
        reason,
        key: reference.key === "" ? reference.url : reference.key,
      });
    } else if (primaryTicket !== undefined) {
      log.debug("generate: primary ticket read", {
        tracker: primaryTicket.snippet.tracker,
        key: primaryTicket.snippet.key,
      });
    }
    return context;
  }

  return loadContext;
}
