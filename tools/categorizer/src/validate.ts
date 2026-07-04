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

type ManifestFormat =
  | "json"
  | "toml"
  | "requirements"
  | "gomod"
  | "gemfile"
  | "pom"
  | "gradle";

/** Manifest basenames whose diffs can mechanically confirm `new-dependency`. */
const MANIFEST_FORMATS = new Map<string, ManifestFormat>([
  ["package.json", "json"],
  ["composer.json", "json"],
  ["pyproject.toml", "toml"],
  ["Cargo.toml", "toml"],
  ["requirements.txt", "requirements"],
  ["go.mod", "gomod"],
  ["Gemfile", "gemfile"],
  ["pom.xml", "pom"],
  ["build.gradle", "gradle"],
]);

function manifestFormat(file: string): ManifestFormat | undefined {
  const base = file.split("/").pop() ?? file;
  return MANIFEST_FORMATS.get(base);
}

/** JSON object keys whose members are dependency entries. */
const JSON_DEP_SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "require", // composer.json
  "require-dev",
]);

/** Top-level JSON keys that can carry a version-shaped value but are not deps. */
const JSON_NON_DEP_KEYS = new Set([
  "name",
  "version",
  "description",
  "license",
  "type",
  "main",
  "module",
  "types",
  "packageManager",
]);

/** [package]/[project] metadata keys that are never dependency entries. */
const TOML_NON_DEP_KEYS = new Set([
  "name",
  "version",
  "edition",
  "authors",
  "description",
  "license",
  "readme",
  "repository",
  "homepage",
  "documentation",
  "keywords",
  "categories",
  "publish",
  "rust-version",
  "requires-python",
  "dynamic",
]);

/** A value that looks like a version/range/source spec rather than prose. */
const VERSION_SHAPED =
  /^(?:[\^~]|[<>]=?|==?|\d|\*|workspace:|npm:|file:|link:|git\+|git:|https?:\/\/)/;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Section context visible in the patch when a candidate line is scanned. */
interface SectionContext {
  /** nearest enclosing JSON object key, when its opener is visible */
  jsonSection: string | undefined;
  /** current TOML table header, when visible */
  tomlTable: string | undefined;
  /** inside a <dependency>/<dependencies> element (pom.xml) */
  inPomDependencies: boolean;
}

/**
 * Best-effort dependency key from one manifest line (diff marker already
 * stripped), format-dispatched and section-aware. When the enclosing section
 * is visible in the patch, only known dependency sections count; when it
 * isn't (the common case — the header sits outside the hunk context), a
 * value-shape check plus a non-dep-key blocklist keeps metadata fields
 * (`"lint": "oxlint …"`, `edition = "2021"`) from confirming.
 */
function depKeyFromLine(
  content: string,
  format: ManifestFormat,
  ctx: SectionContext,
): string | undefined {
  switch (format) {
    case "json": {
      const m = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(content);
      if (!m) return undefined;
      const key = m[1] ?? "";
      const value = m[2] ?? "";
      if (ctx.jsonSection !== undefined) {
        return JSON_DEP_SECTIONS.has(ctx.jsonSection) ? key : undefined;
      }
      return VERSION_SHAPED.test(value) && !JSON_NON_DEP_KEYS.has(key)
        ? key
        : undefined;
    }
    case "toml": {
      const m = /^([A-Za-z_][\w.-]*)\s*=\s*(.+)$/.exec(content.trim());
      if (!m) return undefined;
      const key = m[1] ?? "";
      const value = m[2] ?? "";
      if (ctx.tomlTable !== undefined) {
        return ctx.tomlTable.includes("dependencies") ? key : undefined;
      }
      if (TOML_NON_DEP_KEYS.has(key)) return undefined;
      const quoted = /^"([^"]*)"/.exec(value);
      if (quoted) return VERSION_SHAPED.test(quoted[1] ?? "") ? key : undefined;
      // inline table: serde = { version = "1.0", … } / { path = … } / { git = … }
      return /^\{.*\b(?:version|path|git|workspace)\s*=/.test(value)
        ? key
        : undefined;
    }
    case "requirements": {
      const line = content.trim();
      if (line === "" || line.startsWith("#") || line.startsWith("-")) {
        return undefined;
      }
      const m = /^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(?:[=<>!~;@ ]|$)/.exec(line);
      return m?.[1];
    }
    case "gomod": {
      const m = /^\s*(?:require\s+)?([\w.-]+(?:\/[\w.-]+)+)\s+v\d/.exec(content);
      return m?.[1];
    }
    case "gemfile": {
      const m = /^\s*gem\s+["']([^"']+)["']/.exec(content);
      return m?.[1];
    }
    case "pom": {
      if (!ctx.inPomDependencies) return undefined;
      const m = /<artifactId>([^<]+)<\/artifactId>/.exec(content);
      return m?.[1];
    }
    case "gradle": {
      const m =
        /^\s*(?:implementation|api|compileOnly|compile|runtimeOnly|runtime|testImplementation|testCompile|testRuntimeOnly|annotationProcessor|kapt|classpath|developmentOnly)\b.*?["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/.exec(
          content,
        );
      return m?.[1];
    }
  }
}

/** A dependency entry found on one diff side, with its side-local line number. */
interface DepEntry {
  key: string;
  /** new-side line number for "added", old-side for "removed" */
  line: number;
}

