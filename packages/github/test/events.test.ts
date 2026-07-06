// Parse every recorded fixture through `parseWebhookEvent` and assert the
// discriminated `kind`, normalized action, and extracted fields (ids branded
// to `bigint`, correct SHAs). Also: an unhandled action is a non-error
// `ignored` ok-value, and a malformed handled payload is a `Result` error
// (never a throw). Fixtures are read as raw files and JSON-parsed here, exactly
// as a receiver would hand the parser an already-parsed body.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EventParseErrorCode,
  InstallationAction,
  InstallationRepositoriesAction,
  parseWebhookEvent,
  ParsedWebhookEventKind,
  PullRequestAction,
  type EventParseError,
  type ParsedWebhookEvent,
} from "../src/events";
import type { Result } from "../src/types";

function jsonFixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function expectOk(
  result: Result<ParsedWebhookEvent, EventParseError>,
): ParsedWebhookEvent {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${result.error.message}`);
  }
  return result.value;
}

function expectErr(
  result: Result<ParsedWebhookEvent, EventParseError>,
): EventParseError {
  if (result.ok) {
    throw new Error(`expected error, got ok kind=${result.value.kind}`);
  }
  return result.error;
}

describe("parseWebhookEvent — pull_request", () => {
  const cases: ReadonlyArray<[string, PullRequestAction]> = [
    ["pull_request.opened.json", PullRequestAction.OPENED],
    ["pull_request.synchronize.json", PullRequestAction.SYNCHRONIZE],
    ["pull_request.reopened.json", PullRequestAction.REOPENED],
    ["pull_request.closed.json", PullRequestAction.CLOSED],
    ["pull_request.ready_for_review.json", PullRequestAction.READY_FOR_REVIEW],
    ["pull_request.review_requested.json", PullRequestAction.REVIEW_REQUESTED],
  ];

  for (const [fixture, action] of cases) {
    it(`parses ${fixture} → ${action}`, () => {
      const event = expectOk(
        parseWebhookEvent({
          eventName: "pull_request",
          payload: jsonFixture(fixture),
        }),
      );
      if (event.kind !== ParsedWebhookEventKind.PULL_REQUEST) {
        throw new Error(`expected pull-request kind, got ${event.kind}`);
      }
      expect(event.action).toBe(action);
      expect(event.repoId).toBe(186853002n);
      expect(event.repoFullName).toBe("Codertocat/Hello-World");
      expect(event.prNumber).toBe(2);
      expect(event.headSha).toBe(
        "ec26c3e57ca3a959ca5aad62de7213c562f8c821",
      );
      expect(event.baseSha).toBe(
        "f95f852bd8fca8fcc58a9a2d6c842781e32a215e",
      );
      expect(event.draft).toBe(false);
      expect(typeof event.installationId).toBe("bigint");
      // The title rides every handled pull_request payload — persisted as the
      // picker's display label (BRIEF-19 list endpoint).
      expect(event.title).toBe("Update the README with new information.");
    });
  }

  it("exposes before/after only on synchronize (force-push detection)", () => {
    const sync = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.synchronize.json"),
      }),
    );
    if (sync.kind !== ParsedWebhookEventKind.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(sync.before).toBe("f95f852bd8fca8fcc58a9a2d6c842781e32a215e");
    expect(sync.after).toBe("ec26c3e57ca3a959ca5aad62de7213c562f8c821");

    const opened = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.opened.json"),
      }),
    );
    if (opened.kind !== ParsedWebhookEventKind.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(opened.before).toBeUndefined();
    expect(opened.after).toBeUndefined();
  });

  it("exposes merged only on closed", () => {
    const closed = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.closed.json"),
      }),
    );
    if (closed.kind !== ParsedWebhookEventKind.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(closed.merged).toBe(false);

    const opened = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.opened.json"),
      }),
    );
    if (opened.kind !== ParsedWebhookEventKind.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(opened.merged).toBeUndefined();
  });

  it("ignores an unhandled pull_request action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: { action: "labeled", number: 2 },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKind.IGNORED);
    if (event.kind !== ParsedWebhookEventKind.IGNORED) return;
    expect(event.eventName).toBe("pull_request");
    expect(event.action).toBe("labeled");
  });

  it("errors (not throws) on a malformed handled payload", () => {
    // action is handled (opened) but the required installation id is missing.
    const error = expectErr(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: {
          action: "opened",
          number: 2,
          repository: { id: 1, full_name: "a/b" },
          pull_request: {
            head: { sha: "x" },
            base: { sha: "y" },
            draft: false,
          },
        },
      }),
    );
    expect(error.code).toBe(EventParseErrorCode.INVALID_PAYLOAD);
    expect(error.issues?.some((i) => i.startsWith("installation"))).toBe(true);
  });

  it("errors on a non-positive branded id", () => {
    const error = expectErr(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: {
          action: "opened",
          number: 2,
          installation: { id: 0 },
          repository: { id: 1, full_name: "a/b" },
          pull_request: {
            head: { sha: "x" },
            base: { sha: "y" },
            draft: false,
          },
        },
      }),
    );
    expect(error.code).toBe(EventParseErrorCode.INVALID_PAYLOAD);
  });

  it("errors on an id past the safe-integer range (rounded by JSON.parse)", () => {
    // 2^53 is the first integer JS can no longer represent exactly, so a raw id
    // this large is already lossy — the branded schema must reject it, not brand
    // a silently-rounded value.
    const error = expectErr(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: {
          action: "opened",
          number: 2,
          installation: { id: 9007199254740992 },
          repository: { id: 1, full_name: "a/b" },
          pull_request: {
            head: { sha: "x" },
            base: { sha: "y" },
            draft: false,
          },
        },
      }),
    );
    expect(error.code).toBe(EventParseErrorCode.INVALID_PAYLOAD);
    expect(error.issues?.some((i) => i.startsWith("installation"))).toBe(true);
  });
});

describe("parseWebhookEvent — pull_request_review", () => {
  it("parses a submitted review", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: jsonFixture("pull_request_review.submitted.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKind.PULL_REQUEST_REVIEW) {
      throw new Error(`expected pull-request-review, got ${event.kind}`);
    }
    expect(event.prNumber).toBe(2);
    expect(event.headSha).toBe("ec26c3e57ca3a959ca5aad62de7213c562f8c821");
    expect(event.reviewerId).toBe(21031067n);
    expect(event.reviewerLogin).toBe("Codertocat");
    expect(event.reviewState).toBe("commented");
    expect(typeof event.installationId).toBe("bigint");
  });

  it("ignores a non-submitted review action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: { action: "dismissed" },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKind.IGNORED);
  });
});

describe("parseWebhookEvent — installation", () => {
  it("parses installation.created with repo ids", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation",
        payload: jsonFixture("installation.created.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKind.INSTALLATION) {
      throw new Error(`expected installation, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationAction.CREATED);
    expect(event.installationId).toBe(957387n);
    expect(event.senderId).toBe(21031067n);
    expect(event.repoIds).toEqual([186853002n]);
  });

  it("parses installation.deleted", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation",
        payload: jsonFixture("installation.deleted.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKind.INSTALLATION) {
      throw new Error(`expected installation, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationAction.DELETED);
    expect(event.installationId).toBe(2n);
    expect(event.repoIds).toEqual([1296269n]);
  });

  it("ignores an unhandled installation action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation",
        payload: { action: "suspend", installation: { id: 1 } },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKind.IGNORED);
  });
});

describe("parseWebhookEvent — installation_repositories", () => {
  it("parses removed", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation_repositories",
        payload: jsonFixture("installation_repositories.removed.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKind.INSTALLATION_REPOSITORIES) {
      throw new Error(`expected installation-repositories, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationRepositoriesAction.REMOVED);
    expect(event.installationId).toBe(2n);
    expect(event.repoIdsRemoved).toEqual([1296269n]);
    expect(event.repoIdsAdded).toEqual([]);
  });

  it("parses added", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation_repositories",
        payload: jsonFixture("installation_repositories.added.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKind.INSTALLATION_REPOSITORIES) {
      throw new Error(`expected installation-repositories, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationRepositoriesAction.ADDED);
    expect(event.repoIdsAdded).toEqual([186853007n]);
    expect(event.repoIdsRemoved).toEqual([]);
  });
});

describe("parseWebhookEvent — envelope handling", () => {
  it("ignores an entirely unknown event name", () => {
    const event = expectOk(
      parseWebhookEvent({ eventName: "star", payload: { action: "created" } }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKind.IGNORED);
    if (event.kind !== ParsedWebhookEventKind.IGNORED) return;
    expect(event.eventName).toBe("star");
  });

  it("errors on a missing event name", () => {
    const error = expectErr(
      parseWebhookEvent({ eventName: "", payload: {} }),
    );
    expect(error.code).toBe(EventParseErrorCode.MISSING_EVENT_NAME);
  });
});
