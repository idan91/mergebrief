import type { FetchedPr } from "../../github/types";
import { HIDDEN_CHARS } from "../../hidden-chars";
import {
  HUNK_HEADER_RANGES,
  INTERPOLATION,
  KEYED_BARE_VALUE,
  KEYED_QUOTED_VALUE,
  KEY_ARMOR_LINE,
  KEY_BEGIN,
  KEY_BODY_LINE,
  KEY_END,
  KEY_HEADER_LINE,
  KEY_LINE_RUN,
  KEY_MATERIAL,
  LONG_ALPHANUMERIC_RUN,
  NAME_SHAPED_VALUE,
  PASSWORD_KEY,
  PATTERN_SOURCE,
  TOKEN_KEY,
  PLACEHOLDER_START,
  PLACEHOLDER_TEMPLATE,
  ARMOR_CHECKSUM,
  PPK_PRIVATE_LINES,
  PUBLIC_END,
  PLACEHOLDER_WORD,
  TOKEN_PATTERNS,
  TOKEN_PREFIX,
  TRUNCATED_HEADER_TOKEN,
  TRUNCATED_KEYED_VALUE,
  TRUNCATED_TOKEN_KINDS,
  TRUNCATED_URL_PASSWORD,
  URL_PASSWORD,
} from "./consts";
import {
  DiffSides,
  KeyBlocks,
  SecretKinds,
  type DiffSide,
  type InferredSpan,
  type KeyBlock,
  type SecretHit,
  type SecretKind,
  type SecretKindCounts,
  type SecretRedaction,
  type SecretSpan,
} from "./types";

const DIFF_LINE_SIDES: ReadonlyMap<string, readonly DiffSide[]> = new Map([
  ["+", [DiffSides.NEW]],
  ["-", [DiffSides.OLD]],
  [" ", [DiffSides.OLD, DiffSides.NEW]],
]);
const PROSE_SIDES: readonly DiffSide[] = [DiffSides.NEW];

interface LineShape {
  readPrefix(line: string): string;
  readSides(prefix: string): readonly DiffSide[];
  isBoundary(line: string): boolean;
  isHunkHeader(line: string): boolean;
}

/** A line with no side (`\ No newline`, a file header) leaves every open block as it was. */
const DIFF_SHAPE: LineShape = {
  readPrefix: (line) => {
    const first = line.charAt(0);
    return DIFF_LINE_SIDES.has(first) ? first : "";
  },
  readSides: (prefix) => DIFF_LINE_SIDES.get(prefix) ?? [],
  isBoundary: (line) => line.startsWith("@@") || line.startsWith("diff --git "),
  isHunkHeader: (line) => line.startsWith("@@"),
};

const PROSE_SHAPE: LineShape = {
  readPrefix: () => "",
  readSides: () => PROSE_SIDES,
  isBoundary: () => false,
  isHunkHeader: () => false,
};

interface KeyLineStep {
  readonly redacted: boolean;
  /** The block the next line is in; `undefined` closes it. */
  readonly next: KeyBlock | undefined;
}

interface InlineKeys {
  readonly spans: SecretSpan[];
  readonly opensKey: boolean;
}

interface ScanRun {
  readonly shape: LineShape;
  readonly lines: readonly string[];
  readonly spans: SecretSpan[][];
  readonly openKeys: Map<DiffSide, KeyBlock>;
  /** Spans the current inferred block added; a public END fence within reach drops them. */
  readonly inferred: InferredSpan[];
  hunkStart: number;
}

/** A line with its hidden chars removed, the raw offset of each kept unit, and where each removed run sat. */
interface StrippedLine {
  readonly text: string;
  readonly rawOffsets: readonly number[];
  readonly cuts: readonly number[];
}

function formatMarker(kind: SecretKind): `[redacted:${string}]` {
  return `[redacted:${kind}]`;
}

/** The body's visible run; indent and line ending stay outside it. */
function findVisibleRun(
  body: string,
  offset: number,
  kind: SecretKind,
): SecretSpan {
  const start = offset + body.length - body.trimStart().length;
  return { start, end: offset + body.trimEnd().length, kind };
}

function hasPattern(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/** A body line once a block is proven: any base64 run of key length, short last lines included. */
function isKeyMaterialLine(trimmed: string): boolean {
  const keyMaterial = KEY_BODY_LINE.test(trimmed) && KEY_MATERIAL.test(trimmed);
  return keyMaterial;
}

/** A key body line by shape alone: base64 of PEM line length that mixes cases and digits, as random key bytes do. */
function isInferredKeyLine(trimmed: string): boolean {
  const run = KEY_LINE_RUN.exec(trimmed)?.[0] ?? "";
  const mixesCases = /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run);
  const keyShaped = KEY_BODY_LINE.test(trimmed) && mixesCases;
  return keyShaped;
}

