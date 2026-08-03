// The daily generation cap (BRIEF-20) — the instance's one spend guardrail.
// Pure helpers only; the enforcement point (the single seam where a run
// starts, before any provider call) lives in `generate.ts`.
//
// WHY UTC: the reset boundary has to be one instant for the whole instance —
// a per-repo or per-viewer local day would make the count ambiguous during
// the overlap. The FE renders the reset time in the VIEWER's zone, so the
// operator's timezone never leaks into the product.

/** The half-open window `[from, to)` covering `instant`'s UTC calendar day. */
export interface UtcDay {
  readonly from: Date;
  readonly to: Date;
  /** `YYYY-MM-DD` — the `dayUtc` log field. */
  readonly label: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function utcDayBounds(instant: Date): UtcDay {
  const from = new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
    ),
  );
  const to = new Date(from.getTime() + MS_PER_DAY);
  return { from, to, label: from.toISOString().slice(0, 10) };
}
