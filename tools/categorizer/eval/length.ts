import type { Brief } from "brief-core/types";

/**
 * Per-case text-length compliance note: rolls a case's runs into one printed
 * number so length compliance is a report fact, not eyeballing. Quiet when
 * every run fits.
 */
export function textLengthNotes(
  briefs: readonly Pick<Brief, "lengthViolations">[],
  label = "",
): string[] {
  const violations = briefs.flatMap((brief) => brief.lengthViolations ?? []);
  if (violations.length === 0) return [];
  const offendingRuns = briefs.filter(
    (brief) => (brief.lengthViolations ?? []).length > 0,
  ).length;
  const worst = violations.reduce((a, b) =>
    b.actual - b.cap > a.actual - a.cap ? b : a,
  );
  const prefix = label === "" ? "" : `${label} `;
  return [
    `${prefix}text length: ${offendingRuns}/${briefs.length} runs over cap, ` +
      `${violations.length} violation(s) — worst: ${worst.field} ${worst.actual}/${worst.cap} chars`,
  ];
}
