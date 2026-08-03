import { createServerFn } from "@tanstack/react-start";

import { GenerateErrorMessage } from "../utils/briefErrors";
import { briefHandlers } from "./briefHandlers.server";

// The RPC surface: validators plus one-line delegation to `briefHandlers`,
// which owns the curation boundary every rejection must pass through
// (BRIEF-20 — a rejection here is a client-visible string). Keep handlers
// one-liners: a `createServerFn` wrapper cannot be invoked without the Start
// server runtime, so logic inline here is logic nothing can test.

interface LocalBriefRequest {
  briefId: string;
}

function parseLocalBriefRequest(value: unknown): LocalBriefRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("briefId" in value) ||
    typeof value.briefId !== "string"
  ) {
    throw new Error("Expected briefId");
  }
  return { briefId: value.briefId };
}

interface ArtifactIdRequest {
  id: string;
}

/** Validate an artifact-id request (comparison marks / revision narrative). */
function parseArtifactIdRequest(value: unknown): ArtifactIdRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  ) {
    throw new Error("Expected id");
  }
  return { id: value.id };
}

interface GenerateBriefRequest {
  url: string;
}

/** Same cap the api route applies (`z.string().min(1).max(500)`). */
const MAX_URL_LENGTH = 500;

function parseGenerateBriefRequest(value: unknown): GenerateBriefRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    typeof value.url !== "string" ||
    value.url.length === 0
  ) {
    throw new Error("Expected url");
  }
  // Bound the input before anything downstream can echo a fragment of it.
  if (value.url.length > MAX_URL_LENGTH) {
    throw new Error(GenerateErrorMessage.URL_TOO_LONG);
  }
  return { url: value.url };
}

export const getLocalBrief = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) => briefHandlers.getLocalBrief(data.briefId));

export const getLocalBriefs = createServerFn({ method: "GET" }).handler(
  async () => briefHandlers.getLocalBriefs(),
);

export const getLocalRevisionChanges = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) =>
    briefHandlers.getLocalRevisionChanges(data.briefId),
  );

export const getLocalComparisonMarks = createServerFn({ method: "GET" })
  .validator(parseArtifactIdRequest)
  .handler(async ({ data }) => briefHandlers.getLocalComparisonMarks(data.id));

export const getLocalRevisionNarrative = createServerFn({ method: "GET" })
  .validator(parseArtifactIdRequest)
  .handler(async ({ data }) =>
    briefHandlers.getLocalRevisionNarrative(data.id),
  );

export const generateBrief = createServerFn({ method: "POST" })
  .validator(parseGenerateBriefRequest)
  .handler(async ({ data }) => briefHandlers.generateBrief(data.url));
