// Read-API PR shapes + boundary guards (BRIEF-19 PR 3.1). Mirrors the api
// package's `pr-view` response contract. Hand-rolled guards returning
// `Result`, matching the local-brief validation convention (no zod in this
// bundle); API responses are parsed at the boundary, never cast.
import type { Result as SharedResult, ValueOf } from "types";

type Result<T> = SharedResult<T, string>;

export const PrStates = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrStates>;

export const GenerationStatuses = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatuses>;

/** The poll-relevant slice of the generation projection (already sanitized). */
export interface GenerationSummary {
  readonly status: GenerationStatus;
  readonly phase: string | null;
  readonly attempts: number;
  readonly error: string | null;
  readonly updatedAt: string;
}

/** One PR as the list and PR-meta endpoints return it. */
export interface PrSummary {
  readonly repoId: string;
  readonly repoSlug: string | null;
  readonly prNumber: number;
  readonly title: string | null;
  readonly state: PrState;
  /** Current span's brief base; null while the span has no brief yet. */
  readonly baseSha: string | null;
  /** The current push's head; null only when nothing was ever projected. */
  readonly headSha: string | null;
  readonly briefAvailable: boolean;
  readonly generation: GenerationSummary | null;
  readonly updatedAt: string;
}

/**
 * The picker's view of `GET /api/pulls`. Logged-out (401) and
 * backend-unavailable (502/503 — GitHub or composition down) are both
 * EXPECTED states the picker renders inline; only contract violations throw.
 */
export type PullsSession =
  | { readonly kind: "logged-out" }
  | { readonly kind: "ready"; readonly pulls: PrSummary[] }
  | { readonly kind: "unavailable" };

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * The wire shape of a repo id is a NUMERIC string (bigints are stringified
 * server-side). Anything else is malformed data — and since the picker
 * interpolates this into `/repos/{repoId}/...` URLs, a loose string would
 * become an unintended route instead of a rejected response.
 */
function isRepoIdString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isPrState(value: unknown): value is PrState {
  return (
    typeof value === "string" &&
    Object.values(PrStates).some((state) => state === value)
  );
}

function isGenerationStatus(value: unknown): value is GenerationStatus {
  return (
    typeof value === "string" &&
    Object.values(GenerationStatuses).some((status) => status === value)
  );
}

function parseGenerationSummary(
  value: unknown,
): Result<GenerationSummary | null> {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value))
    return { ok: false, error: "generation must be an object or null" };
  if (!isGenerationStatus(value["status"])) {
    return { ok: false, error: "generation.status is not a known status" };
  }
  if (!isStringOrNull(value["phase"])) {
    return { ok: false, error: "generation.phase must be a string or null" };
  }
  if (typeof value["attempts"] !== "number") {
    return { ok: false, error: "generation.attempts must be a number" };
  }
  if (!isStringOrNull(value["error"])) {
    return { ok: false, error: "generation.error must be a string or null" };
  }
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "generation.updatedAt must be a string" };
  }
  return {
    ok: true,
    value: {
      status: value["status"],
      phase: value["phase"],
      attempts: value["attempts"],
      error: value["error"],
      updatedAt: value["updatedAt"],
    },
  };
}

export function parsePrSummary(value: unknown): Result<PrSummary> {
  if (!isRecord(value))
    return { ok: false, error: "PR summary must be an object" };
  if (!isRepoIdString(value["repoId"])) {
    return { ok: false, error: "repoId must be a numeric string" };
  }
  if (!isStringOrNull(value["repoSlug"])) {
    return { ok: false, error: "repoSlug must be a string or null" };
  }
  if (typeof value["prNumber"] !== "number") {
    return { ok: false, error: "prNumber must be a number" };
  }
  if (!isStringOrNull(value["title"])) {
    return { ok: false, error: "title must be a string or null" };
  }
  if (!isPrState(value["state"])) {
    return { ok: false, error: "state is not a known PR state" };
  }
  if (!isStringOrNull(value["baseSha"]) || !isStringOrNull(value["headSha"])) {
    return { ok: false, error: "baseSha/headSha must be strings or null" };
  }
  if (typeof value["briefAvailable"] !== "boolean") {
    return { ok: false, error: "briefAvailable must be a boolean" };
  }
  const generation = parseGenerationSummary(value["generation"]);
  if (!generation.ok) return generation;
  if (typeof value["updatedAt"] !== "string") {
    return { ok: false, error: "updatedAt must be a string" };
  }
  return {
    ok: true,
    value: {
      repoId: value["repoId"],
      repoSlug: value["repoSlug"],
      prNumber: value["prNumber"],
      title: value["title"],
      state: value["state"],
      baseSha: value["baseSha"],
      headSha: value["headSha"],
      briefAvailable: value["briefAvailable"],
      generation: generation.value,
      updatedAt: value["updatedAt"],
    },
  };
}

export function parsePullsList(value: unknown): Result<PrSummary[]> {
  if (!isRecord(value) || !Array.isArray(value["pulls"])) {
    return { ok: false, error: "list response must be { pulls: [...] }" };
  }
  const pulls: PrSummary[] = [];
  for (const item of value["pulls"]) {
    const parsed = parsePrSummary(item);
    if (!parsed.ok) return parsed;
    pulls.push(parsed.value);
  }
  return { ok: true, value: pulls };
}
