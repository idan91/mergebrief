// Parse only consumed webhook fields into Result; malformed deliveries are expected failures.
// This boundary never decides generation/purge policy or writes tenant state.
import { z } from "zod/v4";
import type { WebhookEventName } from "@octokit/webhooks/types";
import type { InstallationId, RepoId, ReviewerId } from "persistence";
import {
  installationIdSchema,
  positiveBigIntSchema,
  repoIdSchema,
  reviewerIdSchema,
} from "../ids";
import type { Mutable, Result, ValueOf } from "types/utils";
import {
  GitHubAccountTypes,
  RepositoryVisibilities,
  type GitHubAccountType,
} from "../types";
import {
  AuthorAssociations,
  GitHubAppAuthorizationActions,
  type AuthorAssociation,
  type GitHubAppAuthorizationAction,
} from "./types";

// ---------------------------------------------------------------------------
// Closed vocabularies (kebab-case values; SHOUT_CASE keys).
// ---------------------------------------------------------------------------

export const ParsedWebhookEventKinds = {
  PULL_REQUEST: "pull-request",
  PULL_REQUEST_REVIEW: "pull-request-review",
  INSTALLATION: "installation",
  INSTALLATION_REPOSITORIES: "installation-repositories",
  IGNORED: "ignored",
  GITHUB_APP_AUTHORIZATION: "github-app-authorization",
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
  REVIEW_REQUEST_REMOVED: "review-request-removed",
  EDITED: "edited",
  LABELED: "labeled",
  UNLABELED: "unlabeled",
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
  review_request_removed: PullRequestActions.REVIEW_REQUEST_REMOVED,
  edited: PullRequestActions.EDITED,
  labeled: PullRequestActions.LABELED,
  unlabeled: PullRequestActions.UNLABELED,
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
  GITHUB_APP_AUTHORIZATION: "github_app_authorization",
} as const satisfies Record<string, WebhookEventName>;

// ---------------------------------------------------------------------------
// Parsed event shapes, a discriminated union keyed by `kind`.
// ---------------------------------------------------------------------------

export interface ParsedPullRequestEvent {
  readonly kind: typeof ParsedWebhookEventKinds.PULL_REQUEST;
  readonly action: PullRequestAction;
  readonly installationId: InstallationId;
  readonly repoId: RepoId;
  /** The account holding the repository, which `allowed.accounts` matches. */
  readonly repoOwnerId?: bigint;
  readonly repoFullName: string;
  /**
   * Private and not internal, so only invited people see it. A missing or
   * malformed `private` or `visibility` reads not private.
   */
  readonly repoPrivate: boolean;
  readonly prNumber: number;
  /** The PR title, a purgeable display label, refreshed on every event. */
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
  /** The PR author's `author_association`; absent when GitHub omits it or sends a value we do not know. */
  readonly authorAssociation?: AuthorAssociation;
  /** The PR author's account is a `Bot`; false when the author is gone or untyped. */
  readonly authorIsBot: boolean;
  /** Present on `synchronize`, the pre-push head, for force-push detection. */
  readonly before?: string;
  /** Present on `synchronize`, the post-push head. */
  readonly after?: string;
  /** Present on `closed`, whether the PR was merged vs. just closed. */
  readonly merged?: boolean;
  /** GitHub's `pull_request.updated_at`; orders late deliveries at ingest. */
  readonly updatedAt?: Date;
  /** GitHub's `pull_request.created_at`, the Inbox's created sort key. */
  readonly createdAt?: Date;
  /** GitHub's `pull_request.closed_at`; null while open. */
  readonly closedAt?: Date;
  /** Present on `edited`: whether the edit retargeted the base branch. */
  readonly baseChanged?: boolean;
  /** Present on `edited`: whether the edit changed the title. */
  readonly titleChanged?: boolean;
}

