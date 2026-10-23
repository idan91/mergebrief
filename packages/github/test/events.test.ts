// Parse every recorded fixture through `parseWebhookEvent` and assert the
// discriminated `kind`, normalized action, and extracted fields (ids branded
// to `bigint`, correct SHAs). Also: an unhandled action is a non-error
// `ignored` ok-value, and a malformed handled payload is a `Result` error
// (never a throw). Fixtures are read as raw files and JSON-parsed here, exactly
// as a receiver would hand the parser an already-parsed body.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EventParseErrorCodes,
  InstallationActions,
  InstallationRepositoriesActions,
  parseWebhookEvent,
  ParsedWebhookEventKinds,
  PullRequestActions,
  type EventParseError,
  type ParsedWebhookEvent,
  type PullRequestAction,
} from "../src/webhook/events";
import { GitHubAppAuthorizationActions } from "../src/webhook/types";
import type { Result } from "types/utils";

function jsonFixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The submitted-review fixture with its `review` object mutated in a copy. */
function reviewFixtureWith(
  patch: (review: Record<string, unknown>) => void,
): unknown {
  const fixture = jsonFixture("pull_request_review.submitted.json");
  if (!isRecord(fixture) || !isRecord(fixture["review"])) {
    throw new Error("fixture shape changed");
  }
  const review = { ...fixture["review"] };
  patch(review);
  return { ...fixture, review };
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

describe("parseWebhookEvent, pull_request", () => {
  const cases: ReadonlyArray<[string, PullRequestAction]> = [
    ["pull_request.opened.json", PullRequestActions.OPENED],
    ["pull_request.synchronize.json", PullRequestActions.SYNCHRONIZE],
    ["pull_request.reopened.json", PullRequestActions.REOPENED],
    ["pull_request.closed.json", PullRequestActions.CLOSED],
    ["pull_request.ready_for_review.json", PullRequestActions.READY_FOR_REVIEW],
    ["pull_request.review_requested.json", PullRequestActions.REVIEW_REQUESTED],
    ["pull_request.edited.json", PullRequestActions.EDITED],
  ];

  for (const [fixture, action] of cases) {
    it(`parses ${fixture} → ${action}`, () => {
      const event = expectOk(
        parseWebhookEvent({
          eventName: "pull_request",
          payload: jsonFixture(fixture),
        }),
      );
      if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
        throw new Error(`expected pull-request kind, got ${event.kind}`);
      }
      expect(event.action).toBe(action);
      expect(event.repoId).toBe(186853002n);
      expect(event.repoFullName).toBe("Codertocat/Hello-World");
      expect(event.prNumber).toBe(2);
      expect(event.headSha).toBe("ec26c3e57ca3a959ca5aad62de7213c562f8c821");
      expect(event.baseSha).toBe("f95f852bd8fca8fcc58a9a2d6c842781e32a215e");
      expect(event.draft).toBe(false);
      // The PR author login rides every handled pull_request payload -
      // persisted so `viewerIsAuthor` can be derived server-side.
      expect(event.authorLogin).toBe("Codertocat");
      expect(typeof event.installationId).toBe("bigint");
      // The title rides every handled pull_request payload, persisted as the
      // picker's display label.
      expect(event.title).toBe("Update the README with new information.");
    });
  }

  it("parses converted_to_draft as a draft", () => {
    // Without the ready→draft transition the row would stay draft=false
    // indefinitely on a quiet PR.
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.converted_to_draft.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error(`expected pull-request kind, got ${event.kind}`);
    }
    expect(event.action).toBe(PullRequestActions.CONVERTED_TO_DRAFT);
    expect(event.draft).toBe(true);
    expect(event.authorLogin).toBe("Codertocat");
  });

  it("exposes before and after only on synchronize", () => {
    const sync = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.synchronize.json"),
      }),
    );
    if (sync.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
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
    if (opened.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(opened.before).toBeUndefined();
    expect(opened.after).toBeUndefined();
  });

  it("marks an edit that moved the base and only that edit", () => {
    const moved = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.edited.json"),
      }),
    );
    if (moved.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(moved.baseChanged).toBe(true);

    const fixture = jsonFixture("pull_request.edited.json");
    if (!isRecord(fixture)) {
      throw new Error("fixture is not an object");
    }
    const titleOnly = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: { ...fixture, changes: { title: { from: "Old title" } } },
      }),
    );
    if (titleOnly.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(titleOnly.baseChanged).toBe(false);

    const opened = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.opened.json"),
      }),
    );
    if (opened.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(opened.baseChanged).toBeUndefined();
  });

  it("exposes merged only on closed", () => {
    const closed = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.closed.json"),
      }),
    );
    if (closed.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(closed.merged).toBe(false);

    const opened = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: jsonFixture("pull_request.opened.json"),
      }),
    );
    if (opened.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(opened.merged).toBeUndefined();
  });

  it("omits authorLogin when the PR author account is gone", () => {
    // GitHub sends `pull_request.user: null` for a deleted author; the parse
    // must not throw or 400, it omits authorLogin (preserve-stored pattern,
    // mirroring how review events omit base_sha).
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: {
          action: "opened",
          number: 2,
          installation: { id: 1 },
          repository: { id: 1, full_name: "a/b" },
          pull_request: {
            title: "t",
            head: { sha: "x" },
            base: { sha: "y" },
            draft: false,
            user: null,
          },
        },
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(event.authorLogin).toBeUndefined();
  });

  it("carries updated_at and closed_at when the payload sends them", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: {
          action: "closed",
          number: 2,
          installation: { id: 1 },
          repository: { id: 1, full_name: "a/b" },
          pull_request: {
            title: "t",
            head: { sha: "x" },
            base: { sha: "y" },
            draft: false,
            merged: false,
            user: null,
            updated_at: "2026-09-20T10:00:00Z",
            closed_at: "2026-09-20T09:59:00Z",
          },
        },
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
      throw new Error("expected pull-request");
    }
    expect(event.updatedAt?.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(event.closedAt?.toISOString()).toBe("2026-09-20T09:59:00.000Z");
  });

  it("ignores an unhandled pull_request action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request",
        payload: { action: "labeled", number: 2 },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKinds.IGNORED);
    if (event.kind !== ParsedWebhookEventKinds.IGNORED) {
      return;
    }
    expect(event.eventName).toBe("pull_request");
    expect(event.action).toBe("labeled");
  });

  it("returns an error on a malformed handled payload", () => {
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
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
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
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
  });

  it("errors on an id past the safe-integer range", () => {
    // 2^53 is the first integer JS can no longer represent exactly, so a raw id
    // this large is already lossy, the branded schema must reject it, not brand
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
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
    expect(error.issues?.some((i) => i.startsWith("installation"))).toBe(true);
  });
});

