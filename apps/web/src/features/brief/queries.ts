// Flat at the feature root: it touches server/ and must stay out of the barrels.
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import {
  MAX_FILE_RANGE_LINES,
  ProductQueryIds,
  type FileRangeView,
} from "contract";
import { z } from "zod/v4";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
  type ApiErrorCode,
} from "../../data/apiFetch";
import {
  getLocalBrief,
  getLocalBriefDiffs,
  getLocalBriefs,
  getLocalComparisonMarks,
  getLocalRevisionChanges,
  getLocalRevisionNarrative,
} from "./server/brief.functions";

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Where a just-enqueued url-box brief will render (the repo route). */
export interface GenerateAccepted {
  readonly repoId: string;
  readonly prNumber: number;
}

/**
 * The url-box door: resolve + enqueue with the VIEWER's token: it works for
 * any repo the account can read, no App installation. Generation runs in the
 * worker; the coords point at the repo route, whose meta poll shows progress.
 */
export async function generateBriefViaApi(
  url: string,
): Promise<GenerateAccepted> {
  const response = await apiFetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await apiJsonFromResponse(response, "/api/generate");
  const repoId = stringField(body, "repoId");
  const prNumber =
    typeof body === "object" && body !== null && "prNumber" in body
      ? body.prNumber
      : undefined;
  if (repoId === undefined || typeof prNumber !== "number") {
    throw new ApiError(
      ApiErrorCodes.MALFORMED,
      response.status,
      "/api/generate",
    );
  }
  return { repoId, prNumber };
}

export function buildLocalBriefQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["brief", "local", briefId],
    queryFn: () => getLocalBrief({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function buildLocalBriefDiffsQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["briefDiffs", "local", briefId],
    queryFn: () => getLocalBriefDiffs({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function buildLocalRevisionChangesQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["revisionChanges", "local", briefId],
    queryFn: () => getLocalRevisionChanges({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function buildLocalComparisonMarksQueryOptions(marksId: string) {
  return queryOptions({
    queryKey: ["comparisonMarks", "local", marksId],
    queryFn: () => getLocalComparisonMarks({ data: { id: marksId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function buildLocalRevisionNarrativeQueryOptions(narrativeId: string) {
  return queryOptions({
    queryKey: ["revisionNarrative", "local", narrativeId],
    queryFn: () => getLocalRevisionNarrative({ data: { id: narrativeId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function buildLocalBriefsQueryOptions() {
  return queryOptions({
    queryKey: ["briefs", "local"],
    queryFn: () => getLocalBriefs(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

const HEAD_SHA = /^[\da-f]{40}$/;

// Annotated, not inferred: the annotation is the compile-time proof that what
// this parser answers is the shape the contract promises.
const fileRangeSchema: z.ZodType<FileRangeView> = z
  .object({
    path: z.string(),
    ref: z.string(),
    from: z.number().int().min(1),
    to: z.number().int(),
    lines: z.array(z.string()),
    totalLines: z.number().int(),
  })
  .refine((range) => range.lines.length === range.to - range.from + 1);

export interface FileRangeParams {
  repoId: string;
  prNumber: number;
  /** The head commit sha, 40 hex: the route serves no other ref. */
  ref: string;
  path: string;
  from: number;
  to: number;
}

export type FileRangeResult =
  | { readonly kind: "ready"; readonly range: FileRangeView }
  /** `file-too-large`: past the expander's budget; the edge stays folded. */
  | { readonly kind: "too-large" }
  /** `file-not-text`: binary or non-utf8, there is nothing to show as lines. */
  | { readonly kind: "not-text" }
  /** `file-not-found`: the path is gone at this commit (or never existed). */
  | { readonly kind: "not-found" }
  /** Any other refusal: auth, upstream, or a 400 this build cannot name. */
  | { readonly kind: "unavailable" };

export function buildFileRangeQueryKey(params: FileRangeParams) {
  return [
    ProductQueryIds.READ_FILE_RANGE,
    params.repoId,
    params.prNumber,
    params.ref,
    params.path,
    params.from,
    params.to,
  ] as const;
}

/**
 * One range of one file at the head commit, for hunk-edge expansion. The
 * read is immutable at a sha, so a range once fetched never goes stale.
 * Callers gate ranges with `isFileRangeReadable` first; the route refuses
 * the rest as 400, which reads back as `unavailable`.
 */
export function buildFileRangeQueryOptions(params: FileRangeParams) {
  const queryKey: QueryKey = buildFileRangeQueryKey(params);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<FileRangeResult> => {
      const path = buildFileRangePath(params);
      const response = await apiFetch(path);
      if (!response.ok) {
        return await readFileRangeFailure(response, path);
      }

      const body = await apiJsonFromResponse(response, path);
      const parsed = fileRangeSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
      }
      return { kind: "ready", range: parsed.data };
    },
    // Never collected: a range refetched after eviction would render its
    // rows blank while the read is in flight.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Whether this range is one the route will serve at all. */
export function isFileRangeReadable(params: FileRangeParams): boolean {
  if (!HEAD_SHA.test(params.ref)) {
    return false;
  }
  if (params.from < 1 || params.to < params.from) {
    return false;
  }

  return params.to - params.from + 1 <= MAX_FILE_RANGE_LINES;
}

function buildFileRangePath(params: FileRangeParams): string {
  const repo = encodeURIComponent(params.repoId);
  const pull = String(params.prNumber);
  const query = new URLSearchParams({
    ref: params.ref,
    path: params.path,
    from: String(params.from),
    to: String(params.to),
  });

  return `/api/repos/${repo}/pulls/${pull}/file-range?${query.toString()}`;
}

/** Every refusal this read answers with a reader-facing state of its own. */
type FileRangeFailure = Exclude<FileRangeResult, { readonly kind: "ready" }>;

const UNAVAILABLE: FileRangeFailure = { kind: "unavailable" };

const FILE_RANGE_FAILURES: Partial<Record<ApiErrorCode, FileRangeFailure>> = {
  [ApiErrorCodes.FILE_TOO_LARGE]: { kind: "too-large" },
  [ApiErrorCodes.FILE_NOT_TEXT]: { kind: "not-text" },
  [ApiErrorCodes.FILE_NOT_FOUND]: { kind: "not-found" },
};

/**
 * The CODE names the refusal, not the status: the route answers 400 for a
 * non-text blob and for a malformed query alike, and only the first has a
 * reader-facing answer.
 */
async function readFileRangeFailure(
  response: Response,
  path: string,
): Promise<FileRangeResult> {
  const error = await errorFromResponse(response, path);

  return FILE_RANGE_FAILURES[error.code] ?? UNAVAILABLE;
}
