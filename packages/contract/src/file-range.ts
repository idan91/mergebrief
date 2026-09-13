// One file's line window at a ref, as the hunk-edge expander reads it. The
// RANGE is what travels: the API holds the decoded blob in its per-session
// cache and serves slices out of it, so the whole file never crosses the wire.
/**
 * The lines one read may span. The expander steps 20 lines per click and caps
 * its own "expand all", so this refuses draining a 100k-line file without
 * refusing an honest ask. Both sides read it from here.
 */
export const MAX_FILE_RANGE_LINES = 400;

export interface FileRangeView {
  readonly path: string;
  readonly ref: string;
  /** First line served, 1-based inclusive, clamped to `totalLines + 1`. */
  readonly from: number;
  /** Last line served, 1-based inclusive, clamped to `totalLines`. */
  readonly to: number;
  /**
   * Always `to - from + 1` lines. A window starting past the end of the file
   * serves none, reported as `from = totalLines + 1`, `to = totalLines`.
   */
  readonly lines: readonly string[];
  /** Lines in the whole file; a trailing newline terminates, it does not add one. */
  readonly totalLines: number;
}
