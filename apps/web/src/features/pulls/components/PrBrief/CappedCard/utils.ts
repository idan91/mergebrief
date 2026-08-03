/**
 * The daily generation cap's reset instant (BRIEF-20): the cap counts a UTC
 * calendar day, so it resets at the first midnight UTC strictly after the
 * skip was recorded. Derived from the SKIP time, never from "now" — a capped
 * row left over from an earlier day must not claim to be waiting on tonight.
 */
export function capResetsAt(cappedAtIso: string): Date | undefined {
  const cappedAt = new Date(cappedAtIso);
  if (Number.isNaN(cappedAt.getTime())) return undefined;
  return new Date(
    Date.UTC(
      cappedAt.getUTCFullYear(),
      cappedAt.getUTCMonth(),
      cappedAt.getUTCDate() + 1,
    ),
  );
}

/**
 * The capped heading — the grill's copy, with the reset time rendered in the
 * VIEWER's zone (the operator's UTC boundary is an implementation detail).
 * An unparsable timestamp degrades to the capless sentence rather than
 * printing "Invalid Date".
 */
export function cappedLabel(
  cappedAtIso: string,
  now: Date = new Date(),
): string {
  const resetsAt = capResetsAt(cappedAtIso);
  if (resetsAt === undefined) return "Daily generation cap reached.";
  if (resetsAt.getTime() <= now.getTime()) {
    // The window already rolled over: the cap is no longer holding anything
    // back, so promising a future resume time would be a lie.
    return "Daily generation cap reached — generation has since resumed.";
  }
  return `Daily generation cap reached — resumes ${formatLocal(resetsAt)}`;
}

/** Viewer-local date+time, minute precision. */
function formatLocal(instant: Date): string {
  return instant.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
