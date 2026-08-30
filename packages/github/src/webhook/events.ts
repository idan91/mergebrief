// Webhook event parsing: an already-JSON-parsed body plus its `x-github-event`
// name into a typed, discriminated `ParsedWebhookEvent`. A PARSING primitive
// only — it never decides generation-vs-purge or writes tenant state.
//
// Only the fields we read are wrapped in Zod, so a malformed delivery is an
// expected `Result` error rather than a throw.
import { z } from "zod";
import type { WebhookEventName } from "@octokit/webhooks/types";
import type { InstallationId, RepoId, ReviewerId } from "persistence";
import {
  installationIdSchema,
  positiveBigIntSchema,
  repoIdSchema,
  reviewerIdSchema,
} from "../ids";
import type { Result, ValueOf } from "../types";

// ---------------------------------------------------------------------------
// Closed vocabularies (kebab-case values; SHOUT_CASE keys).
// ---------------------------------------------------------------------------

export const ParsedWebhookEventKinds = {
  PULL_REQUEST: "pull-request",
  PULL_REQUEST_REVIEW: "pull-request-review",
  INSTALLATION: "installation",
  INSTALLATION_REPOSITORIES: "installation-repositories",
  IGNORED: "ignored",
} as const;
export type ParsedWebhookEventKind = ValueOf<typeof ParsedWebhookEventKinds>;

export const PullRequestActions = {
  OPENED: "opened",
  SYNCHRONIZE: "synchronize",
  REOPENED: "reopened",
  READY_FOR_REVIEW: "ready-for-review",
  CONVERTED_TO_DRAFT: "converted-to-draft",
  CLOSED: "closed",
  REVIEW_REQUESTED: "review-requested",
} as const;
export type PullRequestAction = ValueOf<typeof PullRequestActions>;

export const InstallationActions = {
  CREATED: "created",
  DELETED: "deleted",
} as const;
export type InstallationAction = ValueOf<typeof InstallationActions>;

export const InstallationRepositoriesActions = {
  ADDED: "added",
  REMOVED: "removed",
} as const;
export type InstallationRepositoriesAction = ValueOf<
  typeof InstallationRepositoriesActions
>;

// GitHub's raw `action` string → our normalized action. Any raw action absent
// from a map is an unhandled action for that event → `ignored`.
const RAW_PULL_REQUEST_ACTION: Readonly<Record<string, PullRequestAction>> = {
  opened: PullRequestActions.OPENED,
  synchronize: PullRequestActions.SYNCHRONIZE,
  reopened: PullRequestActions.REOPENED,
  ready_for_review: PullRequestActions.READY_FOR_REVIEW,
  converted_to_draft: PullRequestActions.CONVERTED_TO_DRAFT,
  closed: PullRequestActions.CLOSED,
  review_requested: PullRequestActions.REVIEW_REQUESTED,
};
const RAW_INSTALLATION_ACTION: Readonly<Record<string, InstallationAction>> = {
  created: InstallationActions.CREATED,
  deleted: InstallationActions.DELETED,
};
const RAW_INSTALLATION_REPOSITORIES_ACTION: Readonly<
  Record<string, InstallationRepositoriesAction>
> = {
  added: InstallationRepositoriesActions.ADDED,
  removed: InstallationRepositoriesActions.REMOVED,
};

// The `x-github-event` names this parser understands. Typed against
// `@octokit/webhooks`'s `WebhookEventName` so a typo can't slip in.
const HANDLED_EVENT_NAMES = {
  PULL_REQUEST: "pull_request",
  PULL_REQUEST_REVIEW: "pull_request_review",
  INSTALLATION: "installation",
  INSTALLATION_REPOSITORIES: "installation_repositories",
} as const satisfies Record<string, WebhookEventName>;

// ---------------------------------------------------------------------------
// Parsed event shapes — a discriminated union keyed by `kind`.
// ---------------------------------------------------------------------------

