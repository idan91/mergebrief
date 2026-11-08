import type { FileDiff } from "../diff/file-diff";
import { HUNK_HEADER } from "../diff/chunk-layout/consts";
import { REMOVED_TAG_MARK } from "./fences";
import {
  inAttributeScope,
  type CustomRiskAttributeInput,
} from "./repo-context";
import type { RevisionChangeFile } from "../diff/revchanges";
import {
  TextSurfaces,
  RiskSurfaceAttributes,
  type ChangeGroup,
  type LengthViolation,
  type TextSurface,
  type Chunk,
  type IntentBucket,
  type IntentCheck,
  type TicketAlignment,
  type IntentCheckGeneration,
  type IntentItem,
  type LineRange,
  type ReadingOrderStep,
  type RevisionNarrativeChunk,
} from "../types";

/**
 * Required changeGroupId prevents duplicate memberships structurally. Check dangling
 * references and empty/coreless groups here; an empty issue list means clean.
 */
export function validatePartition(
  groups: Pick<ChangeGroup, "id">[],
  chunks: Pick<Chunk, "id" | "changeGroupId" | "role">[],
): string[] {
  const issues: string[] = [];
  const groupIds = new Set(groups.map((g) => g.id));

  for (const c of chunks) {
    if (!groupIds.has(c.changeGroupId)) {
      issues.push(
        `chunk ${c.id} references unknown group "${c.changeGroupId}"`,
      );
    }
  }

  for (const g of groups) {
    const members = chunks.filter((c) => c.changeGroupId === g.id);
    if (members.length === 0) {
      issues.push(`group ${g.id} has no chunks`);
    } else if (!members.some((c) => c.role === "core")) {
      issues.push(`group ${g.id} has no core chunk`);
    }
  }

  return issues;
}

export interface CheckedChunks<C> {
  chunks: C[];
  issues: string[];
}

/**
 * A chunk naming no group in the final set has no owner to render under, so
 * it leaves the chunk set and its lines fall into the unattributed remainder.
 */
export function dropUnknownGroupChunks<
  C extends Pick<Chunk, "id" | "file" | "changeGroupId">,
>(
  groups: readonly Pick<ChangeGroup, "id">[],
  chunks: readonly C[],
): CheckedChunks<C> {
  const groupIds = new Set(groups.map((group) => group.id));
  const issues: string[] = [];

  const known = chunks.filter((chunk) => {
    if (groupIds.has(chunk.changeGroupId)) {
      return true;
    }
    issues.push(
      `chunk ${chunk.id} (${chunk.file}) names unknown group "${chunk.changeGroupId}", dropped to the unattributed remainder`,
    );
    return false;
  });

  return { chunks: known, issues };
}

/**
 * Narrative and brief are independent model outputs, so references may dangle.
 * Warn rather than fail: only schema validity hard-fails a narrative.
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
 * Validate a Brief's optional reading order: when present it must be an exact
 * permutation of the Brief's change-group ids. Warn-and-drop, not a hard
 * failure, an invalid order degrades to the Brief's emission order.
 */
