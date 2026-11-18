/** DB-backed brief ids carry this prefix (minted by the pulls feature);
 * every other id resolves through the local file store. */
export const DB_BRIEF_ID_PREFIX = "db:";

export function isDbBriefId(briefId: string): boolean {
  return briefId.startsWith(DB_BRIEF_ID_PREFIX);
}
