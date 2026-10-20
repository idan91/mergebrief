import { z } from "zod/v4";

export const GRAPHQL_NOT_FOUND = "NOT_FOUND";

const thrownPageSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  errors: z.array(
    z.object({
      type: z.string().optional(),
      path: z.array(z.union([z.string(), z.number()])).optional(),
    }),
  ),
});

export interface PartialPage {
  readonly data: Record<string, unknown>;
  /** Aliases an error other than NOT_FOUND names; they get no entry. */
  readonly unanswered: ReadonlySet<string>;
}

/**
 * octokit throws whenever the errors array is not empty, but the throw still
 * carries the data for every alias GitHub did answer. A NOT_FOUND alias is
 * an answer (null); any other alias-level error withholds that alias only.
 * An error naming no alias, or a throw with no data, is a page failure.
 */
export function readPartialData(error: unknown): PartialPage | undefined {
  const parsed = thrownPageSchema.safeParse(error);
  if (!parsed.success) {
    return undefined;
  }

  const unanswered = new Set<string>();
  for (const entry of parsed.data.errors) {
    if (entry.type === GRAPHQL_NOT_FOUND) {
      continue;
    }
    const alias = entry.path?.[0];
    if (typeof alias !== "string") {
      return undefined;
    }
    unanswered.add(alias);
  }
  return { data: parsed.data.data, unanswered };
}
