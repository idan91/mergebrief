import type { ChangeGroup, Chunk } from "./types.js";

/**
 * Validate the chunk↔group partition. With group membership on the chunk
 * (`changeGroupId`), duplicate and orphan chunks are structurally impossible
 * (a chunk has exactly one required group id). What remains to check is a
 * dangling reference (a chunk pointing at a group that doesn't exist) and a
 * group with no chunks / no carrier. Returns human-readable issues — empty
 * means clean.
 */
export function validatePartition(
  groups: Pick<ChangeGroup, "id">[],
  chunks: Pick<Chunk, "id" | "changeGroupId" | "role">[],
): string[] {
  const issues: string[] = [];
  const groupIds = new Set(groups.map((g) => g.id));

  for (const c of chunks) {
    if (!groupIds.has(c.changeGroupId)) {
      issues.push(`chunk ${c.id} references unknown group "${c.changeGroupId}"`);
    }
  }

  for (const g of groups) {
    const members = chunks.filter((c) => c.changeGroupId === g.id);
    if (members.length === 0) {
      issues.push(`group ${g.id} has no chunks`);
    } else if (!members.some((c) => c.role === "carrier")) {
      issues.push(`group ${g.id} has no carrier chunk`);
    }
  }

  return issues;
}
