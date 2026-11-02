import { dirname } from "node:path";
import type { z } from "zod/v4";
import {
  parseChangedRanges,
  TEXT_LENGTH_CAPS,
  TextSurfaces,
  type RevisionChangeFile,
} from "brief-core";
import {
  enumPreservingJsonSchema,
  type Effort,
  type GenerateRequest,
  type Generation,
  type Generator,
} from "generators";

const ANCHOR_BRIEF_FENCE = "<anchor_brief";
const ANCHOR_BRIEF_CLOSE = "</anchor_brief>";
const FROZEN_SECTION_HEADING = "### Frozen groups";
const ANCHOR_SECTION_BREAK = "\n\n### ";
const ANCHOR_GROUP_MARKER = "- ";
const ANCHOR_FILES_MARKER = "  files: ";
const ANCHOR_ATTRS_MARKER = "; attrs: ";
const ANCHOR_FILE_SEPARATOR = ", ";
const ANCHOR_NO_FILES = "(none)";
const UNIFIED_DIFF_HEADING = "\n## Unified diff\n";
const MAX_RANGES_PER_SIDE = 2;
const OVER_CAP_SUMMARY_LENGTH =
  TEXT_LENGTH_CAPS[TextSurfaces.GROUP_SUMMARY] + 1;
const SUMMARY_FILLER = " canned filler";
const UNKNOWN_GROUP_ID = "t-unknown";
const DEPARTED_FALLBACK_FILE = "packages/departed/src/gone.ts";
const DEPARTED_LINE = { start: 1, end: 1 };
const FLAGGED_RISK_TOKEN = "comment-contradicts-code";
const GROUPING_LABEL = "grouping";
export const DETAIL_LABEL_PREFIX = "detail:";
const PR_DIFF_OPEN = "<pr_diff>\n";
const PR_DIFF_CLOSE = "\n</pr_diff>";
const DIFF_FILE_HEADER = "diff --git ";
const OUTLINE_FILE_TITLE = /^### (f\d+) (\S+)/;
const DETAIL_HUNK_MARKER = /^\[hunk \S+ -> (\S+)\]$/;
const DETAIL_PLACEHOLDER_MARKER = /^\[hunk \S+ -> \S+\] /;

const NO_INTENT = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

export interface RecordedRequest {
  label: string;
  system: string;
  userPrefix?: string;
  user: string;
  wireSchema: Record<string, unknown>;
}

export interface CannedGenerator extends Generator {
  readonly requests: readonly RecordedRequest[];
}

type SynthesizeBrief = (user: string) => unknown;

interface DraftGroup {
  id: string;
  title: string;
  files: RevisionChangeFile[];
}

interface DraftChunk {
  groupId: string;
  file: RevisionChangeFile;
  role: string;
}

interface WireChunk {
  id: string;
  changeGroupId: string;
  file: string;
  concern: string;
  role: string;
  addedRanges: RevisionChangeFile["addedRanges"];
  removedRanges: RevisionChangeFile["removedRanges"];
  riskSurface: string[];
}

interface AnchorGroup {
  id: string;
  files: string[];
}

interface OutlineFile {
  id: string;
  path: string;
}

interface OutlineGroup {
  id: string;
  title: string;
  files: OutlineFile[];
}

interface DetailHunk {
  groupId: string;
  fileHeader: string[];
  lines: string[];
}

interface DetailScan {
  fileHeader: string[];
  current: DetailHunk | undefined;
  hunks: DetailHunk[];
}

interface AnchorView {
  frozen: AnchorGroup[];
  files: string[];
}

interface FilePool {
  byPath: ReadonlyMap<string, RevisionChangeFile>;
  free: RevisionChangeFile[];
  spent: Set<string>;
}

interface AdversarialDraft {
  groups: DraftGroup[];
  unknownGroupFile: RevisionChangeFile | undefined;
  freePaths: ReadonlySet<string>;
}

type FrozenIdUse = (frozen: AnchorGroup, pool: FilePool) => DraftGroup;

