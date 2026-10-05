import {
  buildContextQuery,
  createBuiltInContextProviders,
  fetchContextSnippets,
  GitHubTransports,
  listReadableTrackers,
  NotionTransports,
  resolveTrackerReads,
  type ContextFetch,
  type TrackerRootDeps,
} from "brief-core";
import { resolveEffectiveTrackers } from "generators/trackers";
import { createInstallationIssueApi } from "../../issue-api";
import type { ParsedGeneratePayload } from "../../payload";
import { acquireRepoConfig } from "../../repo-config";
import type { TicketContextInputs, TicketContextLoader } from "../types";

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
    // A url-box job runs on the viewer's grant: GitHub stays inside the
    // PR's repo and no deployment credential is offered, so the repo's
    // settings cannot borrow the operator's Notion integration.
    const transports: TrackerRootDeps["transports"] =
      payload.grantId === undefined
        ? {
            github: GitHubTransports.INSTALLATION.create(
              createInstallationIssueApi(source),
            ),
            notion: NotionTransports.HTTP.create(),
          }
        : {
            github: GitHubTransports.INSTALLATION.create(
              createInstallationIssueApi(source),
              { onlyRepo: locator },
            ),
          };
    const trackers = resolveEffectiveTrackers(
      config?.settings,
      trackerRoot.trackers ?? [],
    );
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
      }),
      deps.contextProviders ?? createBuiltInContextProviders(),
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
