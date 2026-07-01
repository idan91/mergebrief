import { createServerFn } from "@tanstack/react-start";

import {
  listLocalBriefs,
  readComparisonMarks,
  readLocalBrief,
  readRevisionChanges,
  readRevisionNarrative,
} from "./brief.server";
import { generateBriefFromUrl } from "./generate.server";

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

function parseGenerateBriefRequest(value: unknown): GenerateBriefRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    typeof value.url !== "string"
  ) {
    throw new Error("Expected url");
  }
  return { url: value.url };
}

export const getLocalBrief = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) => readLocalBrief(data.briefId));

export const getLocalBriefs = createServerFn({ method: "GET" }).handler(
  async () => listLocalBriefs(),
);

export const getLocalRevisionChanges = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) => readRevisionChanges(data.briefId));

export const getLocalComparisonMarks = createServerFn({ method: "GET" })
  .validator(parseArtifactIdRequest)
  .handler(async ({ data }) => readComparisonMarks(data.id));

export const getLocalRevisionNarrative = createServerFn({ method: "GET" })
  .validator(parseArtifactIdRequest)
  .handler(async ({ data }) => readRevisionNarrative(data.id));

export const generateBrief = createServerFn({ method: "POST" })
  .validator(parseGenerateBriefRequest)
  .handler(async ({ data }) => generateBriefFromUrl(data.url));