const FROZEN_ID_USES: readonly FrozenIdUse[] = [
  claimFrozenId,
  reEmitFrozenId,
  slipFrozenId,
];

/**
 * A recording stand-in for a model. Each request is answered with one group
 * per parent directory of the diff's changed files and one chunk per file
 * claiming at most two changed ranges per side; the first group's summary
 * runs one char past the cap so the length floor always fires. Anchored
 * requests mint t-prefixed group ids so the stitch decides the final ids.
 * A multi-call run's grouping call gets one group per parent directory of
 * the outline's files, each file assigned whole; a detail call gets one
 * chunk per hunk marker, in its marker's group.
 */
export function makeCannedGenerator(): CannedGenerator {
  return makeRecordingGenerator(synthesizeBrief);
}

/**
 * Fresh requests get the canned answer, so the plan matches the canned set.
 * An anchored answer spends each frozen id on a claim, a re-emit or a slip,
 * starting at `rotation`, then one free file on an unknown-group chunk and
 * one on no chunk at all; it also overlaps a free chunk, adds a chunk on a
 * file the PR no longer changes and anchors one intent item per group.
 */
export function makeAdversarialGenerator(rotation: number): CannedGenerator {
  return makeRecordingGenerator((user) =>
    synthesizeAdversarialBrief(user, rotation),
  );
}

function makeRecordingGenerator(answer: SynthesizeBrief): CannedGenerator {
  const requests: RecordedRequest[] = [];

  return {
    requests,
    origin(effort: Effort): Generation {
      return { provider: "canned", model: "canned-model", effort };
    },
    generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      const recorded: RecordedRequest = {
        label: req.label,
        system: req.system,
        user: req.user,
        wireSchema: enumPreservingJsonSchema(req.schema),
      };
      if (req.userPrefix !== undefined) {
        recorded.userPrefix = req.userPrefix;
      }
      requests.push(recorded);

      const output = req.schema.parse(answerRequest(req, answer));

      return Promise.resolve(output);
    },
  };
}

function answerRequest(
  req: Pick<GenerateRequest<z.ZodType>, "label" | "user">,
  answerBrief: SynthesizeBrief,
): unknown {
  if (req.label === GROUPING_LABEL) {
    return synthesizeGrouping(req.user);
  }
  if (req.label.startsWith(DETAIL_LABEL_PREFIX)) {
    return synthesizeDetail(req.user);
  }

  return answerBrief(req.user);
}

function sliceDiffBlock(user: string): string {
  const start = user.lastIndexOf(PR_DIFF_OPEN) + PR_DIFF_OPEN.length;

  return user.slice(start, user.indexOf(PR_DIFF_CLOSE, start));
}

function parseOutlineFiles(user: string): OutlineFile[] {
  return sliceDiffBlock(user)
    .split("\n")
    .flatMap((line) => {
      const title = OUTLINE_FILE_TITLE.exec(line);
      if (title === null) {
        return [];
      }
      const [, id = "", path = ""] = title;
      return [{ id, path }];
    });
}

/** An anchored request's new groups take `t` ids, so none collides with a carried `g` id. */
function readIdPrefix(user: string): string {
  return user.includes(ANCHOR_BRIEF_FENCE) ? "t" : "g";
}

function groupOutlineByDirectory(
  files: readonly OutlineFile[],
  idPrefix: string,
): OutlineGroup[] {
  const groups = new Map<string, OutlineFile[]>();
  for (const file of files) {
    const directory = dirname(file.path);
    groups.set(directory, [...(groups.get(directory) ?? []), file]);
  }

  return [...groups].map(([directory, members], index) => ({
    id: `${idPrefix}${index + 1}`,
    title: `Changes under ${directory}`,
    files: members,
  }));
}

function synthesizeGrouping(user: string): unknown {
  const files = parseOutlineFiles(user);
  const groups = groupOutlineByDirectory(files, readIdPrefix(user));
  const drafts = groups.map((group) => ({
    id: group.id,
    title: group.title,
    files: group.files.map((file) => ({
      file: file.path,
      addedRanges: [],
      removedRanges: [],
    })),
  }));

  return {
    summary: `Canned grouping over ${files.length} changed file(s).`,
    changeGroups: shapeChangeGroups(drafts),
    hunkMap: groups.map((group) => ({
      groupId: group.id,
      hunks: group.files.map((file) => file.id),
    })),
    readingOrder: shapeReadingOrder(groups.map((group) => group.id)),
    intentCheck: NO_INTENT,
  };
}

