import { OutlineForms, type OutlineForm } from "../../types";
import type { OutlineLimits } from "./types";

/** The most input tokens a grouping call reads, at the outline rate. */
export const OUTLINE_MAX_INPUT_TOKENS = 700_000;

const WIDE_LINE_MAX_CHARS = 160;
const NARROW_LINE_MAX_CHARS = 100;

/** The outline forms in descending order; the ladder stops at the first that fits. */
export const OUTLINE_LADDER: readonly OutlineForm[] = [
  OutlineForms.LINES_40,
  OutlineForms.LINES_20,
  OutlineForms.LINES_12,
  OutlineForms.LINES_6,
  OutlineForms.LINES_2,
  OutlineForms.HEADERS,
  OutlineForms.FILES,
];

/** The forms that keep changed lines, with how many; the headers and files forms keep none. */
export const OUTLINE_LIMITS: ReadonlyMap<OutlineForm, OutlineLimits> = new Map([
  [
    OutlineForms.LINES_40,
    {
      lineMaxChars: WIDE_LINE_MAX_CHARS,
      hunkMaxChangedLines: 40,
      keepHead: 20,
      keepTail: 10,
    },
  ],
  [
    OutlineForms.LINES_20,
    {
      lineMaxChars: WIDE_LINE_MAX_CHARS,
      hunkMaxChangedLines: 20,
      keepHead: 10,
      keepTail: 5,
    },
  ],
  [
    OutlineForms.LINES_12,
    {
      lineMaxChars: NARROW_LINE_MAX_CHARS,
      hunkMaxChangedLines: 12,
      keepHead: 6,
      keepTail: 3,
    },
  ],
  [
    OutlineForms.LINES_6,
    {
      lineMaxChars: NARROW_LINE_MAX_CHARS,
      hunkMaxChangedLines: 6,
      keepHead: 4,
      keepTail: 2,
    },
  ],
  [
    OutlineForms.LINES_2,
    {
      lineMaxChars: NARROW_LINE_MAX_CHARS,
      hunkMaxChangedLines: 2,
      keepHead: 2,
      keepTail: 0,
    },
  ],
]);