function stepImpliedBlock(
  body: string,
  block: KeyBlock,
): KeyLineStep | undefined {
  const trimmed = body.trim();
  if (hasPattern(KEY_END, body)) {
    return undefined;
  }
  const proven = block === KeyBlocks.IMPLIED;
  const keyLine = proven
    ? isKeyMaterialLine(trimmed)
    : isInferredKeyLine(trimmed);
  if (keyLine) {
    return { redacted: true, next: KeyBlocks.IMPLIED };
  }
  const armorLead = trimmed === "" || KEY_ARMOR_LINE.test(trimmed);
  if (block === KeyBlocks.ARMOR && armorLead) {
    return { redacted: false, next: KeyBlocks.ARMOR };
  }
  return undefined;
}

/**
 * Inside a key block: `undefined` means the line is not key material and ends
 * it. A block a header implied has no BEGIN fence to trust, so only lines
 * that carry key material continue it, and its END fence goes through the
 * stray-END path, which redacts the short tail above it.
 */
function stepKeyBlock(body: string, block: KeyBlock): KeyLineStep | undefined {
  if (block !== KeyBlocks.FENCED) {
    return stepImpliedBlock(body, block);
  }
  const trimmed = body.trim();
  if (hasPattern(KEY_END, body)) {
    return { redacted: false, next: undefined };
  }
  if (trimmed === "" || KEY_HEADER_LINE.test(trimmed)) {
    return { redacted: false, next: block };
  }
  if (!KEY_BODY_LINE.test(trimmed)) {
    return undefined;
  }
  return { redacted: true, next: block };
}

/** Key blocks whose fences share one line, as a JSON-escaped key does; a fence left open opens a block. */
function findInlineKeySpans(body: string, offset: number): InlineKeys {
  const spans: SecretSpan[] = [];
  KEY_BEGIN.lastIndex = 0;

  for (
    let begin = KEY_BEGIN.exec(body);
    begin !== null;
    begin = KEY_BEGIN.exec(body)
  ) {
    const fenceEnd = begin.index + begin[0].length;
    KEY_END.lastIndex = fenceEnd;
    const end = KEY_END.exec(body);
    const stop = end === null ? body.length : end.index;
    if (KEY_MATERIAL.test(body.slice(fenceEnd, stop))) {
      spans.push({
        start: offset + fenceEnd,
        end: offset + stop,
        kind: SecretKinds.PRIVATE_KEY,
      });
    }
    if (end === null) {
      return { spans, opensKey: true };
    }
    KEY_BEGIN.lastIndex = end.index + end[0].length;
  }
  return { spans, opensKey: false };
}

function isPlaceholderPassword(password: string): boolean {
  return PLACEHOLDER_TEMPLATE.test(password) || PLACEHOLDER_WORD.test(password);
}

/**
 * A value worth hiding under a secret-named key: letters and digits both,
 * which a word, a sentence, a port and most identifiers are not, and no
 * stand-in or run-time interpolation. Under a key ending in `token` a
 * pattern's source is no literal either: a lexer names its patterns that
 * way, and no issued token holds a group or a class; a long run of
 * letters and digits still makes it one.
 */
function isKeyedLiteral(value: string, key: string): boolean {
  const mixesLettersAndDigits = /[A-Za-z]/.test(value) && /\d/.test(value);
  const standsIn = isPlaceholderPassword(value) || INTERPOLATION.test(value);
  const readsAsPattern =
    PATTERN_SOURCE.test(value) && !LONG_ALPHANUMERIC_RUN.test(value);
  const isLexerPattern = TOKEN_KEY.test(key) && readsAsPattern;
  const literal = mixesLettersAndDigits && !standsIn && !isLexerPattern;
  return literal;
}

/** A name-shaped value is hidden under any key, and is a credential only under a password's. */
function readKeyedKind(value: string, key: string): SecretKind {
  const namesSomething =
    NAME_SHAPED_VALUE.test(value) && !PASSWORD_KEY.test(key);
  return namesSomething ? SecretKinds.KEYED_NAME : SecretKinds.KEYED_SECRET;
}

