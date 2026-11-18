import type { FileId, IndexedFile } from "../../diff/hunk-index/types";
import type { OutlineForm } from "../../types";
import type { ShortenedFile } from "../shortened/types";

/** How one `lines-N` form trims a hunk: the most changed lines it keeps, and what stays of a longer one. */
export interface OutlineLimits {
  readonly lineMaxChars: number;
  readonly hunkMaxChangedLines: number;
  readonly keepHead: number;
  readonly keepTail: number;
}

export interface OutlineInput {
  readonly files: readonly IndexedFile[];
  /** The files a multi-call run reads shortened, by file id. */
  readonly shortened: ReadonlyMap<FileId, ShortenedFile>;
  /** Skips the ladder and renders this form whatever its size. */
  readonly forcedForm?: OutlineForm | undefined;
}

/** The diff text the grouping call reads and the form it took. */
export interface Outline {
  readonly form: OutlineForm;
  readonly text: string;
  readonly estimatedInputTokens: number;
}