export function validateReadingOrder(
  readingOrder: Pick<ReadingOrderStep, "groupId">[] | undefined,
  groups: Pick<ChangeGroup, "id">[],
  /**
   * Frozen groups are withheld from the model's output but their ids are live
   * anchors, the contract demands the whole ordering, so they join both the
   * known-id set and the required set.
   */
  carriedGroupIds: readonly string[] = [],
): string[] {
  if (readingOrder === undefined) {
    return [];
  }

  const issues: string[] = [];
  const groupIds = new Set([...groups.map((g) => g.id), ...carriedGroupIds]);
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

/**
 * One intent-source origin the quote check can verify against: the PR
 * title/description composite rides as `url: ""`, fetched linked context as
 * its URL, mirroring the `sourceUrl` convention on the schema.
 */
export interface IntentSource {
  url: string;
  content: string;
}

/** Drop removed-tag marks and collapse whitespace runs for the quote substring check. */
function normalizeQuoteText(text: string): string {
  return text.replaceAll(REMOVED_TAG_MARK, "").replace(/\s+/g, " ").trim();
}

/**
 * Minimum words for an alarm-bucket quote to count as verified: below this the
 * substring check stops discriminating, a generic fragment appears in almost
 * any source text, so it cannot ground an alarm.
 */
const ALARM_QUOTE_MIN_WORDS = 5;

/** A ticket's goal line is often a short clause ("Add a CopyButton component"); the alarm floor would drop it. */
const ALIGNMENT_GOAL_MIN_WORDS = 3;

/**
 * Grammar budgets require one tagged wire array; storage retains five buckets.
 * Dispatch before validateIntentCheck so per-bucket checks see the stored shape.
 */
export function fanOutIntentCheck(
  generated: IntentCheckGeneration,
): IntentCheck {
  const buckets: Record<IntentBucket, IntentItem[]> = {
    accomplished: [],
    statedButMissing: [],
    doneButUnstated: [],
    deviations: [],
    maskedFixes: [],
  };
  for (const { bucket, ...item } of generated.items) {
    buckets[bucket].push(item);
  }
  const intentCheck: IntentCheck = {
    ticketUrls: generated.ticketUrls,
    ticketTitles: generated.ticketTitles,
    specificity: generated.specificity,
    scopeNote: generated.scopeNote,
    ...buckets,
  };
  // "" on `read` is the wire's no-read sentinel; the stored shape is absence.
  const { read, goal, response } = generated.alignment;
  if (read !== "") {
    intentCheck.alignment = { read, goal, response };
  }
  return intentCheck;
}

/**
 * Align titles to urls (pad ""/truncate, warn on mismatch), then drop the
 * pairs whose url the harness never injected, url and title move together.
 */
function resolveTicketPairs(
  intentCheck: IntentCheck,
  injectedUrls: readonly string[],
  issues: string[],
): { ticketUrls: string[]; ticketTitles: string[] } {
  const { ticketUrls, ticketTitles } = intentCheck;

  if (ticketTitles.length !== ticketUrls.length) {
    issues.push(
      `intent check ticketTitles length ${ticketTitles.length} does not match ticketUrls length ${ticketUrls.length} — aligned`,
    );
  }

  const pairs = ticketUrls
    .map((url, index) => ({ url, title: ticketTitles[index] ?? "" }))
    .filter((pair) => {
      if (injectedUrls.includes(pair.url)) {
        return true;
      }
      issues.push(
        `intent check cites un-injected ticket URL "${pair.url}" — dropped`,
      );
      return false;
    });

  return {
    ticketUrls: pairs.map((pair) => pair.url),
    ticketTitles: pairs.map((pair) => pair.title),
  };
}

/** What the alignment rules need to know about the primary ticket. */
export interface PrimaryTicketFacts {
  /** The corpus URL the goal must be quoted from. */
  readonly url: string;
  readonly read: boolean;
}

/**
 * Why an alignment read cannot stand, or undefined when it verifies: the
 * primary must have been read, and the goal quote must be a substring of
 * its injected text, whitespace-normalized, at least the minimum words.
 */
function findAlignmentDefect(
  alignment: TicketAlignment,
  primary: PrimaryTicketFacts | undefined,
  contentByUrl: ReadonlyMap<string, string>,
): string | undefined {
  if (primary === undefined) {
    return "no primary ticket";
  }
  if (!primary.read) {
    return "the primary ticket was not read";
  }

  const goal = normalizeQuoteText(alignment.goal);
  if (goal === "") {
    return "empty goal quote";
  }
  if (goal.split(" ").length < ALIGNMENT_GOAL_MIN_WORDS) {
    return `goal quote shorter than ${ALIGNMENT_GOAL_MIN_WORDS} words`;
  }

  const ticketText = contentByUrl.get(primary.url) ?? "";
  if (!ticketText.includes(goal)) {
    return "goal quote not found in the primary ticket (whitespace-normalized)";
  }
  return undefined;
}

/**
 * The alignment read is shown as a bare word, so an ungrounded one is
 * alarm-tier risk: it drops whole, with its defect on the issues list.
 */
function verifyAlignment(
  alignment: IntentCheck["alignment"],
  primary: PrimaryTicketFacts | undefined,
  contentByUrl: ReadonlyMap<string, string>,
  issues: string[],
): IntentCheck["alignment"] {
  if (alignment === undefined) {
    return undefined;
  }

  const defect = findAlignmentDefect(alignment, primary, contentByUrl);
  if (defect === undefined) {
    return alignment;
  }

  issues.push(`alignment read "${alignment.read}" dropped — ${defect}`);
  return undefined;
}

/**
 * Return sanitized copies with warnings, never mutate input or infer broad/none gaps.
 * Ticket sources must have been injected; dangling ids cannot ground unstated work.
 * Neutral quote failures warn and keep, while alarms require verified source and diff
 * grounding or drop: a fabricated alarm costs more than a miss.
 */
export function validateIntentCheck(
  intentCheck: IntentCheck,
  changeGroups: Pick<ChangeGroup, "id">[],
  injectedUrls: readonly string[],
  fetchedContent: readonly IntentSource[],
  /** Frozen group ids are live anchors, never pruned as unknown; the stitch
   * re-verifies against the merged brief. */
  carriedGroupIds: readonly string[] = [],
  primary?: PrimaryTicketFacts,
): { intentCheck: IntentCheck; issues: string[] } {
  const issues: string[] = [];

  if (intentCheck.specificity !== "precise") {
    const counts =
      intentCheck.accomplished.length +
      intentCheck.statedButMissing.length +
      intentCheck.doneButUnstated.length +
      intentCheck.deviations.length +
      intentCheck.maskedFixes.length;
    if (counts > 0) {
      issues.push(
        `intent check is ${intentCheck.specificity} but carries ${counts} bucket item(s) — buckets emptied (never a guessed gap)`,
      );
    }
    // ticketUrls membership still holds on the unavailable path.
    const knownPairs = resolveTicketPairs(intentCheck, injectedUrls, issues);
    if (intentCheck.alignment !== undefined) {
      issues.push(
        `alignment read "${intentCheck.alignment.read}" dropped — intent check is ${intentCheck.specificity}`,
      );
    }
    const { alignment: _dropped, ...unavailable } = intentCheck;
    return {
      intentCheck: {
        ...unavailable,
        ...knownPairs,
        accomplished: [],
        statedButMissing: [],
        doneButUnstated: [],
        deviations: [],
        maskedFixes: [],
      },
      issues,
    };
  }

  const { ticketUrls, ticketTitles } = resolveTicketPairs(
    intentCheck,
    injectedUrls,
    issues,
  );
  const allowedSources = new Set(["", ...ticketUrls]);
  const contentByUrl = new Map(
    fetchedContent.map((s) => [s.url, normalizeQuoteText(s.content)]),
  );
  const groupIds = new Set([
    ...changeGroups.map((g) => g.id),
    ...carriedGroupIds,
  ]);

  function keepSource(
    bucket: string,
    item: { intent: string; sourceUrl: string },
  ): boolean {
    if (allowedSources.has(item.sourceUrl)) {
      return true;
    }
    issues.push(
      `${bucket} item "${item.intent}" cites unknown source "${item.sourceUrl}" — dropped`,
    );
    return false;
  }

  function checkQuote(
    bucket: string,
    item: { intent: string; quote: string; sourceUrl: string },
  ): void {
    const quote = normalizeQuoteText(item.quote);
    if (quote === "") {
      // Ticket-side buckets demand a verbatim citation; an empty quote is an
      // uncited stated ask. Warn-only, same posture as the substring check.
      issues.push(
        `${bucket} item "${item.intent}": empty quote — uncited stated ask`,
      );
      return;
    }
    const source = contentByUrl.get(item.sourceUrl);
    if (source === undefined) {
      issues.push(
        `${bucket} item "${item.intent}": no fetched content for source "${item.sourceUrl}" — quote unverified`,
      );
      return;
    }
    if (!source.includes(quote)) {
      issues.push(
        `${bucket} item "${item.intent}": quote not found in its source (whitespace-normalized) — possible fabrication`,
      );
    }
  }

  function pruneGroups(bucket: string, label: string, ids: string[]): string[] {
    return ids.filter((id) => {
      if (groupIds.has(id)) {
        return true;
      }
      issues.push(
        `${bucket} item "${label}" references unknown group "${id}" — pruned`,
      );
      return false;
    });
  }

  /**
   * `acknowledged` is meaningful only in `deviations`; anywhere else `true` is
   * forced back to `false` + warn, the item shape is shared across buckets.
   */
  function forceUnacknowledged<
    T extends { intent: string; acknowledged: boolean },
  >(bucket: string, item: T): T {
    if (!item.acknowledged) {
      return item;
    }
    issues.push(
      `${bucket} item "${item.intent}" carries acknowledged=true — forced false (meaningful only in deviations)`,
    );
    return { ...item, acknowledged: false };
  }

  /**
   * Alarm quotes need non-empty, sufficiently specific source substrings after whitespace
   * normalization. The word floor prevents generic fragments from laundering fabricated alarms;
   * neutral buckets instead warn and keep.
   */
  function quoteVerifies(
    bucket: string,
    item: { intent: string; quote: string; sourceUrl: string },
  ): boolean {
    const quote = normalizeQuoteText(item.quote);
    if (quote === "") {
      issues.push(
        `${bucket} item "${item.intent}": empty quote — dropped (alarm buckets require verified grounding)`,
      );
      return false;
    }
    if (quote.split(" ").length < ALARM_QUOTE_MIN_WORDS) {
      issues.push(
        `${bucket} item "${item.intent}": quote too short to verify (< ${ALARM_QUOTE_MIN_WORDS} words) — dropped (a bare fragment matches almost any source)`,
      );
      return false;
    }
    const source = contentByUrl.get(item.sourceUrl);
    if (source === undefined) {
      issues.push(
        `${bucket} item "${item.intent}": no fetched content for source "${item.sourceUrl}" — dropped (alarm quote unverifiable)`,
      );
      return false;
    }
    if (!source.includes(quote)) {
      issues.push(
        `${bucket} item "${item.intent}": quote not found in its source (whitespace-normalized) — dropped (possible fabrication)`,
      );
      return false;
    }
    return true;
  }

  /** Drop-not-warn sanitation shared by both alarm buckets (rule 6). */
  function sanitizeAlarmBucket(
    bucket: "deviations" | "maskedFixes",
    items: IntentCheck["deviations"],
  ): IntentCheck["deviations"] {
    return items
      .filter((item) => keepSource(bucket, item))
      .filter((item) => quoteVerifies(bucket, item))
      .map((item) => ({
        ...item,
        groupIds: pruneGroups(bucket, item.intent, item.groupIds),
      }))
      .filter((item) => {
        if (item.groupIds.length > 0) {
          return true;
        }
        issues.push(
          `${bucket} item "${item.intent}" has no valid group anchor — dropped (both-sides grounding required)`,
        );
        return false;
      });
  }

  const accomplished = intentCheck.accomplished
    .filter((item) => keepSource("accomplished", item))
    .map((item) => {
      checkQuote("accomplished", item);
      const prunedIds = pruneGroups("accomplished", item.intent, item.groupIds);
      if (prunedIds.length === 0) {
        // Warn, never drop: stated-side grounding is the citation, but an
        // anchor-less row renders without jump-links, so the drift must show.
        issues.push(
          `accomplished item "${item.intent}" has no valid group anchor — kept (stated-side grounding is the citation)`,
        );
      }
      return forceUnacknowledged("accomplished", {
        ...item,
        groupIds: prunedIds,
      });
    });

  const statedButMissing = intentCheck.statedButMissing
    .filter((item) => keepSource("statedButMissing", item))
    .map((item) => {
      checkQuote("statedButMissing", item);
      if (item.groupIds.length > 0) {
        issues.push(
          `statedButMissing item "${item.intent}" carries ${item.groupIds.length} groupId(s) — emptied (a missing ask has no diff anchor)`,
        );
      }
      return forceUnacknowledged("statedButMissing", { ...item, groupIds: [] });
    });

  const doneButUnstated = intentCheck.doneButUnstated
    .map((item) => {
      if (item.quote !== "" || item.sourceUrl !== "") {
        issues.push(
          `doneButUnstated item "${item.intent}" carries a quote/sourceUrl — emptied (no ticket side by definition)`,
        );
      }
      return forceUnacknowledged("doneButUnstated", {
        ...item,
        quote: "",
        sourceUrl: "",
        groupIds: pruneGroups("doneButUnstated", item.intent, item.groupIds),
      });
    })
    .filter((item) => {
      if (item.groupIds.length > 0) {
        return true;
      }
      issues.push(
        `doneButUnstated item "${item.intent}" has no valid group anchor — dropped (no grounding)`,
      );
      return false;
    });

  const deviations = sanitizeAlarmBucket("deviations", intentCheck.deviations);

  const maskedFixes = sanitizeAlarmBucket(
    "maskedFixes",
    intentCheck.maskedFixes,
  ).map((item) => forceUnacknowledged("maskedFixes", item));

  const alignment = verifyAlignment(
    intentCheck.alignment,
    primary,
    contentByUrl,
    issues,
  );
  const { alignment: _unverified, ...rest } = intentCheck;
  const verified: IntentCheck = {
    ...rest,
    ticketUrls,
    ticketTitles,
    accomplished,
    statedButMissing,
    doneButUnstated,
    deviations,
    maskedFixes,
  };
  if (alignment !== undefined) {
    verified.alignment = alignment;
  }
  return { intentCheck: verified, issues };
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
  "repository",
  "homepage",
  "bugs",
  "funding",
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
  "include",
  "exclude",
  "license-file",
  "lints",
]);