/** Whether one of `taken` holds the whole span, for spans asked in increasing order of start. */
function createCoverCheck(
  taken: readonly SecretSpan[],
): (start: number, end: number) => boolean {
  let next = 0;
  return (start, end) => {
    let candidate = taken[next];
    while (candidate !== undefined && candidate.end <= start) {
      next += 1;
      candidate = taken[next];
    }
    const coversWhole =
      candidate !== undefined &&
      candidate.start <= start &&
      end <= candidate.end;
    return coversWhole;
  };
}

/**
 * Values under secret-named keys. A format in `found` that covers a whole
 * value keeps its own marker; one that covers a part does not stand in for
 * the rest, so the value goes whole. A pattern's matches come in order, so
 * each walks the merged spans once: a line that mixes many of both stays
 * linear.
 */
function findKeyedSpans(
  text: string,
  offset: number,
  found: readonly SecretSpan[],
): SecretSpan[] {
  const taken = mergeSpans(found);
  const spans: SecretSpan[] = [];
  for (const pattern of [KEYED_QUOTED_VALUE, KEYED_BARE_VALUE]) {
    const isCovered = createCoverCheck(taken);
    for (const match of text.matchAll(pattern)) {
      const { head = "", key = "", value = "" } = match.groups ?? {};
      const start = offset + match.index + head.length;
      const end = start + value.length;
      const covered = isCovered(start, end);
      const literal = isKeyedLiteral(value, key);
      if (literal && !covered) {
        spans.push({ start, end, kind: readKeyedKind(value, key) });
      }
    }
  }
  return spans;
}

/**
 * A keyed literal a hunk header holds without its closing quote. The cut can
 * take the digit the full rule asks for, so anything that does not start as
 * a stand-in goes.
 */
function findTruncatedKeyedValue(
  context: string,
  offset: number,
): SecretSpan | undefined {
  const match = TRUNCATED_KEYED_VALUE.exec(context);
  const { head = "", value = "" } = match?.groups ?? {};
  const standsIn = PLACEHOLDER_START.test(value) || INTERPOLATION.test(value);
  if (match === null || standsIn) {
    return undefined;
  }
  const start = offset + match.index + head.length;
  return { start, end: start + value.length, kind: SecretKinds.KEYED_SECRET };
}

function findTokenSpans(text: string, offset: number): SecretSpan[] {
  const spans: SecretSpan[] = [];
  for (const { kind, pattern, accepts } of TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (accepts === undefined || accepts(match[0])) {
        const start = offset + match.index;
        spans.push({ start, end: start + match[0].length, kind });
      }
    }
  }

  for (const match of text.matchAll(URL_PASSWORD)) {
    const [, head = "", password = ""] = match;
    if (!isPlaceholderPassword(password)) {
      const start = offset + match.index + head.length;
      spans.push({
        start,
        end: start + password.length,
        kind: SecretKinds.URL_PASSWORD,
      });
    }
  }
  return [...spans, ...findKeyedSpans(text, offset, spans)];
}

/** A hunk header's cut-short token, which no full-length pattern can match. */
function findTruncatedHeaderToken(header: string): SecretSpan | undefined {
  const match = TRUNCATED_HEADER_TOKEN.exec(header);
  const prefix = match?.[1];
  const kind = TRUNCATED_TOKEN_KINDS.find(([pattern]) =>
    pattern.test(prefix ?? ""),
  )?.[1];
  if (match === null || kind === undefined) {
    return undefined;
  }
  return { start: match.index, end: header.length, kind };
}

function addSpans(
  run: ScanRun,
  index: number,
  spans: readonly SecretSpan[],
): void {
  const lineSpans = run.spans[index];
  for (const span of spans) {
    lineSpans?.push(span);
  }
}

function setOpenKeys(
  run: ScanRun,
  sides: readonly DiffSide[],
  block: KeyBlock | undefined,
): void {
  for (const side of sides) {
    if (block === undefined) {
      run.openKeys.delete(side);
    } else {
      run.openKeys.set(side, block);
    }
  }
}

function findTruncatedUrlPassword(
  context: string,
  offset: number,
): SecretSpan | undefined {
  const match = TRUNCATED_URL_PASSWORD.exec(context);
  const [, head = "", password = ""] = match ?? [];
  if (match === null || isPlaceholderPassword(password)) {
    return undefined;
  }
  const start = offset + match.index + head.length;
  return {
    start,
    end: start + password.length,
    kind: SecretKinds.URL_PASSWORD,
  };
}