/**
 * Scan one side of a file patch for dependency entries. The side's "file
 * view" (context lines + that side's changed lines) drives both the line
 * counter — from each `@@` hunk header — and the section tracking, so a
 * `"scripts": {` opener in context correctly reclassifies the lines under it.
 */
function collectDepEntries(
  patch: string,
  side: "added" | "removed",
  format: ManifestFormat,
): DepEntry[] {
  const entries: DepEntry[] = [];
  const changedMarker = side === "added" ? "+" : "-";
  const oppositeMarker = side === "added" ? "-" : "+";
  let lineNo = 0;
  let jsonSection: { name: string; indent: number } | undefined;
  let tomlTable: string | undefined;
  let inPomDependencies = false;

  for (const raw of patch.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      lineNo = Number(side === "added" ? hunk[2] : hunk[1]);
      continue;
    }
    if (
      raw.startsWith("+++ ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("\\")
    ) {
      continue;
    }
    const marker = raw === "" ? " " : raw[0];
    if (marker === oppositeMarker) continue;
    if (marker !== " " && marker !== changedMarker) continue;
    const content = raw.slice(1);

    if (format === "json") {
      const open = /^(\s*)"([^"]+)"\s*:\s*\{/.exec(content);
      if (open) {
        jsonSection = { name: open[2] ?? "", indent: (open[1] ?? "").length };
      } else if (jsonSection !== undefined && /^\s*[}\]]/.test(content)) {
        const indent = content.length - content.trimStart().length;
        if (indent <= jsonSection.indent) jsonSection = undefined;
      }
    } else if (format === "toml") {
      const table = /^\s*\[+([^\]]+)\]/.exec(content);
      if (table) tomlTable = table[1];
    } else if (format === "pom") {
      if (/<dependenc(?:y|ies)>/.test(content)) inPomDependencies = true;
      if (/<\/dependenc(?:y|ies)>/.test(content)) inPomDependencies = false;
    }

    if (marker === changedMarker) {
      const key = depKeyFromLine(content, format, {
        jsonSection: jsonSection?.name,
        tomlTable,
        inPomDependencies,
      });
      if (key !== undefined) entries.push({ key, line: lineNo });
    }
    lineNo++;
  }
  return entries;
}

/**
 * Mechanically confirm `new-dependency` for ONE chunk: an added line inside
 * the chunk's own `addedRanges` introduces a dependency key that no removed
 * line in the file also carries. Same key on both sides = a version bump —
 * `lib-bump`/`dependency-update` Category territory, not this attribute.
 * Chunk-scoped so a real dependency added elsewhere in the manifest never
 * confirms an unrelated chunk's flag.
 */
function confirmsNewDependency(
  patch: string,
  format: ManifestFormat,
  addedRanges: LineRange[],
): boolean {
  const added = collectDepEntries(patch, "added", format);
  const removed = new Set(
    collectDepEntries(patch, "removed", format).map((e) => e.key),
  );
  return added.some(
    (e) =>
      !removed.has(e.key) &&
      addedRanges.some((r) => e.line >= r.start && e.line <= r.end),
  );
}

/**
 * Validate model-observed risk attributes — warn-and-drop, mirroring
 * `validateReadingOrder`'s posture: drop the *attribute*, never the chunk;
 * each drop is a warn issue. Pure — returns sanitized copies, never mutates
 * the input.
 *
 * - `comment-contradicts-code` must carry a matching `riskNotes` citation
 *   (cite-or-stay-silent, ADR 0026) → dropped without one.
 * - `new-dependency` must be mechanically confirmable from the chunk's own
 *   added lines: a package manifest whose patch adds a dependency entry
 *   (section-aware — metadata fields don't count) inside this chunk's
 *   `addedRanges`, with a key no removed line also carries → dropped
 *   otherwise.
 * - `removes-validation` requires the chunk to actually remove lines: a
 *   purely additive chunk (empty `removedRanges`) can't have deleted a
 *   check. Deliberate trade: an added early-return CAN weaken a guard
 *   without deleting lines, but that shape is rare and this drops the
 *   observed FP class ("parser accepts a new optional field" ≠ weakened
 *   validation).
 * - `new-abstraction` has no mechanical confirm (model-observed only).
 *
 * A dropped attribute's `riskNotes` entries go with it; everything else
 * passes through untouched.
 */
export function validateRiskAttributes<C extends Chunk>(
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

    if (
      chunk.riskSurface.includes("removes-validation") &&
      chunk.removedRanges.length === 0
    ) {
      drops.add("removes-validation");
      issues.push(
        `chunk ${chunk.id} (${chunk.file}): dropped removes-validation — chunk removes no lines`,
      );
    }

    if (chunk.riskSurface.includes("new-dependency")) {
      const format = manifestFormat(chunk.file);
      if (format === undefined) {
        drops.add("new-dependency");
        issues.push(
          `chunk ${chunk.id} (${chunk.file}): dropped new-dependency — not a package manifest`,
        );
      } else {
        const patch = patchByFile.get(chunk.file);
        if (
          patch === undefined ||
          !confirmsNewDependency(patch, format, chunk.addedRanges)
        ) {
          drops.add("new-dependency");
          issues.push(
            `chunk ${chunk.id} (${chunk.file}): dropped new-dependency — no new dependency key inside this chunk's added lines (version bump, non-dependency field, or unconfirmed)`,
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
