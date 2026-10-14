import type { StoredRevisionNarrative } from "brief-core/artifact";
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import {
  LocalBriefKinds,
  ProductQueryIds,
  RequestBounds,
  type FileRangeView,
  type LocalBriefSummary,
  type LocalBriefView,
} from "contract";
import { HttpStatuses } from "types/http";
import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";
import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  apiJsonFromResponse,
  errorFromResponse,
  type ApiErrorCode,
} from "../../data/apiFetch";
import { request } from "../../data/request";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import { FileRangeResultKinds } from "./model/expansion/types";
import type { Brief, ComparisonMarks, FileDiffPatch } from "./model/types";
import {
  parseAddressedReviewComments,
  parseComparisonMarks,
  parseFileDiffPatches,
  parseLocalBriefSummaries,
} from "./model/schemas";
import {
  parseBrief,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
  type Result,
} from "./model/utils/validation";

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

const LOCAL_BRIEFS_PATH = "/api/local-briefs";

function buildLocalBriefPath(id: string, sidecar?: string): string {
  const base = `${LOCAL_BRIEFS_PATH}/${encodeURIComponent(id)}`;
  const path = sidecar === undefined ? base : `${base}/${sidecar}`;
  return path;
}

/** A local artifact the API served but this build cannot read. */
function buildUnreadableError(path: string, status: number): ApiError {
  return new ApiError(ApiErrorCodes.ARTIFACT_UNREADABLE, status, path);
}

function parseJsonText(text: string): Result<unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Expected a JSON body" };
  }
}

/** The body itself is read by the artifact kind's own reader; here it only has to be present. */
const localBriefViewSchema = z.object({
  artifactKind: z.enum(LocalBriefKinds),
  body: z.custom<unknown>((value) => value !== undefined),
  reviewComments: z.unknown().optional(),
});

/** The stored body and its comments sidecar, read by the artifact kind's own reader. */
async function parseLocalBriefView(
  view: unknown,
  path: string,
  status: number,
): Promise<Brief> {
  const parsedView = parseWithSchema(localBriefViewSchema, view);
  if (!parsedView.ok) {
    throw new ApiError(ApiErrorCodes.MALFORMED, status, path);
  }
  const localView: LocalBriefView = parsedView.value;

  const text = JSON.stringify(localView.body);
  const parsed =
    localView.artifactKind === LocalBriefKinds.DELTA
      ? parseDeltaBrief(text)
      : parseBrief(text, await getSsrWarnSink());
  if (!parsed.ok) {
    throw buildUnreadableError(path, status);
  }
  if (localView.reviewComments === undefined) {
    return parsed.value;
  }

  const comments = parseAddressedReviewComments(localView.reviewComments);
  if (!comments.ok) {
    throw buildUnreadableError(path, status);
  }
  return { ...parsed.value, reviewComments: comments.value };
}

/**
 * An optional sidecar: absent is `undefined`, and so is one that fails to
 * parse, so a generation glitch degrades the overlay rather than the review.
 * Only an SSR read warns about the parse failure: the browser has no sink.
 * Any other refusal rejects.
 */
async function readOptionalSidecar<Sidecar>(
  path: string,
  parse: (text: string) => Result<Sidecar>,
): Promise<Sidecar | undefined> {
  const response = await apiFetch(path);
  if (response.status === HttpStatuses.NOT_FOUND) {
    return undefined;
  }
  if (!response.ok) {
    throw await errorFromResponse(response, path);
  }

  const parsed = parse(await response.text());
  if (!parsed.ok) {
    (await getSsrWarnSink())?.warn("local brief sidecar ignored: invalid", {
      reason: parsed.error,
    });
    return undefined;
  }
  return parsed.value;
}

function parseComparisonMarksText(text: string): Result<ComparisonMarks> {
  const json = parseJsonText(text);
  const marks = json.ok ? parseComparisonMarks(json.value) : json;
  return marks;
}

