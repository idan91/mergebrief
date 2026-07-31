// Flat at the feature root with reason (ADR 0037 SS4, the in-ADR precedent):
// it touches server/ and must stay out of the barrels.
import { queryOptions } from "@tanstack/react-query";

import { apiFetch } from "../../data/apiFetch";
import {
  getLocalBrief,
  getLocalBriefs,
  getLocalComparisonMarks,
  getLocalRevisionChanges,
  getLocalRevisionNarrative,
} from "./server/brief.functions";

const GENERATE_FALLBACK_COPY =
  "Couldn't generate the brief for this PR — try again.";

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Deterministic route rejections, mirrored with recoverable copy (repo rule). */
async function generateErrorCopy(response: Response): Promise<string> {
  if (response.status === 400) {
    return "That doesn't look like a GitHub pull request URL.";
  }
  if (response.status === 401) {
    return "Your session expired — sign in again to generate.";
  }
  if (response.status === 404) {
    // GitHub scopes App sign-in tokens to installed repos — a private repo
    // without the App reads as nonexistent even to its owner.
    return "Couldn't fetch this PR — check the URL; for a private repo, install the app on it or set MERGEBRIEF_URL_BOX_TOKEN (sign-in tokens only reach repos the app is installed on).";
  }
  if (response.status === 503) {
    // Operator-actionable config copy authored server-side (env-var names
    // only, clamped at the route).
    const message = stringField(
      await response.json().catch(() => undefined),
      "error",
    );
    return message ?? GENERATE_FALLBACK_COPY;
  }
  return GENERATE_FALLBACK_COPY;
}

/**
 * Signed-in generate path (BRIEF-97): POST /api/generate runs the pipeline
 * with the VIEWER's token — works for any repo the account can read, no gh
 * CLI and no App installation involved.
 */
export async function generateBriefViaApi(url: string): Promise<string> {
  const response = await apiFetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(await generateErrorCopy(response));
  }
  const briefIdValue = stringField(
    await response.json().catch(() => undefined),
    "briefId",
  );
  if (briefIdValue === undefined) {
    throw new Error(GENERATE_FALLBACK_COPY);
  }
  return briefIdValue;
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
