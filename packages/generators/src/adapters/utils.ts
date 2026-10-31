import type { GenerateRequest } from "../contract/generator";
import type { z } from "zod/v4";

/** The user text for an adapter without content blocks: the shared prefix, a blank line, then the request's own text. */
export function joinUserText<S extends z.ZodType>(
  req: Pick<GenerateRequest<S>, "user" | "userPrefix">,
): string {
  if (req.userPrefix === undefined) {
    return req.user;
  }
  return `${req.userPrefix}\n\n${req.user}`;
}
