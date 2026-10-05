import { z } from "zod/v4";
import { TicketTrackers, type Result } from "types";
import type { Log } from "../../../github/types";
import { TicketUnreadReasons } from "../../../types";
import { DEFAULT_NOTION_TOKEN_ENV, type ConfigError } from "generators";
import {
  ContextProviderTypes,
  type ContextProviderDeps,
  type PrimarySnippet,
} from "../../types";
import { refuseTrackerRead } from "../refusal";
import { resolveTokenByName } from "../tokens";
import type { PrimaryRead, SharedRootDeps, TicketReference } from "../types";
import {
  failRead,
  type NotionBlock,
  type NotionDataSource,
  type NotionPage,
  type NotionSession,
  type NotionTransport,
  type ReadResult,
} from "./transport";

/** Same cap as a linked URL: a huge page must not blow up token cost. */
const MAX_TICKET_CHARS = 20_000;
/** Nested blocks past this depth are kept as read; nothing below is fetched. */
const MAX_BLOCK_DEPTH = 8;

const HEADER_SEPARATOR = " · ";
/** Property names whose select/status value joins the header line, in order. */
const HEADER_PROPERTY_NAMES = ["status", "type", "priority"] as const;

const richTextSchema = z.array(z.looseObject({ plain_text: z.string() }));
type RichText = z.infer<typeof richTextSchema>;

const uniqueIdPropertySchema = z.looseObject({
  type: z.literal("unique_id"),
  unique_id: z.looseObject({ prefix: z.string().nullable() }),
});

/** The text-bearing fields any block payload may carry; the rest is ignored. */
const blockPayloadSchema = z.looseObject({
  rich_text: richTextSchema.optional(),
  cells: z.array(richTextSchema).optional(),
  title: z.string().optional(),
  checked: z.boolean().optional(),
});

const propertyValueSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("title"), title: richTextSchema }),
  z.looseObject({
    type: z.literal("status"),
    status: z.looseObject({ name: z.string() }).nullable(),
  }),
  z.looseObject({
    type: z.literal("select"),
    select: z.looseObject({ name: z.string() }).nullable(),
  }),
  z.looseObject({
    type: z.literal("people"),
    people: z.array(z.looseObject({ name: z.string().optional() })),
  }),
  z.looseObject({
    type: z.literal("unique_id"),
    unique_id: z.looseObject({
      prefix: z.string().nullable(),
      number: z.number(),
    }),
  }),
]);
type PropertyValue = z.infer<typeof propertyValueSchema>;

/** One read's bound transport and session. */
interface NotionClient {
  readonly transport: NotionTransport;
  readonly session: NotionSession;
}

function joinPlainText(richText: RichText): string {
  return richText.map((span) => span.plain_text).join("");
}

function normalizePageId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/** Split `PREFIX-N` into its board prefix and number. */
function splitKey(key: string): { prefix: string; number: number } | undefined {
  const separator = key.lastIndexOf("-");
  if (separator <= 0) return undefined;
  const number = Number(key.slice(separator + 1));
  if (!Number.isInteger(number) || number < 0) return undefined;
  return { prefix: key.slice(0, separator), number };
}

function matchesPrefix(prefix: string | null, wanted: string): boolean {
  return prefix !== null && prefix.toLowerCase() === wanted.toLowerCase();
}

/** The typed property values of a page; shapes this reader does not know are skipped. */
function collectPropertyValues(page: NotionPage): Map<string, PropertyValue> {
  const values = new Map<string, PropertyValue>();
  for (const [name, raw] of Object.entries(page.properties)) {
    const parsed = propertyValueSchema.safeParse(raw);
    if (parsed.success) values.set(name.toLowerCase(), parsed.data);
  }
  return values;
}

function findTitle(values: Map<string, PropertyValue>): string {
  for (const value of values.values()) {
    if (value.type === "title") return joinPlainText(value.title).trim();
  }
  return "";
}

function findKey(values: Map<string, PropertyValue>): string {
  for (const value of values.values()) {
    if (value.type !== "unique_id") continue;
    const { prefix, number } = value.unique_id;
    if (prefix === null) return String(number);
    return `${prefix}-${number}`;
  }
  return "";
}

function findKeyPrefix(values: Map<string, PropertyValue>): string | null {
  for (const value of values.values()) {
    if (value.type === "unique_id") return value.unique_id.prefix;
  }
  return null;
}

function readChoice(value: PropertyValue | undefined): string {
  if (value?.type === "status") return value.status?.name ?? "";
  if (value?.type === "select") return value.select?.name ?? "";
  return "";
}

function collectAssignees(values: Map<string, PropertyValue>): string[] {
  const names: string[] = [];
  for (const value of values.values()) {
    if (value.type !== "people") continue;
    for (const person of value.people) {
      if (person.name !== undefined && person.name !== "")
        names.push(person.name);
    }
  }
  return names;
}