function closeDetailHunk(scan: DetailScan): void {
  if (scan.current !== undefined) {
    scan.hunks.push(scan.current);
  }
  scan.current = undefined;
}

/** A placeholder marker names a hunk with no text; it claims no line. */
function scanDetailLine(scan: DetailScan, line: string): void {
  if (line.startsWith(DIFF_FILE_HEADER)) {
    closeDetailHunk(scan);
    scan.fileHeader = [line];
    return;
  }
  const marker = DETAIL_HUNK_MARKER.exec(line);
  const opensHunk = marker !== null || DETAIL_PLACEHOLDER_MARKER.test(line);
  if (opensHunk) {
    closeDetailHunk(scan);
    const [, groupId] = marker ?? [];
    if (groupId !== undefined) {
      scan.current = { groupId, fileHeader: [...scan.fileHeader], lines: [] };
    }
    return;
  }

  if (scan.current === undefined) {
    scan.fileHeader.push(line);
  } else {
    scan.current.lines.push(line);
  }
}

function parseDetailHunks(user: string): DetailHunk[] {
  const scan: DetailScan = { fileHeader: [], current: undefined, hunks: [] };
  for (const line of sliceDiffBlock(user).split("\n")) {
    scanDetailLine(scan, line);
  }
  closeDetailHunk(scan);

  return scan.hunks;
}

function synthesizeDetail(user: string): unknown {
  const drafts = parseDetailHunks(user).flatMap((hunk) => {
    const patch = [...hunk.fileHeader, ...hunk.lines].join("\n");
    return parseChangedRanges(patch).map((file) => ({
      groupId: hunk.groupId,
      file,
      role: "core",
    }));
  });

  return { chunks: shapeChunks(drafts) };
}

function synthesizeBrief(user: string): unknown {
  const groups = groupByDirectory(parseDiffFiles(user), readIdPrefix(user));
  const chunks = shapeChunks(groups.flatMap(draftCoreChunks));

  return {
    summary: `Canned brief over ${chunks.length} changed file(s).`,
    changeGroups: shapeChangeGroups(groups),
    chunks,
    readingOrder: shapeReadingOrder(groups.map((group) => group.id)),
    intentCheck: NO_INTENT,
  };
}

function synthesizeAdversarialBrief(user: string, rotation: number): unknown {
  if (!user.includes(ANCHOR_BRIEF_FENCE)) {
    return synthesizeBrief(user);
  }

  const anchor = parseAnchorView(user);
  const draft = draftAdversarialGroups(parseDiffFiles(user), anchor, rotation);
  const chunks = shapeChunks(draftAdversarialChunks(draft));
  const [flagged] = chunks;
  if (flagged !== undefined) {
    flagged.riskSurface = [FLAGGED_RISK_TOKEN];
  }

  const groupIds = draft.groups.map((group) => group.id);
  const frozenIds = anchor.frozen.map((group) => group.id);
  const orderedIds = [...new Set([...groupIds, ...frozenIds])];

  return {
    summary: `Canned adversarial brief over ${chunks.length} chunk(s).`,
    changeGroups: shapeChangeGroups(draft.groups),
    chunks,
    readingOrder: shapeReadingOrder(orderedIds),
    intentCheck: {
      ...NO_INTENT,
      specificity: "precise",
      items: groupIds.map(shapeUnstatedIntentItem),
    },
  };
}

function parseDiffFiles(user: string): RevisionChangeFile[] {
  const diffStart =
    user.lastIndexOf(UNIFIED_DIFF_HEADING) + UNIFIED_DIFF_HEADING.length;

  return parseChangedRanges(user.slice(diffStart));
}