/** A hunk below line 1 on both sides could start inside a key whose BEGIN fence sits above it. */
function startsBelowFirstLine(ranges: RegExpExecArray | null): boolean {
  const [, oldStart = "0", newStart = "0"] = ranges ?? [];
  const belowFirstLine = Number(oldStart) > 1 && Number(newStart) > 1;
  return belowFirstLine;
}

/**
 * Git copies the nearest line above a hunk that starts with a letter into its
 * header, cut at 80 bytes. A BEGIN fence left open there opens a fenced
 * block, and material or a URL password the cut left without its end is
 * still redacted. A key line there, an armor header, or no context at all
 * (git skips a bare fence) opens a block the header implied, which only key
 * material continues.
 */
function scanHunkHeader(run: ScanRun, header: string, index: number): void {
  const truncated = findTruncatedHeaderToken(header);
  if (truncated !== undefined) {
    addSpans(run, index, [truncated]);
  }

  const ranges = HUNK_HEADER_RANGES.exec(header);
  const contextStart = ranges?.[0].length ?? header.length;
  const context = header.slice(contextStart);
  const password = findTruncatedUrlPassword(context, contextStart);
  if (password !== undefined) {
    addSpans(run, index, [password]);
  }
  const keyed = findTruncatedKeyedValue(context, contextStart);
  if (keyed !== undefined) {
    addSpans(run, index, [keyed]);
  }
  const inline = findInlineKeySpans(context, contextStart);
  addSpans(run, index, inline.spans);
  if (inline.opensKey) {
    setOpenKeys(run, [DiffSides.OLD, DiffSides.NEW], KeyBlocks.FENCED);
    return;
  }

  const trimmed = context.trim();
  if (isInferredKeyLine(trimmed)) {
    const span = findVisibleRun(context, contextStart, SecretKinds.PRIVATE_KEY);
    addSpans(run, index, [span]);
    run.inferred.push({ line: index, span });
  }
  if (!startsBelowFirstLine(ranges)) {
    return;
  }
  if (isInferredKeyLine(trimmed)) {
    setOpenKeys(run, [DiffSides.OLD, DiffSides.NEW], KeyBlocks.IMPLIED);
  } else if (trimmed === "" || KEY_ARMOR_LINE.test(trimmed)) {
    setOpenKeys(run, [DiffSides.OLD, DiffSides.NEW], KeyBlocks.ARMOR);
  } else if (KEY_HEADER_LINE.test(trimmed)) {
    setOpenKeys(run, [DiffSides.OLD, DiffSides.NEW], KeyBlocks.ARMOR);
  }
}

function scanBoundary(run: ScanRun, line: string, index: number): void {
  run.openKeys.clear();
  run.inferred.length = 0;
  run.hunkStart = index + 1;
  addSpans(run, index, findTokenSpans(line, 0));
  if (run.shape.isHunkHeader(line)) {
    scanHunkHeader(run, line, index);
  }
}

function readBody(run: ScanRun, index: number): string {
  const line = run.lines[index] ?? "";
  return line.slice(run.shape.readPrefix(line).length);
}

/**
 * An END fence with no open block, as when the BEGIN fence sits outside the
 * hunk: the key-body run directly above it is redacted, when any line of the
 * run carries key material.
 */
function redactKeyTail(run: ScanRun, endIndex: number): void {
  const tail: number[] = [];
  for (let index = endIndex - 1; index >= run.hunkStart; index -= 1) {
    const body = readBody(run, index).trim();
    if (!KEY_BODY_LINE.test(body)) {
      break;
    }
    tail.push(index);
  }
  const carriesKey = tail.some((index) => {
    const body = readBody(run, index);
    return KEY_MATERIAL.test(body);
  });
  if (!carriesKey) {
    return;
  }

  for (const index of tail) {
    const line = run.lines[index] ?? "";
    const prefix = run.shape.readPrefix(line);
    const body = readBody(run, index);
    const span = findVisibleRun(body, prefix.length, SecretKinds.PRIVATE_KEY);
    addSpans(run, index, [span]);
  }
}

function findOpenBlock(
  run: ScanRun,
  sides: readonly DiffSide[],
): KeyBlock | undefined {
  const blocks = sides.map((side) => run.openKeys.get(side));
  return blocks.find((block) => block !== undefined);
}

/**
 * A run with no fence in view may be a certificate or a public key, whose END
 * fence names it. Body lines of any length and a PGP checksum keep the run
 * open; a public END then drops its spans. A private END or any other line
 * settles them.
 */