/** A value that looks like a version/range/source spec rather than text. */
const VERSION_SHAPED =
  /^(?:[\^~]|[<>]=?|==?|\d|\*|workspace:|catalog:|npm:|jsr:|file:|link:|portal:|patch:|github:|gitlab:|bitbucket:|gist:|git\+|git:|https?:\/\/)/;

/** `serde.workspace = true`: a dependency, unless the field is package metadata. */
const TOML_WORKSPACE_KEY = /^([\w-]+)\.workspace$/;

/** `[dependencies.serde]`, `[target.'cfg(unix)'.dependencies.serde]`: the dependency named by its own sub-table. */
const TOML_DEPENDENCY_SUBTABLE = /dependencies\.(?:"([^"]+)"|([\w-]+))$/;

/**
 * Added and removed entries must key the dependency, not its field: a sub-table
 * keys every line by its name, a dotted `serde.features` by its first segment.
 */
function readTableDependencyName(
  table: string,
  key: string,
): string | undefined {
  const named = TOML_DEPENDENCY_SUBTABLE.exec(table);
  const subTable = named?.[1] ?? named?.[2];
  if (subTable !== undefined) {
    return subTable;
  }
  if (!table.includes("dependencies")) {
    return undefined;
  }
  return key.split(".")[0] ?? key;
}

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
 * Visible sections restrict dependency keys; absent hunk headers require shape checks
 * and a metadata-key blocklist so fields such as lint or edition cannot confirm dependencies.
 */