export interface ParsedPullRequestReviewEvent {
  readonly kind: typeof ParsedWebhookEventKinds.PULL_REQUEST_REVIEW;
  readonly installationId: InstallationId;
  readonly repoId: RepoId;
  /** The account holding the repository, which `allowed.accounts` matches. */
  readonly repoOwnerId?: bigint;
  readonly repoFullName: string;
  /**
   * Private and not internal, so only invited people see it. A missing or
   * malformed `private` or `visibility` reads not private.
   */
  readonly repoPrivate: boolean;
  readonly prNumber: number;
  /** The PR title, a purgeable display label, refreshed on every event. */
  readonly title: string;
  readonly headSha: string;
  /** The PR author's login, not the reviewer's; absent for a gone or loginless author. */
  readonly authorLogin?: string;
  /** The PR author's `author_association`, not the reviewer's; absent when omitted or unknown. */
  readonly authorAssociation?: AuthorAssociation;
  /** The PR author's account is a `Bot`, not the reviewer's. */
  readonly authorIsBot: boolean;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string;
  /** The reviewer's GitHub account type, the checkpoint bot filter key; absent when GitHub sends a type we do not know. */
  readonly reviewerType?: GitHubAccountType;
  /** The reviewer's `review.author_association`; absent when GitHub omits it or sends a value we do not know. */
  readonly reviewerAssociation?: AuthorAssociation;
  /** GitHub review state, e.g. `approved` / `changes_requested` / `commented`. */
  readonly reviewState: string;
  /** The SHA the review was submitted against, the checkpoint SHA. */
  readonly commitId: string;
  /** GitHub's `review.submitted_at`, drives newest-submission-wins upserts. */
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

/** A user revoked their authorization of the App; it carries no installation. */
export interface ParsedGitHubAppAuthorizationEvent {
  readonly kind: typeof ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION;
  readonly action: GitHubAppAuthorizationAction;
  readonly userId: ReviewerId;
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
  | IgnoredWebhookEvent
  | ParsedGitHubAppAuthorizationEvent;

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
// Zod schemas, only the fields downstream reads.
// ---------------------------------------------------------------------------

const installationRefSchema = z.object({ id: installationIdSchema });
const repositoryRefSchema = z.object({
  id: repoIdSchema,
  full_name: z.string().min(1),
  owner: z.object({ id: z.number().int().positive() }).optional(),
});
const shaRefSchema = z.object({ sha: z.string().min(1) });
const githubTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const authorAssociationSchema = z
  .enum(AuthorAssociations)
  .optional()
  .catch(undefined);
const accountTypeSchema = z
  .enum(GitHubAccountTypes)
  .optional()
  .catch(undefined);

const visibleRepositorySchema = repositoryRefSchema.extend({
  private: z.boolean().catch(false),
  visibility: z.enum(RepositoryVisibilities).optional().catch(undefined),
});

const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
  changes: z
    .object({
      base: z.object({}).optional(),
      title: z.object({}).optional(),
    })
    .optional(),
  installation: installationRefSchema,
  repository: visibleRepositorySchema,
  pull_request: z.object({
    title: z.string(),
    head: shaRefSchema,
    base: shaRefSchema,
    draft: z.boolean(),
    merged: z.boolean().optional(),
    author_association: authorAssociationSchema,
    // The author. `null` for a deleted account; absent in trimmed payloads.
    user: z
      .object({ login: z.string().min(1), type: accountTypeSchema })
      .nullish(),
    updated_at: githubTimestampSchema.optional(),
    created_at: githubTimestampSchema.optional(),
    closed_at: githubTimestampSchema.nullish(),
  }),
});

