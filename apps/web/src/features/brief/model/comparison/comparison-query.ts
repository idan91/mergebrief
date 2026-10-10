import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";

/**
 * A ready-to-run react-query descriptor supplied by a comparison plan (the DB
 * read path). Carrying `queryKey` explicitly lets consumers key/reset on the
 * span it addresses without re-deriving it. Shared so the plan, `BriefPage`,
 * and the Changes Only raw-span-diff toggle name the same shape.
 */
export type ComparisonQuery<T> = UseQueryOptions<T> & {
  readonly queryKey: QueryKey;
};