function depKeyFromLine(
  content: string,
  format: ManifestFormat,
  ctx: SectionContext,
): string | undefined {
  switch (format) {
    case "json": {
      const m = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(content);
      if (!m) {
        return undefined;
      }
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
      if (!m) {
        return undefined;
      }
      const key = m[1] ?? "";
      const value = m[2] ?? "";
      if (ctx.tomlTable !== undefined) {
        return readTableDependencyName(ctx.tomlTable, key);
      }
      if (TOML_NON_DEP_KEYS.has(key)) {
        return undefined;
      }
      const inherited = TOML_WORKSPACE_KEY.exec(key)?.[1];
      if (inherited !== undefined) {
        const inheritsDependency =
          /^true\b/.test(value) && !TOML_NON_DEP_KEYS.has(inherited);
        return inheritsDependency ? inherited : undefined;
      }
      const quoted = /^"([^"]*)"/.exec(value);
      if (quoted) {
        return VERSION_SHAPED.test(quoted[1] ?? "") ? key : undefined;
      }
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
      const m = /^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(?:[=<>!~;@ ]|$)/.exec(
        line,
      );
      return m?.[1];
    }
    case "gomod": {
      const m = /^\s*(?:require\s+)?([\w.-]+(?:\/[\w.-]+)+)\s+v\d/.exec(
        content,
      );
      return m?.[1];
    }
    case "gemfile": {
      const m = /^\s*gem\s+["']([^"']+)["']/.exec(content);
      return m?.[1];
    }
    case "pom": {
      if (!ctx.inPomDependencies) {
        return undefined;
      }
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

interface JsonSection {
  name: string;
  indent: number;
}

/** The JSON section open after `content`: an opener enters one, a closer at or above its indent leaves it. */
function advanceJsonSection(
  content: string,
  current: JsonSection | undefined,
): JsonSection | undefined {
  const open = /^(\s*)"([^"]+)"\s*:\s*\{/.exec(content);
  if (open) {
    return { name: open[2] ?? "", indent: (open[1] ?? "").length };
  }
  if (current === undefined || !/^\s*[}\]]/.test(content)) {
    return current;
  }

  const indent = content.length - content.trimStart().length;
  return indent <= current.indent ? undefined : current;
}

