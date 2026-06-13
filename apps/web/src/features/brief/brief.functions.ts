import { createServerFn } from "@tanstack/react-start";

import { listLocalBriefs, readLocalBrief } from "./brief.server";

interface LocalBriefRequest {
  briefId: string;
}

function parseLocalBriefRequest(value: unknown): LocalBriefRequest {
  if (typeof value !== "object" || value === null || !("briefId" in value) || typeof value.briefId !== "string") {
    throw new Error("Expected briefId");
  }
  return { briefId: value.briefId };
}

export const getLocalBrief = createServerFn({ method: "GET" })
  .validator(parseLocalBriefRequest)
  .handler(async ({ data }) => readLocalBrief(data.briefId));

export const getLocalBriefs = createServerFn({ method: "GET" }).handler(async () => listLocalBriefs());
