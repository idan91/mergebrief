// The slice of a Brief's body the carry-over evaluation reads, and nothing
// else. Pure: a string in, group ids and flags out — the parse the session
// read defers until a previous session makes it necessary.
import type { FlagKey } from "persistence";
import { z } from "zod";

/**
 * The change groups a reclassification may descend into, and the flags a
 * disposition may still hang off. Unknown keys are dropped — this is a lean
 * read of a large document, never the artifact contract.
 *
 * The two top-level keys are REQUIRED, unlike everything under them. A body
 * missing them would parse to zero groups and zero flags, which is the same
 * silent mass-`DROPPED` an unparseable body would cause; a chunk missing its
 * ranges is only a chunk with no span.
 */
const lineRangeSchema = z.object({ start: z.number(), end: z.number() });
const briefCarryFactsSchema = z.object({
  changeGroups: z.array(z.object({ id: z.string() })),
  chunks: z.array(
    z.object({
      file: z.string(),
      addedRanges: z.array(lineRangeSchema).default([]),
      removedRanges: z.array(lineRangeSchema).default([]),
      riskSurface: z.array(z.string()).default([]),
    }),
  ),
});

export interface CarryFacts {
  readonly groupIds: string[];
  readonly flags: FlagKey[];
}

/**
 * A stored Brief artifact that will not parse. Thrown rather than answered
 * with empty facts: no flags firing is indistinguishable from every flag
 * having stopped firing, which turns every carried decision into a silent
 * `DROPPED`. The route boundary catches it and answers a typed 500 — a failed
 * read the reviewer can retry, never work quietly discarded.
 */
export class UnreadableBriefError extends Error {}

/** The chunk's whole diff span — the region its flags' dispositions anchor on. */
export function deriveChunkRegion(chunk: {
  addedRanges: readonly { start: number; end: number }[];
  removedRanges: readonly { start: number; end: number }[];
}): { start: number; end: number } {
  const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
  if (bounds.length === 0) return { start: 1, end: 1 };
  return {
    start: Math.min(...bounds.map((range) => range.start)),
    end: Math.max(...bounds.map((range) => range.end)),
  };
}

export function readCarryFacts(body: string): CarryFacts {
  const parsed = briefCarryFactsSchema.safeParse(parseJson(body));
  if (!parsed.success) {
    throw new UnreadableBriefError("brief body will not parse");
  }
  const flags = parsed.data.chunks.flatMap((chunk) => {
    const region = deriveChunkRegion(chunk);
    return chunk.riskSurface.map((attribute) => ({
      filePath: chunk.file,
      attribute,
      regionStart: region.start,
      regionEnd: region.end,
    }));
  });
  return { groupIds: parsed.data.changeGroups.map((group) => group.id), flags };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
