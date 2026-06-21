import { createServerFn } from "@tanstack/react-start";

import { listLocalBriefs, readLocalBrief } from "./brief.server";
import { generateBriefFromUrl } from "./generate.server";

interface LocalBriefRequest {
  briefId: string;
}

function parseLocalBriefRequest(value: unknown): LocalBriefRequest {
  if (typeof value !== "object" || value === null || !("briefId" in value) || typeof value.briefId !== "string") {
    throw new Error("Expected briefId");
  }
  return { briefId: value.briefId };
}

interface GenerateBriefRequest {
  url: string;
}

function parseGenerateBriefRequest(value: unknown): GenerateBriefRequest {
  if (typeof value !== "object" || value === null || !("url" in value) || typeof value.url !== "string") {
    throw new Error("Expected url");
  }
  return { url: value.url };
}

export const getLocalBrief = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) => readLocalBrief(data.briefId));

export const getLocalBriefs = createServerFn({ method: "GET" }).handler(async () => listLocalBriefs());

export const generateBrief = createServerFn({ method: "POST" })
  .validator(parseGenerateBriefRequest)
  .handler(async ({ data }) => generateBriefFromUrl(data.url));
