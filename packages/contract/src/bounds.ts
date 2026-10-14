/**
 * Request bounds a client checks before sending: past one the api answers a
 * deterministic 400, and a client resubmitting the same state would loop.
 */
export const RequestBounds = {
  /** A comment, reply, review body, dismiss reason or evidence note; GitHub's own cap. */
  BODY_LENGTH: 65_536,
  /** An anchor's or a risk flag's file path. */
  PATH_LENGTH: 1_024,
  /** The flags one risk dismiss, address or reopen carries. */
  FLAGS_PER_CALL: 200,
  /** A pasted pull request URL. */
  GENERATE_URL_LENGTH: 500,
  /**
   * The lines one file-range read may span. The expander steps 20 lines per
   * click and caps its own "expand all", so this refuses draining a 100k-line
   * file without refusing an honest ask.
   */
  FILE_RANGE_LINES: 400,
} as const;