function parseAnchorView(user: string): AnchorView {
  const anchorStart = user.indexOf(ANCHOR_BRIEF_FENCE);
  const anchor = user.slice(
    anchorStart,
    user.indexOf(ANCHOR_BRIEF_CLOSE, anchorStart),
  );
  const frozenStart = anchor.indexOf(FROZEN_SECTION_HEADING);
  const frozenEnd = anchor.indexOf(ANCHOR_SECTION_BREAK, frozenStart);

  return {
    frozen: parseAnchorGroups(anchor.slice(frozenStart, frozenEnd)),
    files: parseAnchorGroups(anchor).flatMap((group) => group.files),
  };
}

function parseAnchorGroups(section: string): AnchorGroup[] {
  const groups: AnchorGroup[] = [];
  for (const line of section.split("\n")) {
    const current = groups.at(-1);
    if (line.startsWith(ANCHOR_GROUP_MARKER)) {
      const [id = ""] = line.slice(ANCHOR_GROUP_MARKER.length).split(" ");
      groups.push({ id, files: [] });
    } else if (line.startsWith(ANCHOR_FILES_MARKER) && current !== undefined) {
      current.files.push(...parseAnchorFiles(line));
    }
  }

  return groups;
}

function parseAnchorFiles(line: string): string[] {
  const [listed = ""] = line
    .slice(ANCHOR_FILES_MARKER.length)
    .split(ANCHOR_ATTRS_MARKER);
  if (listed === ANCHOR_NO_FILES) {
    return [];
  }

  return listed.split(ANCHOR_FILE_SEPARATOR);
}

function draftAdversarialGroups(
  files: readonly RevisionChangeFile[],
  anchor: AnchorView,
  rotation: number,
): AdversarialDraft {
  const frozenPaths = new Set(anchor.frozen.flatMap((group) => group.files));
  const pool: FilePool = {
    byPath: new Map(files.map((file) => [file.file, file])),
    free: files.filter((file) => !frozenPaths.has(file.file)),
    spent: new Set(),
  };
  const freePaths = new Set(pool.free.map((file) => file.file));

  const frozenGroups = anchor.frozen.map((frozen, index) => {
    const useIndex = (rotation + index) % FROZEN_ID_USES.length;
    const use = FROZEN_ID_USES[useIndex] ?? reEmitFrozenId;
    return use(frozen, pool);
  });
  const unknownGroupFile = spendExtraFiles(pool, rotation);

  const remaining = files.filter((file) => !pool.spent.has(file.file));
  const directoryGroups = groupByDirectory(remaining, "t");
  const departedGroup: DraftGroup = {
    id: `t${directoryGroups.length + 1}`,
    title: "Departed file",
    files: [shapeDepartedFile(anchor, files)],
  };

  return {
    groups: [...frozenGroups, ...directoryGroups, departedGroup],
    unknownGroupFile,
    freePaths,
  };
}

function claimFrozenId(frozen: AnchorGroup, pool: FilePool): DraftGroup {
  const newFile = pool.free.shift();
  if (newFile === undefined) {
    return reEmitFrozenId(frozen, pool);
  }

  const files = [...lookupFiles(pool, frozen.files), newFile];
  return spendGroup(pool, {
    id: frozen.id,
    title: `Claims ${frozen.id}`,
    files,
  });
}

function reEmitFrozenId(frozen: AnchorGroup, pool: FilePool): DraftGroup {
  const files = lookupFiles(pool, frozen.files);

  return spendGroup(pool, {
    id: frozen.id,
    title: `Re-emits ${frozen.id}`,
    files,
  });
}

function slipFrozenId(frozen: AnchorGroup, pool: FilePool): DraftGroup {
  const strayFile = pool.free.shift();
  if (strayFile === undefined) {
    return reEmitFrozenId(frozen, pool);
  }

  const files = [strayFile];
  return spendGroup(pool, {
    id: frozen.id,
    title: `Reuses ${frozen.id}`,
    files,
  });
}

function lookupFiles(
  pool: FilePool,
  paths: readonly string[],
): RevisionChangeFile[] {
  return paths.flatMap((path) => {
    const file = pool.byPath.get(path);
    return file === undefined ? [] : [file];
  });
}