/**
 * Scan one side of a file patch for dependency entries. The side's "file
 * view" (context lines + that side's changed lines) drives both the line
 * counter, from each `@@` hunk header, and the section tracking, so a
 * `"scripts": {` opener in context correctly reclassifies the lines under it.
 * Section state resets on every hunk, because the gap may open or close a section.
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
  let jsonSection: JsonSection | undefined;
  let tomlTable: string | undefined;
  let inPomDependencies = false;

  for (const raw of patch.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw)?.groups;
    if (hunk) {
      lineNo = Number(side === "added" ? hunk["newStart"] : hunk["oldStart"]);
      jsonSection = undefined;
      tomlTable = undefined;
      inPomDependencies = false;
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
    if (marker === oppositeMarker) {
      continue;
    }
    if (marker !== " " && marker !== changedMarker) {
      continue;
    }
    const content = raw.slice(1);

    if (format === "json") {
      jsonSection = advanceJsonSection(content, jsonSection);
    } else if (format === "toml") {
      const table = /^\s*\[+([^\]]+)\]/.exec(content);
      if (table) {
        tomlTable = table[1];
      }
    } else if (format === "pom") {
      if (/<dependenc(?:y|ies)>/.test(content)) {
        inPomDependencies = true;
      }
      if (/<\/dependenc(?:y|ies)>/.test(content)) {
        inPomDependencies = false;
      }
    }

    if (marker === changedMarker) {
      const key = depKeyFromLine(content, format, {
        jsonSection: jsonSection?.name,
        tomlTable,
        inPomDependencies,
      });
      if (key !== undefined) {
        entries.push({ key, line: lineNo });
      }
    }
    lineNo++;
  }
  return entries;
}

/**
 * Confirm only new keys in this chunk's added ranges. Removed keys elsewhere in the file
 * make matching additions version bumps. A dependency added in another chunk cannot confirm it.
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

export interface RiskAttributeOptions {
  /** Set on a revision run, where the previous brief is the before side. */
  readonly acceptsRevisionDroppedChecks: boolean;
}