describe("parseWebhookEvent, pull_request_review", () => {
  it("parses a submitted review", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: jsonFixture("pull_request_review.submitted.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST_REVIEW) {
      throw new Error(`expected pull-request-review, got ${event.kind}`);
    }
    expect(event.prNumber).toBe(2);
    expect(event.headSha).toBe("ec26c3e57ca3a959ca5aad62de7213c562f8c821");
    expect(event.reviewerId).toBe(21031067n);
    expect(event.reviewerLogin).toBe("Codertocat");
    expect(event.reviewState).toBe("commented");
    expect(typeof event.installationId).toBe("bigint");
  });

  it("carries commit_id, reviewer type, and submitted_at", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: jsonFixture("pull_request_review.submitted.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST_REVIEW) {
      throw new Error(`expected pull-request-review, got ${event.kind}`);
    }
    expect(event.commitId).toBe("ec26c3e57ca3a959ca5aad62de7213c562f8c821");
    expect(event.reviewerType).toBe("User");
    expect(event.submittedAt).toEqual(new Date("2019-11-17T17:43:43Z"));
  });

  it("parses a Bot-authored review with reviewerType 'Bot'", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: jsonFixture("pull_request_review.submitted.bot.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST_REVIEW) {
      throw new Error(`expected pull-request-review, got ${event.kind}`);
    }
    expect(event.reviewerType).toBe("Bot");
    expect(event.reviewerLogin).toBe("dependabot[bot]");
  });

  it("errors on a submitted review missing commit_id", () => {
    const error = expectErr(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: reviewFixtureWith((review) => {
          delete review["commit_id"];
        }),
      }),
    );
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
    expect(error.issues?.some((i) => i.startsWith("review.commit_id"))).toBe(
      true,
    );
  });

  it("errors on a non-timestamp submitted_at", () => {
    const error = expectErr(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: reviewFixtureWith((review) => {
          review["submitted_at"] = "yesterday-ish";
        }),
      }),
    );
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
    expect(error.issues?.some((i) => i.startsWith("review.submitted_at"))).toBe(
      true,
    );
  });

  it("ignores a non-submitted review action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "pull_request_review",
        payload: { action: "dismissed" },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKinds.IGNORED);
  });
});