export interface ParsedPullRequestEvent {
  readonly kind: typeof ParsedWebhookEventKinds.PULL_REQUEST;
  readonly action: PullRequestAction;
  readonly installationId: InstallationId;
  readonly repoId: RepoId;
  readonly repoFullName: string;
  readonly prNumber: number;
  /** The PR title — a purgeable display label, refreshed on every event. */
  readonly title: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly draft: boolean;
  /**
   * Absent when GitHub omits the author (a deleted account sends
   * `pull_request.user: null`); an omitted value preserves the stored one
   * instead of nulling it.
   */
  readonly authorLogin?: string;
  /** Present on `synchronize` — the pre-push head, for force-push detection. */
  readonly before?: string;
  /** Present on `synchronize` — the post-push head. */
  readonly after?: string;
  /** Present on `closed` — whether the PR was merged vs. just closed. */
  readonly merged?: boolean;
}

export interface ParsedPullRequestReviewEvent {
  readonly kind: typeof ParsedWebhookEventKinds.PULL_REQUEST_REVIEW;
  readonly installationId: InstallationId;
  readonly repoId: RepoId;
  readonly repoFullName: string;
  readonly prNumber: number;
  /** The PR title — a purgeable display label, refreshed on every event. */
  readonly title: string;
  readonly headSha: string;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string;
  /** GitHub account type, e.g. `User` / `Bot` — the checkpoint bot filter key. */
  readonly reviewerType: string;
  /** GitHub review state, e.g. `approved` / `changes_requested` / `commented`. */
  readonly reviewState: string;
  /** The SHA the review was submitted against — the checkpoint SHA. */
  readonly commitId: string;
  /** GitHub's `review.submitted_at` — drives newest-submission-wins upserts. */
  readonly submittedAt: Date;
}

export interface ParsedInstallationEvent {
  readonly kind: typeof ParsedWebhookEventKinds.INSTALLATION;
  readonly action: InstallationAction;
  readonly installationId: InstallationId;
  /** Repos included in the install/uninstall payload, when present. */
  readonly repoIds?: readonly RepoId[];
  readonly senderId: bigint;
}

export interface ParsedInstallationRepositoriesEvent {
  readonly kind: typeof ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES;
  readonly action: InstallationRepositoriesAction;
  readonly installationId: InstallationId;
  readonly repoIdsAdded: readonly RepoId[];
  readonly repoIdsRemoved: readonly RepoId[];
}

export interface IgnoredWebhookEvent {
  readonly kind: typeof ParsedWebhookEventKinds.IGNORED;
  readonly eventName: string;
  /** The raw `action`, when the payload carried one. */
  readonly action?: string;
}

export type ParsedWebhookEvent =
  | ParsedPullRequestEvent
  | ParsedPullRequestReviewEvent
  | ParsedInstallationEvent
  | ParsedInstallationRepositoriesEvent
  | IgnoredWebhookEvent;

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export const EventParseErrorCodes = {
  INVALID_PAYLOAD: "invalid-payload",
  MISSING_EVENT_NAME: "missing-event-name",
} as const;
export type EventParseErrorCode = ValueOf<typeof EventParseErrorCodes>;

export interface EventParseError {
  readonly code: EventParseErrorCode;
  readonly message: string;
  /** `path: reason` per failing field. Never carries the offending values. */
  readonly issues?: readonly string[];
}

// ---------------------------------------------------------------------------
// Zod schemas — only the fields downstream reads.
// ---------------------------------------------------------------------------

const installationRefSchema = z.object({ id: installationIdSchema });
const repositoryRefSchema = z.object({
  id: repoIdSchema,
  full_name: z.string().min(1),
});
const shaRefSchema = z.object({ sha: z.string().min(1) });