function hasRiskNote(chunk: Chunk, attr: string): boolean {
  return (chunk.riskNotes ?? []).some(
    (note) => note.attr === attr && note.note.trim() !== "",
  );
}

/**
 * Drop invalid attributes and their notes, never chunks; return copies with warnings.
 * New-dependency needs chunk-local evidence; comment-contradicts-code needs a citation.
 * Removes-validation requires removed lines, accepting misses on added early returns
 * to reject the observed false positives. On a revision run a cited check the
 * previous revision had also counts. New-abstraction remains model-observed.
 */
export function validateRiskAttributes<C extends Chunk>(
  chunks: C[],
  fileDiffs: Pick<FileDiff, "file" | "patch">[],
  options: RiskAttributeOptions = { acceptsRevisionDroppedChecks: false },
): { chunks: C[]; issues: string[] } {
  const issues: string[] = [];
  const patchByFile = new Map(fileDiffs.map((d) => [d.file, d.patch]));

  const sanitized = chunks.map((chunk) => {
    const drops = new Set<string>();

    if (chunk.riskSurface.includes("comment-contradicts-code")) {
      if (!hasRiskNote(chunk, "comment-contradicts-code")) {
        drops.add("comment-contradicts-code");
        issues.push(
          `chunk ${chunk.id} (${chunk.file}): dropped comment-contradicts-code — no riskNotes citation`,
        );
      }
    }

    const citesRevisionDroppedCheck =
      options.acceptsRevisionDroppedChecks &&
      hasRiskNote(chunk, "removes-validation");
    const claimsUnseenRemoval =
      chunk.riskSurface.includes("removes-validation") &&
      chunk.removedRanges.length === 0 &&
      !citesRevisionDroppedCheck;
    if (claimsUnseenRemoval) {
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

    if (drops.size === 0) {
      return chunk;
    }
    const riskSurface = chunk.riskSurface.filter((attr) => !drops.has(attr));
    const riskNotes = chunk.riskNotes?.filter((n) => !drops.has(n.attr));
    const hasNotes = riskNotes !== undefined && riskNotes.length > 0;
    const keptNotes = hasNotes ? riskNotes : undefined;
    return { ...chunk, riskSurface, riskNotes: keptNotes };
  });

  return { chunks: sanitized, issues };
}

/**
 * Validate risk tokens against THIS generation's vocabulary (built-ins ∪ the
 * repo's injected custom names) and each custom attribute's path scope,
 * warn-and-drop. The harness-side floor that holds regardless of adapter, and
 * the ONLY enforcement of path scopes, which no schema can express. Pure.
 */
export function validateRepoAttributeTokens<C extends Chunk>(
  chunks: C[],
  customAttributes: readonly CustomRiskAttributeInput[],
): { chunks: C[]; issues: string[] } {
  const issues: string[] = [];
  const customByName = new Map(
    customAttributes.map((attr) => [attr.name, attr]),
  );
  const builtIn = new Set<string>(Object.values(RiskSurfaceAttributes));

  // A token is bad on this chunk when it is unknown or a custom attribute fired
  // outside its path scope, checked for riskSurface AND riskNotes
  // independently, so a bad token cannot survive by hiding in a note.
  function badTokenReason(token: string, file: string): string | undefined {
    if (builtIn.has(token)) {
      return undefined;
    }
    const custom = customByName.get(token);
    if (custom === undefined) {
      return `unknown risk token "${token}" — not built-in and not defined by this repo's policy`;
    }
    if (!inAttributeScope(custom, file)) {
      return `repo attribute "${token}" — file is outside its path scope`;
    }
    return undefined;
  }

  const sanitized = chunks.map((chunk) => {
    const drops = new Set<string>();
    for (const token of chunk.riskSurface) {
      const reason = badTokenReason(token, chunk.file);
      if (reason !== undefined && !drops.has(token)) {
        drops.add(token);
        issues.push(`chunk ${chunk.id} (${chunk.file}): dropped ${reason}`);
      }
    }
    for (const note of chunk.riskNotes ?? []) {
      const reason = badTokenReason(note.attr, chunk.file);
      if (reason !== undefined && !drops.has(note.attr)) {
        drops.add(note.attr);
        issues.push(
          `chunk ${chunk.id} (${chunk.file}): dropped riskNotes ${reason}`,
        );
      }
    }
    if (drops.size === 0) {
      return chunk;
    }
    const riskSurface = chunk.riskSurface.filter((token) => !drops.has(token));
    const riskNotes = chunk.riskNotes?.filter((note) => !drops.has(note.attr));
    const hasNotes = riskNotes !== undefined && riskNotes.length > 0;
    const keptNotes = hasNotes ? riskNotes : undefined;
    return { ...chunk, riskSurface, riskNotes: keptNotes };
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
 * Validate that each revision-narrative chunk overlaps a mechanical comparison
 * mark for the same file. Compares added-side to added-side and removed-side to
 * removed-side, matching how the FE joins marks. Warn only.
 */
export function validateNarrativeMarksOverlap(
  chunks: Pick<
    RevisionNarrativeChunk,
    "id" | "file" | "addedRanges" | "removedRanges"
  >[],
  marksFiles: Pick<
    RevisionChangeFile,
    "file" | "addedRanges" | "removedRanges"
  >[],
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

/**
 * Warn ceilings in chars, deliberately above the prompt's stated ideals so a
 * warning always means a real violation, never borderline noise. The PR
 * lede/changelog stays out; its caps are prompt-enforced.
 */
export const TEXT_LENGTH_CAPS: Record<TextSurface, number> = {
  "group-title": 150,
  "group-summary": 250,
  "narrative-overview": 250,
  "narrative-chunk-summary": 150,
  "risk-note": 200,
};

function checkTextLength(
  surface: TextSurface,
  field: string,
  text: string,
  violations: LengthViolation[],
  issues: string[],
): void {
  const cap = TEXT_LENGTH_CAPS[surface];
  if (text.length <= cap) {
    return;
  }
  violations.push({ surface, field, actual: text.length, cap });
  issues.push(`${field} is ${text.length} chars — exceeds the ${cap}-char cap`);
}

/**
 * Length check for brief-shaped output, change-groups plus per-chunk riskNotes.
 * WARN-ONLY by design: never trim, never retry, never a schema `maxLength`. The
 * prompt carries the caps; this is the floor that measures compliance.
 */
export function validateTextLength(
  groups: Pick<ChangeGroup, "id" | "title" | "summary">[],
  chunks: Pick<Chunk, "id" | "riskNotes">[],
): { violations: LengthViolation[]; issues: string[] } {
  const violations: LengthViolation[] = [];
  const issues: string[] = [];
  for (const group of groups) {
    checkTextLength(
      TextSurfaces.GROUP_TITLE,
      `group ${group.id} title`,
      group.title,
      violations,
      issues,
    );
    checkTextLength(
      TextSurfaces.GROUP_SUMMARY,
      `group ${group.id} summary`,
      group.summary,
      violations,
      issues,
    );
  }
  for (const chunk of chunks) {
    for (const note of chunk.riskNotes ?? []) {
      checkTextLength(
        TextSurfaces.RISK_NOTE,
        `chunk ${chunk.id} riskNotes[${note.attr}]`,
        note.note,
        violations,
        issues,
      );
    }
  }
  return { violations, issues };
}

/** The revision-narrative side of `validateTextLength`. */
export function validateNarrativeTextLength(
  overview: string,
  chunks: Pick<RevisionNarrativeChunk, "id" | "summary">[],
): { violations: LengthViolation[]; issues: string[] } {
  const violations: LengthViolation[] = [];
  const issues: string[] = [];
  checkTextLength(
    TextSurfaces.NARRATIVE_OVERVIEW,
    "narrative overview",
    overview,
    violations,
    issues,
  );
  for (const chunk of chunks) {
    checkTextLength(
      TextSurfaces.NARRATIVE_CHUNK_SUMMARY,
      `narrative chunk ${chunk.id} summary`,
      chunk.summary,
      violations,
      issues,
    );
  }
  return { violations, issues };
}

function formatRange(range: LineRange): string {
  return range.start === range.end
    ? `${range.start}`
    : `${range.start}-${range.end}`;
}

/**
 * The reverse direction of `validateNarrativeMarksOverlap`: every mechanical
 * mark range should overlap some narrative chunk for the same file and side,
 * an uncovered span has no summary in the comparison overlay. Warn only, never
 * retry: a regen costs a full narrative spend for what the FE degrades over.
 */
export function validateMarksNarrativeCoverage(
  marksFiles: Pick<
    RevisionChangeFile,
    "file" | "addedRanges" | "removedRanges"
  >[],
  chunks: Pick<
    RevisionNarrativeChunk,
    "file" | "addedRanges" | "removedRanges"
  >[],
): string[] {
  const issues: string[] = [];
  for (const marks of marksFiles) {
    const chunksForFile = chunks.filter((c) => c.file === marks.file);
    const uncoveredAdded = marks.addedRanges.filter(
      (range) => !chunksForFile.some((c) => anyOverlap([range], c.addedRanges)),
    );
    const uncoveredRemoved = marks.removedRanges.filter(
      (range) =>
        !chunksForFile.some((c) => anyOverlap([range], c.removedRanges)),
    );
    if (uncoveredAdded.length === 0 && uncoveredRemoved.length === 0) {
      continue;
    }
    const sides = [
      ...(uncoveredAdded.length > 0
        ? [`added ${uncoveredAdded.map(formatRange).join(", ")}`]
        : []),
      ...(uncoveredRemoved.length > 0
        ? [`removed ${uncoveredRemoved.map(formatRange).join(", ")}`]
        : []),
    ];
    issues.push(
      `marks for ${marks.file}: no narrative chunk covers ${sides.join("; ")}`,
    );
  }
  return issues;
}
