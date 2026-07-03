import type { FileDiff } from "./diff.js";
import type { RevisionChangeFile } from "./revchanges.js";
import type {
  ChangeGroup,
  Chunk,
  LineRange,
  ReadingOrderStep,
  RevisionNarrativeChunk,
} from "./types.js";

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

/**
 * Validate a Revision narrative's `briefChangeGroupId` references against the
 * current full Brief's actual change-groups (ADR 0024). Unlike
 * `validatePartition`, group membership here is NOT structurally guaranteed —
 * the narrative and the Brief are two independent model outputs — so a
 * dangling reference is a real possibility the model can produce. Warn, never
 * hard-fail: schema validity is the only hard-fail condition for a narrative.
 */
export function validateNarrativeGroups(
  chunks: Pick<RevisionNarrativeChunk, "id" | "briefChangeGroupId">[],
  changeGroups: Pick<ChangeGroup, "id">[],
): string[] {
  const groupIds = new Set(changeGroups.map((g) => g.id));
  const issues: string[] = [];
  for (const c of chunks) {
    if (!groupIds.has(c.briefChangeGroupId)) {
      issues.push(
        `narrative chunk ${c.id} references unknown brief change-group "${c.briefChangeGroupId}"`,
      );
    }
  }
  return issues;
}

/**
 * Validate a Brief's optional Reading order (ADR 0025): when present, it must
 * be an exact permutation of the Brief's change-group ids — each group
 * exactly once, no missing, no extra, no duplicates. Like `validatePartition`,
 * this is a warn-and-drop check, not a hard failure: an invalid or absent
 * order simply degrades to the Brief's structural (emission) order.
 */
export function validateReadingOrder(
  readingOrder: Pick<ReadingOrderStep, "groupId">[] | undefined,
  groups: Pick<ChangeGroup, "id">[],
): string[] {
  if (readingOrder === undefined) return [];

  const issues: string[] = [];
  const groupIds = new Set(groups.map((g) => g.id));
  const stepIds = readingOrder.map((s) => s.groupId);
  const seen = new Set<string>();

  for (const id of stepIds) {
    if (!groupIds.has(id)) {
      issues.push(`readingOrder references unknown group "${id}"`);
    }
    if (seen.has(id)) {
      issues.push(`readingOrder references group "${id}" more than once`);
    }
    seen.add(id);
  }

  for (const id of groupIds) {
    if (!seen.has(id)) {
      issues.push(`readingOrder is missing group "${id}"`);
    }
  }

  return issues;
}

/** Package-manifest basenames whose diffs can mechanically confirm `new-dependency`. */
const MANIFEST_BASENAMES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
]);

function isPackageManifest(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  return MANIFEST_BASENAMES.has(base);
}

/**
 * Best-effort dependency key from one manifest line (diff marker already
 * stripped). Covers the MANIFEST_BASENAMES formats; returns undefined for
 * lines that don't look like a dependency entry.
 */