describe("parseWebhookEvent, installation", () => {
  it("parses installation.created with repo ids", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation",
        payload: jsonFixture("installation.created.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.INSTALLATION) {
      throw new Error(`expected installation, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationActions.CREATED);
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
    if (event.kind !== ParsedWebhookEventKinds.INSTALLATION) {
      throw new Error(`expected installation, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationActions.DELETED);
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
    expect(event.kind).toBe(ParsedWebhookEventKinds.IGNORED);
  });
});

describe("parseWebhookEvent, installation_repositories", () => {
  it("parses removed", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "installation_repositories",
        payload: jsonFixture("installation_repositories.removed.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES) {
      throw new Error(`expected installation-repositories, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationRepositoriesActions.REMOVED);
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
    if (event.kind !== ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES) {
      throw new Error(`expected installation-repositories, got ${event.kind}`);
    }
    expect(event.action).toBe(InstallationRepositoriesActions.ADDED);
    expect(event.repoIdsAdded).toEqual([186853007n]);
    expect(event.repoIdsRemoved).toEqual([]);
  });
});

describe("parseWebhookEvent, github_app_authorization", () => {
  it("parses revoked with the GitHub user who revoked", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "github_app_authorization",
        payload: jsonFixture("github_app_authorization.revoked.json"),
      }),
    );
    if (event.kind !== ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION) {
      throw new Error(`expected github-app-authorization, got ${event.kind}`);
    }
    expect(event.action).toBe(GitHubAppAuthorizationActions.REVOKED);
    expect(event.userId).toBe(1n);
  });

  it("ignores another github_app_authorization action", () => {
    const event = expectOk(
      parseWebhookEvent({
        eventName: "github_app_authorization",
        payload: { action: "granted", sender: { id: 1 } },
      }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKinds.IGNORED);
  });

  it("errors on a revoked payload without a sender id", () => {
    const error = expectErr(
      parseWebhookEvent({
        eventName: "github_app_authorization",
        payload: { action: "revoked", sender: { login: "octocat" } },
      }),
    );
    expect(error.code).toBe(EventParseErrorCodes.INVALID_PAYLOAD);
  });
});

describe("parseWebhookEvent, envelope handling", () => {
  it("ignores an entirely unknown event name", () => {
    const event = expectOk(
      parseWebhookEvent({ eventName: "star", payload: { action: "created" } }),
    );
    expect(event.kind).toBe(ParsedWebhookEventKinds.IGNORED);
    if (event.kind !== ParsedWebhookEventKinds.IGNORED) {
      return;
    }
    expect(event.eventName).toBe("star");
  });

  it("errors on a missing event name", () => {
    const error = expectErr(parseWebhookEvent({ eventName: "", payload: {} }));
    expect(error.code).toBe(EventParseErrorCodes.MISSING_EVENT_NAME);
  });
});
