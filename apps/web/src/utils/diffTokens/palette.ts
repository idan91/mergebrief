/**
 * The closed set of colours our theme can emit. `classId` is the index into
 * this array, so the order is a wire contract: the worker posts indexes and
 * the stylesheet names `--syn-<token>` in the same order. Append, never
 * reorder, and re-run the theme suite when the theme gains a colour.
 */
export interface SyntaxPaletteEntry {
  hex: string;
  token: string;
}

export const TEXT_CLASS_ID = 0;

export const SYNTAX_PALETTE = [
  { hex: "#e1e4e8", token: "text" },
  { hex: "#8b949e", token: "comment" },
  { hex: "#79b8ff", token: "constant" },
  { hex: "#b392f0", token: "entity" },
  { hex: "#f97583", token: "keyword" },
  { hex: "#9ecbff", token: "string" },
  { hex: "#85e89d", token: "tag" },
  { hex: "#ffab70", token: "variable" },
  { hex: "#fdaeb7", token: "invalid" },
  { hex: "#dbedff", token: "regexp" },
  { hex: "#d1d5da", token: "bracket" },
  { hex: "#2f363d", token: "ignored" },
  { hex: "#24292e", token: "carriage-return" },
] as const satisfies readonly SyntaxPaletteEntry[];

const CLASS_IDS_BY_HEX: ReadonlyMap<string, number> = new Map(
  SYNTAX_PALETTE.map((entry, index) => [entry.hex, index]),
);

export function resolveClassId(hex: string | undefined): number {
  if (hex === undefined) return TEXT_CLASS_ID;

  return CLASS_IDS_BY_HEX.get(hex.toLowerCase()) ?? TEXT_CLASS_ID;
}
