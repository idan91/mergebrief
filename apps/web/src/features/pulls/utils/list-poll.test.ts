import { describe, expect, it } from "vitest";
import {
  GenerationStatuses,
  type GenerationStatus,
  type PrSummary,
  type PullsSession,
} from "../types";
import { getPullsRefetchInterval, shouldPollPulls } from "./list-poll";

function makeRow(status: GenerationStatus | null): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    baseSha: null,
    headSha: "head-1",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    behind: false,
    generation:
      status === null
        ? null
        : {
            status,
            phase: null,
            attempts: 0,
            errorCode: null,
            errorDetail: null,
            updatedAt: "2026-07-06T12:00:00.000Z",
          },
    updatedAt: "2026-07-06T12:00:00.000Z",
  };
}

function makeReadySession(
  statuses: readonly (GenerationStatus | null)[],
): PullsSession {
  return { kind: "ready", pulls: statuses.map(makeRow) };
}

describe("shouldPollPulls", () => {
  it("polls while any row is pending", () => {
    const session = makeReadySession([
      GenerationStatuses.SUCCEEDED,
      GenerationStatuses.PENDING,
    ]);

    expect(shouldPollPulls(session)).toBe(true);
  });

  it("polls while any row is running", () => {
    const session = makeReadySession([GenerationStatuses.RUNNING]);

    expect(shouldPollPulls(session)).toBe(true);
  });

  it("stops when every row is terminal or never generated", () => {
    const session = makeReadySession([
      GenerationStatuses.SUCCEEDED,
      GenerationStatuses.FAILED,
      GenerationStatuses.SUPERSEDED,
      GenerationStatuses.CAPPED,
      null,
    ]);

    expect(shouldPollPulls(session)).toBe(false);
  });

  it("stops on an empty list", () => {
    expect(shouldPollPulls(makeReadySession([]))).toBe(false);
  });

  it("stops for a logged-out session", () => {
    expect(shouldPollPulls({ kind: "logged-out" })).toBe(false);
  });

  it("keeps polling an unavailable list so it recovers unattended", () => {
    expect(shouldPollPulls({ kind: "unavailable" })).toBe(true);
  });
});

describe("getPullsRefetchInterval", () => {
  it("polls every 10 seconds while a row is in flight", () => {
    const session = makeReadySession([GenerationStatuses.RUNNING]);

    expect(getPullsRefetchInterval(session)).toBe(10_000);
  });

  it("slows to a minute while the list is unavailable", () => {
    expect(getPullsRefetchInterval({ kind: "unavailable" })).toBe(60_000);
  });

  it("is off for a settled list, a logged-out session and no data", () => {
    const settled = makeReadySession([GenerationStatuses.SUCCEEDED]);

    expect(getPullsRefetchInterval(settled)).toBe(false);
    expect(getPullsRefetchInterval({ kind: "logged-out" })).toBe(false);
    expect(getPullsRefetchInterval(undefined)).toBe(false);
  });
});
