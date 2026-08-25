// Flat at the feature root: it touches server/ and must stay out of the barrels.
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import {
  getLocalBrief,
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
 * The url-box door: resolve + enqueue with the VIEWER's token — works for
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
      ApiErrorCode.MALFORMED,
      response.status,
      "/api/generate",
    );
  }
  return { repoId, prNumber };
}

export function localBriefQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["brief", "local", briefId],
    queryFn: () => getLocalBrief({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localRevisionChangesQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["revisionChanges", "local", briefId],
    queryFn: () => getLocalRevisionChanges({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localComparisonMarksQueryOptions(marksId: string) {
  return queryOptions({
    queryKey: ["comparisonMarks", "local", marksId],
    queryFn: () => getLocalComparisonMarks({ data: { id: marksId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localRevisionNarrativeQueryOptions(narrativeId: string) {
  return queryOptions({
    queryKey: ["revisionNarrative", "local", narrativeId],
    queryFn: () => getLocalRevisionNarrative({ data: { id: narrativeId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localBriefsQueryOptions() {
  return queryOptions({
    queryKey: ["briefs", "local"],
    queryFn: () => getLocalBriefs(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
