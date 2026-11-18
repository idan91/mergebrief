/** A non-null object, as the first gate of every hand-rolled wire guard. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