function settleInferredSpans(run: ScanRun, body: string): void {
  if (run.inferred.length === 0) {
    return;
  }
  if (hasPattern(KEY_END, body)) {
    run.inferred.length = 0;
    return;
  }
  if (PUBLIC_END.test(body)) {
    for (const { line, span } of run.inferred) {
      const kept = run.spans[line]?.filter((held) => held !== span) ?? [];
      run.spans[line] = kept;
    }
    run.inferred.length = 0;
    return;
  }
  const trimmed = body.trim();
  const armorTail = KEY_BODY_LINE.test(trimmed) || ARMOR_CHECKSUM.test(trimmed);
  if (!armorTail) {
    run.inferred.length = 0;
  }
}

function scanSidedLine(
  run: ScanRun,
  line: string,
  index: number,
  sides: readonly DiffSide[],
): void {
  const offset = run.shape.readPrefix(line).length;
  const body = line.slice(offset);
  settleInferredSpans(run, body);
  const block = findOpenBlock(run, sides);
  const step = block === undefined ? undefined : stepKeyBlock(body, block);
  if (step !== undefined) {
    setOpenKeys(run, sides, step.next);
    if (!step.redacted) {
      addSpans(run, index, findTokenSpans(body, offset));
      return;
    }
    const span = findVisibleRun(body, offset, SecretKinds.PRIVATE_KEY);
    addSpans(run, index, [span]);
    if (block !== KeyBlocks.FENCED) {
      run.inferred.push({ line: index, span });
    }
    return;
  }

  const strayEnd = hasPattern(KEY_END, body) && !hasPattern(KEY_BEGIN, body);
  if (strayEnd) {
    redactKeyTail(run, index);
  }
  const inline = findInlineKeySpans(body, offset);
  const opensKey = inline.opensKey || PPK_PRIVATE_LINES.test(body.trim());
  setOpenKeys(run, sides, opensKey ? KeyBlocks.FENCED : undefined);
  addSpans(run, index, [...inline.spans, ...findTokenSpans(body, offset)]);
}

function scanLines(lines: readonly string[], shape: LineShape): SecretSpan[][] {
  const run: ScanRun = {
    shape,
    lines,
    spans: lines.map(() => []),
    openKeys: new Map(),
    inferred: [],
    hunkStart: 0,
  };

  for (const [index, line] of lines.entries()) {
    const sides = shape.readSides(shape.readPrefix(line));
    if (shape.isBoundary(line)) {
      scanBoundary(run, line, index);
    } else if (sides.length === 0) {
      addSpans(run, index, findTokenSpans(line, 0));
    } else {
      scanSidedLine(run, line, index, sides);
    }
  }
  return run.spans;
}

function stripHiddenLine(line: string): StrippedLine {
  const kept: string[] = [];
  const rawOffsets: number[] = [];
  const cuts: number[] = [];
  let cursor = 0;
  for (const match of line.matchAll(HIDDEN_CHARS)) {
    kept.push(line.slice(cursor, match.index));
    for (let offset = cursor; offset < match.index; offset += 1) {
      rawOffsets.push(offset);
    }
    if (cuts.at(-1) !== rawOffsets.length) {
      cuts.push(rawOffsets.length);
    }
    cursor = match.index + match[0].length;
  }
  kept.push(line.slice(cursor));
  for (let offset = cursor; offset < line.length; offset += 1) {
    rawOffsets.push(offset);
  }
  return { text: kept.join(""), rawOffsets, cuts };
}

/**
 * The stripped line with a space where a removed hidden char sat right before
 * a token prefix: the char was the boundary between a word and the token, and
 * without it the token's own boundary check fails.
 */
function separateGluedTokens(stripped: StrippedLine): StrippedLine {
  const glued = stripped.cuts.filter((cut) => {
    TOKEN_PREFIX.lastIndex = cut;
    const gluesTokenPrefix = cut > 0 && TOKEN_PREFIX.test(stripped.text);
    return gluesTokenPrefix;
  });
  if (glued.length === 0) {
    return stripped;
  }

  const kept: string[] = [];
  const offsetRuns: (readonly number[])[] = [];
  let cursor = 0;
  for (const cut of glued) {
    kept.push(stripped.text.slice(cursor, cut), " ");
    offsetRuns.push(stripped.rawOffsets.slice(cursor, cut), [
      stripped.rawOffsets[cut] ?? 0,
    ]);
    cursor = cut;
  }
  kept.push(stripped.text.slice(cursor));
  offsetRuns.push(stripped.rawOffsets.slice(cursor));
  return { text: kept.join(""), rawOffsets: offsetRuns.flat(), cuts: [] };
}