const pullRequestReviewEventSchema = z.object({
  installation: installationRefSchema,
  repository: visibleRepositorySchema,
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    head: shaRefSchema,
    author_association: authorAssociationSchema,
    user: z
      .object({
        login: z.string().min(1).optional().catch(undefined),
        type: accountTypeSchema,
      })
      .nullish()
      .catch(undefined),
  }),
  review: z.object({
    state: z.string().min(1),
    commit_id: z.string().min(1),
    submitted_at: githubTimestampSchema,
    author_association: authorAssociationSchema,
    user: z.object({
      id: reviewerIdSchema,
      login: z.string().min(1),
      type: accountTypeSchema,
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

const githubAppAuthorizationEventSchema = z.object({
  sender: z.object({ id: reviewerIdSchema }),
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

function isPrivateRepository(
  repository: z.infer<typeof visibleRepositorySchema>,
): boolean {
  return (
    repository.private &&
    repository.visibility === RepositoryVisibilities.PRIVATE
  );
}

function isBotAccount(
  account: { readonly type?: GitHubAccountType | undefined } | null | undefined,
): boolean {
  return account?.type === GitHubAccountTypes.BOT;
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
  const event: Mutable<ParsedPullRequestEvent> = {
    kind: ParsedWebhookEventKinds.PULL_REQUEST,
    action,
    installationId: data.installation.id,
    repoId: data.repository.id,
    repoFullName: data.repository.full_name,
    repoPrivate: isPrivateRepository(data.repository),
    prNumber: data.number,
    title: data.pull_request.title,
    headSha: data.pull_request.head.sha,
    baseSha: data.pull_request.base.sha,
    draft: data.pull_request.draft,
    authorIsBot: isBotAccount(data.pull_request.user),
  };
  if (data.repository.owner !== undefined) {
    event.repoOwnerId = BigInt(data.repository.owner.id);
  }

  const author = data.pull_request.user;
  if (author !== null && author !== undefined) {
    event.authorLogin = author.login;
  }
  const authorAssociation = data.pull_request.author_association;
  if (authorAssociation !== undefined) {
    event.authorAssociation = authorAssociation;
  }
  if (data.before !== undefined) {
    event.before = data.before;
  }
  if (data.after !== undefined) {
    event.after = data.after;
  }
  const merged = data.pull_request.merged;
  if (action === PullRequestActions.CLOSED && merged !== undefined) {
    event.merged = merged;
  }
  const {
    updated_at: updatedAt,
    created_at: createdAt,
    closed_at: closedAt,
  } = data.pull_request;
  if (updatedAt !== undefined) {
    event.updatedAt = updatedAt;
  }
  if (createdAt !== undefined) {
    event.createdAt = createdAt;
  }
  if (closedAt !== undefined && closedAt !== null) {
    event.closedAt = closedAt;
  }
  if (action === PullRequestActions.EDITED) {
    event.baseChanged = data.changes?.base !== undefined;
    event.titleChanged = data.changes?.title !== undefined;
  }

  return { ok: true, value: event };
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
  const event: Mutable<ParsedPullRequestReviewEvent> = {
    kind: ParsedWebhookEventKinds.PULL_REQUEST_REVIEW,
    installationId: data.installation.id,
    repoId: data.repository.id,
    repoFullName: data.repository.full_name,
    repoPrivate: isPrivateRepository(data.repository),
    prNumber: data.pull_request.number,
    title: data.pull_request.title,
    headSha: data.pull_request.head.sha,
    authorIsBot: isBotAccount(data.pull_request.user),
    reviewerId: data.review.user.id,
    reviewerLogin: data.review.user.login,
    reviewState: data.review.state,
    commitId: data.review.commit_id,
    submittedAt: data.review.submitted_at,
  };
  if (data.repository.owner !== undefined) {
    event.repoOwnerId = BigInt(data.repository.owner.id);
  }

  const reviewerType = data.review.user.type;
  if (reviewerType !== undefined) {
    event.reviewerType = reviewerType;
  }
  const association = data.review.author_association;
  if (association !== undefined) {
    event.reviewerAssociation = association;
  }
  const authorAssociation = data.pull_request.author_association;
  if (authorAssociation !== undefined) {
    event.authorAssociation = authorAssociation;
  }
  const authorLogin = data.pull_request.user?.login;
  if (authorLogin !== undefined) {
    event.authorLogin = authorLogin;
  }

  return { ok: true, value: event };
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
  const event: Mutable<ParsedInstallationEvent> = {
    kind: ParsedWebhookEventKinds.INSTALLATION,
    action,
    installationId: data.installation.id,
    senderId: data.sender.id,
  };

  if (repoIds !== undefined) {
    event.repoIds = repoIds;
  }

  return { ok: true, value: event };
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

function parseGitHubAppAuthorization(
  payload: unknown,
): Result<ParsedWebhookEvent, EventParseError> {
  const parsed = githubAppAuthorizationEventSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidPayload(
      HANDLED_EVENT_NAMES.GITHUB_APP_AUTHORIZATION,
      parsed.error,
    );
  }
  return {
    ok: true,
    value: {
      kind: ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION,
      action: GitHubAppAuthorizationActions.REVOKED,
      userId: parsed.data.sender.id,
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
    case HANDLED_EVENT_NAMES.GITHUB_APP_AUTHORIZATION: {
      if (rawAction !== GitHubAppAuthorizationActions.REVOKED) {
        return { ok: true, value: ignored(eventName, rawAction) };
      }
      return parseGitHubAppAuthorization(payload);
    }
    default: {
      return { ok: true, value: ignored(eventName, rawAction) };
    }
  }
}
