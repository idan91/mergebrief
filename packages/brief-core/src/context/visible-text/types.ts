import type { TextRange } from "../../generation/untrusted-text";

/** Where the HTML grammar applies, and the blocks among them that end on a marker's line. */
export interface HtmlBlocks {
  readonly regions: TextRange[];
  readonly markerBlocks: ReadonlyMap<string, readonly TextRange[]>;
}