function mapToRawLine(span: SecretSpan, stripped: StrippedLine): SecretSpan {
  const start = stripped.rawOffsets[span.start] ?? 0;
  const last = stripped.rawOffsets[span.end - 1] ?? start;
  return { start, end: last + 1, kind: span.kind };
}

function compareSpans(left: SecretSpan, right: SecretSpan): number {
  const byStart = left.start - right.start;
  const byLongerFirst = right.end - left.end;
  const order = byStart || byLongerFirst;
  return order;
}

/** Overlapping runs become one, named for the run that starts first. */
function mergeSpans(spans: readonly SecretSpan[]): SecretSpan[] {
  const merged: SecretSpan[] = [];
  for (const span of spans.toSorted(compareSpans)) {
    const last = merged.at(-1);
    if (last !== undefined && span.start < last.end) {
      merged[merged.length - 1] = {
        ...last,
        end: Math.max(last.end, span.end),
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/** Hidden chars inside a run follow its marker, so a diff still shows they were there. */
function renderLine(
  line: string,
  spans: readonly SecretSpan[],
  renderText: (text: string) => string,
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    const redacted = line.slice(span.start, span.end);
    const hidden = redacted.match(HIDDEN_CHARS) ?? [];
    const before = line.slice(cursor, span.start);
    const hiddenText = hidden.join("");
    parts.push(
      renderText(before),
      formatMarker(span.kind),
      renderText(hiddenText),
    );
    cursor = span.end;
  }
  const rest = line.slice(cursor);
  parts.push(renderText(rest));
  return parts.join("");
}

function keepText(text: string): string {
  return text;
}

function mapSpans(
  spans: readonly SecretSpan[] | undefined,
  stripped: StrippedLine | undefined,
): SecretSpan[] {
  if (stripped === undefined) {
    return [];
  }
  return (spans ?? []).map((span) => mapToRawLine(span, stripped));
}

/**
 * Three passes, merged per line: the raw text; the text with hidden chars
 * removed, so none can split a credential; and that text with a space where a
 * removed char glued a word onto a token prefix, for a token both glued and
 * split. Text outside a redacted run goes through `renderText`.
 */
function redactLines(
  text: string,
  shape: LineShape,
  renderText: (text: string) => string,
): SecretRedaction {
  const lines = text.split("\n");
  const stripped = lines.map(stripHiddenLine);
  const separated = stripped.map(separateGluedTokens);
  const rawSpans = scanLines(lines, shape);
  const strippedSpans = scanLines(
    stripped.map((line) => line.text),
    shape,
  );
  const separatedSpans = scanLines(
    separated.map((line) => line.text),
    shape,
  );

  const hits: SecretHit[] = [];
  const rendered = lines.map((line, index) => {
    const spans = mergeSpans([
      ...(rawSpans[index] ?? []),
      ...mapSpans(strippedSpans[index], stripped[index]),
      ...mapSpans(separatedSpans[index], separated[index]),
    ]);
    for (const { kind } of spans) {
      hits.push({ kind, line: index });
    }
    return renderLine(line, spans, renderText);
  });
  return { text: rendered.join("\n"), hits };
}

/** Known credential formats and literals under secret-named keys in a unified diff, one marker per value; line count and every prefix stay. */
export function redactDiffSecrets(
  diff: string,
  renderText: (text: string) => string = keepText,
): SecretRedaction {
  return redactLines(diff, DIFF_SHAPE, renderText);
}

/** The same pass over prose: a PR description, a ticket, a linked page. */
export function redactProseSecrets(
  text: string,
  renderText: (text: string) => string = keepText,
): SecretRedaction {
  return redactLines(text, PROSE_SHAPE, renderText);
}

export function countSecretKinds(hits: readonly SecretHit[]): SecretKindCounts {
  const counts: SecretKindCounts = {};
  for (const { kind } of hits) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

/** Every value the prompt for `pr` redacts, by kind: what the worker logs, never the values. */
export function countPullRequestSecrets(pr: FetchedPr): SecretKindCounts {
  const prose = [
    pr.meta.title,
    pr.meta.body,
    ...pr.links.map((link) => link.text),
  ];
  if (pr.primaryTicket?.status === "read") {
    prose.push(pr.primaryTicket.snippet.header, pr.primaryTicket.snippet.text);
  }
  const proseHits = prose.flatMap((text) => redactProseSecrets(text).hits);
  return countSecretKinds([...redactDiffSecrets(pr.diff).hits, ...proseHits]);
}