function depKeyFromLine(content: string): string | undefined {
  const line = content.trim();
  // package.json / composer.json: "pkg": "^1.2.3"
  let m = /^"([^"]+)"\s*:\s*"/.exec(line);
  if (m) return m[1];
  // Gemfile: gem "name", "~> 1.0"
  m = /^gem\s+["']([^"']+)["']/.exec(line);
  if (m) return m[1];
  // pom.xml: <artifactId>foo</artifactId>
  m = /^<artifactId>([^<]+)<\/artifactId>/.exec(line);
  if (m) return m[1];
  // build.gradle: implementation 'group:name:version'
  m = /^\w+\s*[('"\s]+([\w.-]+:[\w.-]+)/.exec(line);
  if (m) return m[1];
  // go.mod: require example.com/x v1.2.3 (or bare inside a require block)
  m = /^(?:require\s+)?([\w.-]+(?:\/[\w.-]+)+)\s+v\d/.exec(line);
  if (m) return m[1];
  // pyproject.toml / Cargo.toml / requirements.txt: pkg = "1.2" | pkg==1.2
  m = /^([A-Za-z_][\w.-]*)\s*(?:==|>=|<=|~=|!=|=)/.exec(line);
  if (m) return m[1];
  return undefined;
}

/** Dependency keys found on one diff side (`+` added / `-` removed) of a patch. */
function depKeysOnSide(patch: string, marker: "+" | "-"): Set<string> {
  const keys = new Set<string>();
  const fileHeader = marker.repeat(3); // skip +++ / --- headers
  for (const raw of patch.split("\n")) {
    if (!raw.startsWith(marker) || raw.startsWith(fileHeader)) continue;
    const key = depKeyFromLine(raw.slice(1));
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

/**
 * Mechanically confirm `new-dependency` from a manifest file's own patch: an
 * added line introduces a dependency key that no removed line also carries.
 * Same key on both sides = a version bump — `lib-bump`/`dependency-update`
 * Category territory, not this attribute.
 */
function confirmsNewDependency(patch: string): boolean {
  const added = depKeysOnSide(patch, "+");
  const removed = depKeysOnSide(patch, "-");
  for (const key of added) {
    if (!removed.has(key)) return true;
  }
  return false;
}

/**
 * Validate the model-observed risk-attribute trio (ADR 0026) — warn-and-drop,
 * mirroring `validateReadingOrder`'s posture: drop the *attribute*, never the
 * chunk; each drop is a warn issue. Pure — returns sanitized copies, never
 * mutates the input.
 *
 * - `comment-contradicts-code` must carry a matching `riskNotes` citation
 *   (cite-or-stay-silent) → dropped without one.
 * - `new-dependency` must be mechanically confirmable from the chunk's own
 *   file patch: a package manifest whose diff adds a dependency key no
 *   removed line also carries → dropped otherwise.
 * - `new-abstraction` has no mechanical confirm (model-observed only).
 *
 * A dropped attribute's `riskNotes` entries go with it; everything else
 * passes through untouched.
 */
export function validateRiskAttrTrio<C extends Chunk>(
  chunks: C[],
  fileDiffs: Pick<FileDiff, "file" | "patch">[],
): { chunks: C[]; issues: string[] } {
  const issues: string[] = [];
  const patchByFile = new Map(fileDiffs.map((d) => [d.file, d.patch]));

  const sanitized = chunks.map((chunk) => {
    const drops = new Set<string>();

    if (chunk.riskSurface.includes("comment-contradicts-code")) {
      const hasCitation = (chunk.riskNotes ?? []).some(
        (n) => n.attr === "comment-contradicts-code" && n.note.trim() !== "",
      );
      if (!hasCitation) {
        drops.add("comment-contradicts-code");
        issues.push(
          `chunk ${chunk.id} (${chunk.file}): dropped comment-contradicts-code — no riskNotes citation`,
        );
      }
    }

    if (chunk.riskSurface.includes("new-dependency")) {
      if (!isPackageManifest(chunk.file)) {
        drops.add("new-dependency");
        issues.push(
          `chunk ${chunk.id} (${chunk.file}): dropped new-dependency — not a package manifest`,
        );
      } else {
        const patch = patchByFile.get(chunk.file);
        if (patch === undefined || !confirmsNewDependency(patch)) {
          drops.add("new-dependency");
          issues.push(
            `chunk ${chunk.id} (${chunk.file}): dropped new-dependency — diff adds no new dependency key (version bump or unconfirmed)`,
          );
        }
      }
    }

    if (drops.size === 0) return chunk;
    const riskSurface = chunk.riskSurface.filter((attr) => !drops.has(attr));
    const riskNotes = chunk.riskNotes?.filter((n) => !drops.has(n.attr));
    return {
      ...chunk,
      riskSurface,
      ...(riskNotes !== undefined && riskNotes.length > 0
        ? { riskNotes }
        : { riskNotes: undefined }),
    };
  });

  return { chunks: sanitized, issues };
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function anyOverlap(as: LineRange[], bs: LineRange[]): boolean {
  return as.some((a) => bs.some((b) => rangesOverlap(a, b)));
}

/**
 * Validate that each Revision-narrative chunk overlaps a mechanical
 * comparison mark for the same file (ADR 0024: "highlighting is mechanical;
 * generated narratives explain marks but never decide them" — coverage should
 * still line up). Compares added-side to added-side and removed-side to
 * removed-side, matching how the FE joins marks. Warn only. Typed against
 * `RevisionChangeFile` — structurally identical to a `ComparisonMarksFile`
 * (which aliases it), for either baseline label.
 */
export function validateNarrativeMarksOverlap(
  chunks: Pick<RevisionNarrativeChunk, "id" | "file" | "addedRanges" | "removedRanges">[],
  marksFiles: Pick<RevisionChangeFile, "file" | "addedRanges" | "removedRanges">[],
): string[] {
  const issues: string[] = [];
  for (const c of chunks) {
    const marksForFile = marksFiles.filter((m) => m.file === c.file);
    const overlaps =
      marksForFile.some((m) => anyOverlap(c.addedRanges, m.addedRanges)) ||
      marksForFile.some((m) => anyOverlap(c.removedRanges, m.removedRanges));
    if (!overlaps) {
      issues.push(
        `narrative chunk ${c.id} (${c.file}) does not overlap any mechanical comparison mark`,
      );
    }
  }
  return issues;
}