/** `title · Status · Type · Priority · assignees · key`, empty pieces omitted. */
function buildHeader(values: Map<string, PropertyValue>, key: string): string {
  const pieces = [
    findTitle(values),
    ...HEADER_PROPERTY_NAMES.map((name) => readChoice(values.get(name))),
    ...collectAssignees(values),
    key,
  ];
  return pieces.filter((piece) => piece !== "").join(HEADER_SEPARATOR);
}

const LINE_PREFIXES: Record<string, string> = {
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
  bulleted_list_item: "- ",
  numbered_list_item: "- ",
  quote: "> ",
};

/** Blocks whose children are a separate page, never descended into. */
const LEAF_CONTAINER_TYPES = new Set(["child_page", "child_database"]);

function renderBlockLine(type: string, payload: unknown): string {
  const parsed = blockPayloadSchema.safeParse(payload);
  if (!parsed.success) return "";
  const { rich_text: richText, cells, title, checked } = parsed.data;

  if (cells !== undefined) {
    return cells.map(joinPlainText).join(" | ");
  }
  if (richText !== undefined) {
    const text = joinPlainText(richText);
    if (type === "to_do") return `${checked === true ? "[x] " : "[ ] "}${text}`;
    return `${LINE_PREFIXES[type] ?? ""}${text}`;
  }
  return title ?? "";
}

class BodyCollector {
  private readonly lines: string[] = [];
  private length = 0;

  get full(): boolean {
    return this.length >= MAX_TICKET_CHARS;
  }

  /** Children requests that answered; zero means the page itself was unreadable. */
  pagesRead = 0;

  add(line: string): void {
    this.lines.push(line);
    this.length += line.length + 1;
  }

  render(): string {
    return this.lines.join("\n").slice(0, MAX_TICKET_CHARS);
  }
}

function shouldDescend(block: NotionBlock, depth: number): boolean {
  return (
    block.hasChildren &&
    depth < MAX_BLOCK_DEPTH &&
    !LEAF_CONTAINER_TYPES.has(block.type)
  );
}

/**
 * Walk a block tree depth-first, one line per block, children indented.
 * Pages of 100 are followed; the walk stops at the char cap, the depth cap,
 * or the first failed call, keeping what was read.
 */
async function collectBlockLines(
  client: NotionClient,
  blockId: string,
  depth: number,
  collector: BodyCollector,
): Promise<ReadResult<void>> {
  let cursor: string | undefined;
  do {
    const page = await client.transport.listBlockChildren(
      client.session,
      blockId,
      cursor,
    );
    if (!page.ok) return page;
    collector.pagesRead += 1;

    for (const block of page.value.blocks) {
      if (collector.full) return { ok: true, value: undefined };
      const line = renderBlockLine(block.type, block.payload);
      if (line !== "") collector.add(`${"  ".repeat(depth)}${line}`);

      if (!shouldDescend(block, depth)) continue;
      const nested = await collectBlockLines(
        client,
        block.id,
        depth + 1,
        collector,
      );
      if (!nested.ok) return nested;
    }

    cursor = page.value.nextCursor;
  } while (cursor !== undefined && !collector.full);
  return { ok: true, value: undefined };
}

async function readPageBody(
  client: NotionClient,
  pageId: string,
  log: Log,
): Promise<ReadResult<string>> {
  const collector = new BodyCollector();
  const walked = await collectBlockLines(client, pageId, 0, collector);
  // Only the page's own first children call decides readability; a failure
  // deeper in the walk ends it and what was read is returned.
  if (!walked.ok && collector.pagesRead === 0) return walked;
  if (!walked.ok) {
    log(
      `notion: block walk ended early (${walked.error.reason}), keeping what was read`,
    );
  }
  return { ok: true, value: collector.render() };
}

/** The unique-id property of one data source carrying the tracker's prefix, if any. */
function findPrefixProperty(
  source: NotionDataSource,
  prefix: string,
): string | undefined {
  for (const [propertyName, raw] of Object.entries(source.properties)) {
    const property = uniqueIdPropertySchema.safeParse(raw);
    if (!property.success) continue;
    if (matchesPrefix(property.data.unique_id.prefix, prefix)) {
      return propertyName;
    }
  }
  return undefined;
}

function readDataSource(
  client: NotionClient,
  dataSourceId: string,
): Promise<ReadResult<NotionDataSource>> {
  return client.transport.getDataSource(client.session, dataSourceId);
}

interface KeyProperty {
  readonly dataSourceId: string;
  readonly propertyName: string;
}

/**
 * The data source whose schema carries the tracker's prefix, and that
 * property's name. The block's id may name the data source (Notion's copy
 * button) or the database (the board URL); a database may hold several
 * sources, so each is read and exactly one must match.
 */
