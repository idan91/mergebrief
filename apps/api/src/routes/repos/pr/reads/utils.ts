// Request-parsing helpers for the reads handlers: every rejection is the
// deterministic 400 (`invalid-request`), never a schema-shaped hint.
import type { Context } from "hono";
import type { z } from "zod/v4";
import { BadRequest } from "../../../../shared-errors/api-error";
import type { AuthzEnv } from "../../../../access/types";
import { prNumberSchema } from "../../../wire-bounds";

export function parseQuery<S extends z.ZodType>(
  c: Context<AuthzEnv>,
  schema: S,
  keys: readonly string[],
): z.infer<S> {
  const raw: Record<string, string | undefined> = {};
  for (const key of keys) {
    raw[key] = c.req.query(key);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest();
  }
  return parsed.data;
}

export function parsePrNumber(c: Context<AuthzEnv>): number {
  const parsed = prNumberSchema.safeParse(c.req.param("prNumber"));
  if (!parsed.success) {
    throw new BadRequest();
  }
  return parsed.data;
}