function spendGroup(pool: FilePool, group: DraftGroup): DraftGroup {
  for (const file of group.files) {
    pool.spent.add(file.file);
  }

  return group;
}

/** Even rotations spend the first free file on the unknown group, odd ones leave it out. */
function spendExtraFiles(
  pool: FilePool,
  rotation: number,
): RevisionChangeFile | undefined {
  const leftOutIndex = rotation % 2 === 0 ? 1 : 0;
  const leftOut = pool.free.splice(leftOutIndex, 1);
  const unknownGroupFile = pool.free.shift();

  for (const file of leftOut) {
    pool.spent.add(file.file);
  }
  if (unknownGroupFile !== undefined) {
    pool.spent.add(unknownGroupFile.file);
  }

  return unknownGroupFile;
}

function shapeDepartedFile(
  anchor: AnchorView,
  files: readonly RevisionChangeFile[],
): RevisionChangeFile {
  const current = new Set(files.map((file) => file.file));
  const departed =
    anchor.files.find((path) => !current.has(path)) ?? DEPARTED_FALLBACK_FILE;

  return { file: departed, addedRanges: [DEPARTED_LINE], removedRanges: [] };
}

function draftAdversarialChunks(draft: AdversarialDraft): DraftChunk[] {
  const chunks = draft.groups.flatMap(draftCoreChunks);
  if (draft.unknownGroupFile !== undefined) {
    chunks.push({
      groupId: UNKNOWN_GROUP_ID,
      file: draft.unknownGroupFile,
      role: "core",
    });
  }

  const overlapped = chunks.find((chunk) =>
    draft.freePaths.has(chunk.file.file),
  );
  if (overlapped !== undefined) {
    chunks.push({ ...overlapped, role: "supporting" });
  }

  return chunks;
}

function draftCoreChunks(group: DraftGroup): DraftChunk[] {
  return group.files.map((file) => ({ groupId: group.id, file, role: "core" }));
}

function shapeChunks(drafts: readonly DraftChunk[]): WireChunk[] {
  return drafts.map(({ groupId, file, role }, index) => ({
    id: `c${index + 1}`,
    changeGroupId: groupId,
    file: file.file,
    concern: "implementation",
    role,
    addedRanges: file.addedRanges.slice(0, MAX_RANGES_PER_SIDE),
    removedRanges: file.removedRanges.slice(0, MAX_RANGES_PER_SIDE),
    riskSurface: [],
  }));
}

function shapeChangeGroups(groups: readonly DraftGroup[]): unknown[] {
  return groups.map((group, index) => ({
    id: group.id,
    title: group.title,
    summary: shapeGroupSummary(group, index === 0),
    dominantCategory: "logic-refactor",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  }));
}

function shapeReadingOrder(groupIds: readonly string[]): unknown[] {
  return groupIds.map((groupId) => ({
    groupId,
    why: "follows the diff order",
  }));
}

function shapeUnstatedIntentItem(groupId: string): unknown {
  return {
    bucket: "doneButUnstated",
    intent: `Canned unstated work in ${groupId}`,
    quote: "",
    sourceUrl: "",
    groupIds: [groupId],
    acknowledged: false,
  };
}

function groupByDirectory(
  files: readonly RevisionChangeFile[],
  idPrefix: string,
): DraftGroup[] {
  const groups = new Map<string, RevisionChangeFile[]>();
  for (const file of files) {
    const directory = dirname(file.file);
    groups.set(directory, [...(groups.get(directory) ?? []), file]);
  }

  return [...groups].map(([directory, members], index) => ({
    id: `${idPrefix}${index + 1}`,
    title: `Changes under ${directory}`,
    files: members,
  }));
}

function shapeGroupSummary(group: DraftGroup, overCap: boolean): string {
  const summary = `Touches ${group.files.map((file) => file.file).join(", ")}.`;
  if (!overCap) {
    return summary;
  }

  return summary.padEnd(OVER_CAP_SUMMARY_LENGTH, SUMMARY_FILLER);
}