async function findKeyProperty(
  client: NotionClient,
  boardId: string,
  prefix: string,
): Promise<ReadResult<KeyProperty>> {
  const direct = await readDataSource(client, boardId);
  if (direct.ok) {
    const propertyName = findPrefixProperty(direct.value, prefix);
    if (propertyName === undefined) {
      return failRead(
        TicketUnreadReasons.NOT_FOUND,
        "the data source has no unique-id property with the tracker's prefix",
      );
    }
    return { ok: true, value: { dataSourceId: boardId, propertyName } };
  }
  if (direct.error.reason !== TicketUnreadReasons.NOT_FOUND) return direct;

  const database = await client.transport.getDatabase(client.session, boardId);
  if (!database.ok) return database;

  const matches: KeyProperty[] = [];
  for (const dataSourceId of database.value.dataSourceIds) {
    const source = await readDataSource(client, dataSourceId);
    if (!source.ok) return source;
    const propertyName = findPrefixProperty(source.value, prefix);
    if (propertyName !== undefined)
      matches.push({ dataSourceId, propertyName });
  }
  if (matches.length > 1) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      `${matches.length} data sources of the board carry the tracker's prefix; name the data source id in the tracker block`,
    );
  }
  const [match] = matches;
  if (match === undefined) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "no data source of the board has a unique-id property with the tracker's prefix",
    );
  }
  return { ok: true, value: match };
}

async function findPageByKey(
  client: NotionClient,
  databaseId: string,
  key: string,
): Promise<ReadResult<NotionPage>> {
  const split = splitKey(key);
  if (split === undefined) {
    return failRead(TicketUnreadReasons.NOT_FOUND, "the key is not PREFIX-N");
  }
  const property = await findKeyProperty(client, databaseId, split.prefix);
  if (!property.ok) return property;

  const found = await client.transport.queryByUniqueId(
    client.session,
    property.value.dataSourceId,
    { propertyName: property.value.propertyName, number: split.number },
  );
  if (!found.ok) return found;
  const page = found.value;
  if (page === undefined) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "no page carries that number",
    );
  }

  const prefix = findKeyPrefix(collectPropertyValues(page));
  if (!matchesPrefix(prefix, split.prefix)) {
    return failRead(
      TicketUnreadReasons.NOT_FOUND,
      "the page's key prefix is another board's",
    );
  }
  return { ok: true, value: page };
}

function findPageById(
  client: NotionClient,
  pageId: string,
): Promise<ReadResult<NotionPage>> {
  return client.transport.getPage(client.session, pageId);
}

async function findPage(
  client: NotionClient,
  reference: TicketReference,
): Promise<ReadResult<NotionPage>> {
  if (reference.pageId !== undefined)
    return findPageById(client, reference.pageId);
  if (reference.key !== "" && reference.databaseId !== undefined) {
    return findPageByKey(client, reference.databaseId, reference.key);
  }
  return failRead(
    TicketUnreadReasons.UNSUPPORTED,
    "a notion key needs the tracker block's databaseId",
  );
}

async function readNotionPrimary(
  transport: NotionTransport,
  token: string,
  reference: TicketReference,
  deps: ContextProviderDeps,
): Promise<ReadResult<PrimarySnippet>> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, transport.timeoutMs);
  deps.signal.addEventListener("abort", abort, { once: true });
  if (deps.signal.aborted) abort();
  const client: NotionClient = {
    transport,
    session: { token, signal: controller.signal },
  };

  try {
    const page = await findPage(client, reference);
    if (!page.ok) return page;
    const body = await readPageBody(client, page.value.id, deps.log);
    if (!body.ok) return body;

    const values = collectPropertyValues(page.value);
    const key = findKey(values);
    const pageId = normalizePageId(page.value.id);
    deps.log(
      `notion: read ${key === "" ? pageId : key} (${body.value.length} chars)`,
    );
    return {
      ok: true,
      value: {
        providerId: ContextProviderTypes.NOTION,
        source: `https://www.notion.so/${pageId}`,
        text: body.value,
        tracker: TicketTrackers.NOTION,
        key,
        title: findTitle(values),
        header: buildHeader(values, key),
        foundIn: reference.foundIn,
      },
    };
  } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener("abort", abort);
  }
}

/**
 * Notion's read for one root: no slot, no read. Then it needs a
 * `contextSources:` entry of type `notion` and its token in the shared env,
 * by name. A key goes through the board's data source, a page URL straight
 * to the page.
 */
export function createNotionRead(
  shared: SharedRootDeps,
  transport: NotionTransport | undefined,
): Result<PrimaryRead, ConfigError> {
  if (transport === undefined) {
    return refuseTrackerRead(["notion: no transport bound at this root"]);
  }
  const entry = shared.contextSources.find(
    (source) => source.type === ContextProviderTypes.NOTION,
  );
  if (entry === undefined) {
    return refuseTrackerRead([
      "notion: no `contextSources` entry of type notion on this deployment",
    ]);
  }
  const token = resolveTokenByName(
    shared.env,
    entry.tokenEnv ?? DEFAULT_NOTION_TOKEN_ENV,
    "notion",
  );
  if (!token.ok) return token;

  return {
    ok: true,
    value: {
      kind: TicketTrackers.NOTION,
      readPrimary: (reference, deps) =>
        readNotionPrimary(transport, token.value, reference, deps),
    },
  };
}
