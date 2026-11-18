// The daily generation cap's window, shared by the worker's enforcement point
// and the api's spend read. UTC because the reset boundary must be ONE instant
// for the whole instance; a local day would make the count ambiguous in the
// overlap.

/** The half-open window `[from, to)` covering `instant`'s UTC calendar day. */
export interface UtcDay {
  readonly from: Date;
  readonly to: Date;
  /** `YYYY-MM-DD`, the `dayUtc` log field. */
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
