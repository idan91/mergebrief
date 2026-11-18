/**
 * A stored body failed its closed Zod schema (`comparison_marks`, `hunk_span`,
 * `generation_part`, `chunk_layout`): a writer defect against a fixed shape,
 * which no retry can fix.
 */
export class InvalidArtifactBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArtifactBodyError";
  }
}