export function buildLocalBriefQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["brief", "local", briefId],
    queryFn: async (): Promise<Brief> => {
      const path = buildLocalBriefPath(briefId);
      const response = await apiFetch(path);
      const view = await apiJsonFromResponse(response, path);
      return parseLocalBriefView(view, path, response.status);
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** The diffs sidecar is written with its artifact: a missing one is a broken set. */
export function buildLocalBriefDiffsQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["briefDiffs", "local", briefId],
    queryFn: async (): Promise<FileDiffPatch[]> => {
      const path = buildLocalBriefPath(briefId, "diffs");
      const response = await apiFetch(path);
      if (response.status === HttpStatuses.NOT_FOUND) {
        throw buildUnreadableError(path, response.status);
      }
      if (!response.ok) {
        throw await errorFromResponse(response, path);
      }

      const json = parseJsonText(await response.text());
      const patches = json.ok ? parseFileDiffPatches(json.value) : json;
      if (!patches.ok) {
        throw buildUnreadableError(path, response.status);
      }
      return patches.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * A sidecar the listing named but the read found missing rejects, once:
 * an errored query counts as stale, so focus and remount must not read it again.
 */
export function buildLocalComparisonMarksQueryOptions(marksId: string) {
  const queryKey: QueryKey = ["comparisonMarks", "local", marksId];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<ComparisonMarks> => {
      const path = buildLocalBriefPath(marksId, "comparison-marks");
      const marks = await readOptionalSidecar(path, parseComparisonMarksText);
      if (marks === undefined) {
        throw new Error("comparison marks sidecar missing");
      }
      return marks;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retryOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * A sidecar the listing named but the read found missing rejects, once:
 * an errored query counts as stale, so focus and remount must not read it again.
 */
export function buildLocalRevisionNarrativeQueryOptions(narrativeId: string) {
  const queryKey: QueryKey = ["revisionNarrative", "local", narrativeId];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<StoredRevisionNarrative> => {
      const path = buildLocalBriefPath(narrativeId, "revision-narrative");
      const sink = await getSsrWarnSink();
      const narrative = await readOptionalSidecar(path, (text) =>
        parseRevisionNarrativeArtifact(text, sink),
      );
      if (narrative === undefined) {
        throw new Error("revision narrative sidecar missing");
      }
      return narrative;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retryOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/** With no out dir every path is unmounted: the 404 is zero local Briefs. */
export function buildLocalBriefsQueryOptions() {
  return queryOptions({
    queryKey: ["briefs", "local"],
    queryFn: async (): Promise<LocalBriefSummary[]> => {
      const response = await apiFetch(LOCAL_BRIEFS_PATH);
      if (response.status === HttpStatuses.NOT_FOUND) {
        return [];
      }

      const body = await apiJsonFromResponse(response, LOCAL_BRIEFS_PATH);
      const summaries = parseLocalBriefSummaries(body);
      if (!summaries.ok) {
        throw new ApiError(
          ApiErrorCodes.MALFORMED,
          response.status,
          LOCAL_BRIEFS_PATH,
        );
      }
      return summaries.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
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
  | {
      readonly kind: typeof FileRangeResultKinds.READY;
      readonly range: FileRangeView;
    }
  /** `file-too-large`: past the expander's budget; the edge stays folded. */
  | { readonly kind: typeof FileRangeResultKinds.TOO_LARGE }
  /** `file-not-text`: binary or non-utf8, there is nothing to show as lines. */
  | { readonly kind: typeof FileRangeResultKinds.NOT_TEXT }
  /** `file-not-found`: the path is gone at this commit (or never existed). */
  | { readonly kind: typeof FileRangeResultKinds.NOT_FOUND }
  /** Any other refusal: auth, upstream, or a 400 this build cannot name. */
  | { readonly kind: typeof FileRangeResultKinds.UNAVAILABLE };

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

async function readFileRange(
  params: FileRangeParams,
): Promise<FileRangeResult> {
  try {
    const range = await request(
      ProductQueryIds.READ_FILE_RANGE,
      {
        params: { repoId: params.repoId, prNumber: params.prNumber },
        query: {
          ref: params.ref,
          path: params.path,
          from: String(params.from),
          to: String(params.to),
        },
      },
      fileRangeSchema,
    );
    return { kind: FileRangeResultKinds.READY, range };
  } catch (error) {
    return resolveFileRangeFailure(error);
  }
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
    queryFn: () => readFileRange(params),
    // Never collected: a range refetched after eviction would render its
    // rows blank while the read is in flight.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
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

  const lineCount = params.to - params.from + 1;
  return lineCount <= RequestBounds.FILE_RANGE_LINES;
}

/** Every refusal this read answers with a reader-facing state of its own. */
type FileRangeFailure = Exclude<
  FileRangeResult,
  { readonly kind: typeof FileRangeResultKinds.READY }
>;

const UNAVAILABLE: FileRangeFailure = {
  kind: FileRangeResultKinds.UNAVAILABLE,
};

const FILE_RANGE_FAILURES: Partial<Record<ApiErrorCode, FileRangeFailure>> = {
  [ApiErrorCodes.FILE_TOO_LARGE]: { kind: FileRangeResultKinds.TOO_LARGE },
  [ApiErrorCodes.FILE_NOT_TEXT]: { kind: FileRangeResultKinds.NOT_TEXT },
  [ApiErrorCodes.FILE_NOT_FOUND]: { kind: FileRangeResultKinds.NOT_FOUND },
};

/**
 * The CODE names the refusal, not the status: the route answers 400 for a
 * non-text blob and for a malformed query alike, and only the first has a
 * reader-facing answer. A malformed 2xx and a network failure still throw.
 */
function resolveFileRangeFailure(error: unknown): FileRangeFailure {
  const refused =
    error instanceof ApiError && error.code !== ApiErrorCodes.MALFORMED;
  if (!refused) {
    throw error;
  }

  return FILE_RANGE_FAILURES[error.code] ?? UNAVAILABLE;
}