const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
  installation: installationRefSchema,
  repository: repositoryRefSchema,
  pull_request: z.object({
    title: z.string(),
    head: shaRefSchema,
    base: shaRefSchema,
    draft: z.boolean(),
    merged: z.boolean().optional(),
    // The author. `null` for a deleted account; absent in trimmed payloads.
    user: z.object({ login: z.string().min(1) }).nullish(),
  }),
});

const pullRequestReviewEventSchema = z.object({
  installation: installationRefSchema,
  repository: repositoryRefSchema,
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    head: shaRefSchema,
  }),
  review: z.object({
    state: z.string().min(1),
    commit_id: z.string().min(1),
    submitted_at: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    user: z.object({
      id: reviewerIdSchema,
      login: z.string().min(1),
      type: z.string().min(1),
    }),
  }),
});

const installationEventSchema = z.object({
  installation: installationRefSchema,
  repositories: z.array(z.object({ id: repoIdSchema })).optional(),
  sender: z.object({ id: positiveBigIntSchema }),
});

const installationRepositoriesEventSchema = z.object({
  installation: installationRefSchema,
  repositories_added: z.array(z.object({ id: repoIdSchema })).default([]),
  repositories_removed: z.array(z.object({ id: repoIdSchema })).default([]),
});

// Minimal probe for the raw `action`, used to (a) classify before a full parse
// and (b) annotate `ignored` results. Missing/non-string `action` → undefined.
const actionProbeSchema = z.object({ action: z.string() });

function readAction(payload: unknown): string | undefined {
  const probe = actionProbeSchema.safeParse(payload);
  return probe.success ? probe.data.action : undefined;
}

function issuesFrom(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
}

function invalidPayload(
  eventName: string,
  error: z.ZodError,
): Result<never, EventParseError> {
  return {
    ok: false,
    error: {
      code: EventParseErrorCodes.INVALID_PAYLOAD,
      message: `malformed ${eventName} webhook payload`,
      issues: issuesFrom(error),
    },
  };
}

function ignored(
  eventName: string,
  action: string | undefined,
): ParsedWebhookEvent {
  return action === undefined
    ? { kind: ParsedWebhookEventKinds.IGNORED, eventName }
    : { kind: ParsedWebhookEventKinds.IGNORED, eventName, action };
}

// ---------------------------------------------------------------------------
// Per-event parsers.
// ---------------------------------------------------------------------------

function parsePullRequest(
  payload: unknown,
  action: PullRequestAction,
): Result<ParsedWebhookEvent, EventParseError> {
  const parsed = pullRequestEventSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload(HANDLED_EVENT_NAMES.PULL_REQUEST, parsed.error);
  }
  const data = parsed.data;
  const base: ParsedPullRequestEvent = {
    kind: ParsedWebhookEventKinds.PULL_REQUEST,
    action,
    installationId: data.installation.id,
    repoId: data.repository.id,
    repoFullName: data.repository.full_name,
    prNumber: data.number,
    title: data.pull_request.title,
    headSha: data.pull_request.head.sha,
    baseSha: data.pull_request.base.sha,
    draft: data.pull_request.draft,
    ...(data.pull_request.user == null
      ? {}
      : { authorLogin: data.pull_request.user.login }),
    ...(data.before === undefined ? {} : { before: data.before }),
    ...(data.after === undefined ? {} : { after: data.after }),
    ...(action === PullRequestActions.CLOSED &&
    data.pull_request.merged !== undefined
      ? { merged: data.pull_request.merged }
      : {}),
  };
  return { ok: true, value: base };
}

function parsePullRequestReview(
  payload: unknown,
): Result<ParsedWebhookEvent, EventParseError> {
  const parsed = pullRequestReviewEventSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload(
      HANDLED_EVENT_NAMES.PULL_REQUEST_REVIEW,
      parsed.error,
    );
  }
  const data = parsed.data;
  return {
    ok: true,
    value: {
      kind: ParsedWebhookEventKinds.PULL_REQUEST_REVIEW,
      installationId: data.installation.id,
      repoId: data.repository.id,
      repoFullName: data.repository.full_name,
      prNumber: data.pull_request.number,
      title: data.pull_request.title,
      headSha: data.pull_request.head.sha,
      reviewerId: data.review.user.id,
      reviewerLogin: data.review.user.login,
      reviewerType: data.review.user.type,
      reviewState: data.review.state,
      commitId: data.review.commit_id,
      submittedAt: data.review.submitted_at,
    },
  };
}

