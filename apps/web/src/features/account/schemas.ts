import { z } from "zod/v4";

import { dropInvalidKeys } from "@web/utils/drop-keys";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import { ViewerStates, type ViewerState } from "./types";

export const viewerSchema = dropInvalidKeys(
  z.object({ login: z.string().exactOptional(), avatarUrl: z.string() }),
  ["login"],
);

export const sessionBodySchema = z.object({
  viewer: viewerSchema,
  operator: z.boolean().catch(false),
});

/** The `viewer` of the session response; anything else is unknown, never a throw. */
export function parseViewer(body: unknown): ViewerState {
  const parsed = parseWithSchema(sessionBodySchema, body);
  if (!parsed.ok) {
    return { kind: ViewerStates.UNKNOWN };
  }
  return {
    kind: ViewerStates.SIGNED_IN,
    ...parsed.value.viewer,
    operator: parsed.value.operator,
  };
}
