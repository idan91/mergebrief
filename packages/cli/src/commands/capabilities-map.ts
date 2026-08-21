// The committed operations map at runtime: the entry vocabulary, the join
// arm, and the boundary parse. map:check gates the committed file, so a
// parse failure here is a programmer error, not an expected failure.
import { z } from "zod";

const mapEntrySchema = z.union([
  z.object({ command: z.string() }),
  z.object({ gap: z.object({}).passthrough() }),
  z.object({ webOnly: z.object({}).passthrough() }),
]);
export type MapEntry = z.infer<typeof mapEntrySchema>;

/** What an operation resolves to on this binary — the fourth arm marks a
 * server newer than the CLI. */
export type CliArm = MapEntry | { readonly unknownToCli: true };

export function parseOperationsMap(raw: unknown): Map<string, MapEntry> {
  return new Map(
    Object.entries(z.record(z.string(), mapEntrySchema).parse(raw)),
  );
}

/** TTY label per arm — non-contractual rendering only. */
export function labelArm(arm: CliArm): string {
  if ("command" in arm) return arm.command;
  if ("gap" in arm) return "gap (no CLI command yet)";
  if ("webOnly" in arm) return "web-only";
  return "unknown to this CLI (server is newer)";
}
