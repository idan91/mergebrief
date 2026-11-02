import { parseChangedRanges } from "brief-core";
import { loadPairCases } from "../eval/pairs";

/** One span's changed files and hunk headers, the shape a hand derivation pins. */
export interface SpanShape {
  readonly files: string[];
  readonly headers: string[];
}

/** The filtered and unfiltered spans of the pair case `id` under `dir`, each as its shape. */
export async function readPairSpanShapes(
  dir: string,
  id: string,
): Promise<SpanShape[]> {
  const loaded = await loadPairCases(dir, id);
  const fixture = loaded.ok ? loaded.value[0]?.fixture : undefined;
  if (fixture === undefined) {
    throw new Error(`pair case ${id} did not load`);
  }
  return [fixture.filteredSpan, fixture.unfilteredSpan].map((span) => {
    const text = span ?? "";
    const headers = text.split("\n").filter((line) => line.startsWith("@@"));
    return {
      files: parseChangedRanges(text).map((file) => file.file),
      headers,
    };
  });
}
