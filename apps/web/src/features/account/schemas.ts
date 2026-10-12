import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

import { ViewerStates, type ViewerState } from "./types";

const sessionBodySchema = z.object({
  viewer: z.object({
    login: z.string().nullable().catch(null),
    avatarUrl: z.string(),
  }),
});

/** The `viewer` of the session response; anything else is unknown, never a throw. */
export function parseViewer(body: unknown): ViewerState {
  const parsed = parseWithSchema(sessionBodySchema, body);
  if (!parsed.ok) {
    return { kind: ViewerStates.UNKNOWN };
  }
  const { login, avatarUrl } = parsed.value.viewer;
  return { kind: ViewerStates.SIGNED_IN, login, avatarUrl };
}