function parseInstallation(
  payload: unknown,
  action: InstallationAction,
): Result<ParsedWebhookEvent, EventParseError> {
  const parsed = installationEventSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload(HANDLED_EVENT_NAMES.INSTALLATION, parsed.error);
  }
  const data = parsed.data;
  const repoIds = data.repositories?.map((repo) => repo.id);
  return {
    ok: true,
    value: {
      kind: ParsedWebhookEventKinds.INSTALLATION,
      action,
      installationId: data.installation.id,
      senderId: data.sender.id,
      ...(repoIds === undefined ? {} : { repoIds }),
    },
  };
}

function parseInstallationRepositories(
  payload: unknown,
  action: InstallationRepositoriesAction,
): Result<ParsedWebhookEvent, EventParseError> {
  const parsed = installationRepositoriesEventSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload(
      HANDLED_EVENT_NAMES.INSTALLATION_REPOSITORIES,
      parsed.error,
    );
  }
  const data = parsed.data;
  return {
    ok: true,
    value: {
      kind: ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES,
      action,
      installationId: data.installation.id,
      repoIdsAdded: data.repositories_added.map((repo) => repo.id),
      repoIdsRemoved: data.repositories_removed.map((repo) => repo.id),
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export interface ParseWebhookEventInput {
  /** The `x-github-event` header value. */
  readonly eventName: string;
  /** The already-JSON-parsed webhook body. */
  readonly payload: unknown;
}

/**
 * Parse a webhook delivery. An event/action outside the handled set is a
 * normal, non-error `{ kind: "ignored" }` ok-value; only a malformed handled
 * payload or a missing event name is a `Result` error.
 */
export function parseWebhookEvent(
  input: ParseWebhookEventInput,
): Result<ParsedWebhookEvent, EventParseError> {
  const { eventName, payload } = input;

  if (eventName.trim() === "") {
    return {
      ok: false,
      error: {
        code: EventParseErrorCodes.MISSING_EVENT_NAME,
        message: "missing x-github-event header",
      },
    };
  }

  const rawAction = readAction(payload);

  switch (eventName) {
    case HANDLED_EVENT_NAMES.PULL_REQUEST: {
      const action =
        rawAction === undefined
          ? undefined
          : RAW_PULL_REQUEST_ACTION[rawAction];
      if (action === undefined) {
        return { ok: true, value: ignored(eventName, rawAction) };
      }
      return parsePullRequest(payload, action);
    }
    case HANDLED_EVENT_NAMES.PULL_REQUEST_REVIEW: {
      if (rawAction !== "submitted") {
        return { ok: true, value: ignored(eventName, rawAction) };
      }
      return parsePullRequestReview(payload);
    }
    case HANDLED_EVENT_NAMES.INSTALLATION: {
      const action =
        rawAction === undefined
          ? undefined
          : RAW_INSTALLATION_ACTION[rawAction];
      if (action === undefined) {
        return { ok: true, value: ignored(eventName, rawAction) };
      }
      return parseInstallation(payload, action);
    }
    case HANDLED_EVENT_NAMES.INSTALLATION_REPOSITORIES: {
      const action =
        rawAction === undefined
          ? undefined
          : RAW_INSTALLATION_REPOSITORIES_ACTION[rawAction];
      if (action === undefined) {
        return { ok: true, value: ignored(eventName, rawAction) };
      }
      return parseInstallationRepositories(payload, action);
    }
    default: {
      return { ok: true, value: ignored(eventName, rawAction) };
    }
  }
}
