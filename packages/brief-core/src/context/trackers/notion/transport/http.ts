import { z } from "zod/v4";
import { TicketUnreadReasons } from "../../../../types";
import {
  failRead,
  type NotionBlock,
  type NotionBlockPage,
  type NotionPage,
  type NotionSession,
  type NotionTransport,
  type ReadResult,
} from "./port";

const NOTION_API_BASE = "https://api.notion.com";
const NOTION_API_VERSION = "2025-09-03";
const DEFAULT_TIMEOUT_MS = 10_000;
const BLOCK_PAGE_SIZE = 100;

/** The `fetch` slice the HTTP transport uses; injectable so tests replay fixtures. */
export type NotionFetch = (
  url: string,
  init: {
    method?: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<Response>;

export interface NotionHttpTransportOptions {
  readonly fetch?: NotionFetch | undefined;
  readonly timeoutMs?: number | undefined;
}

// --- wire shapes: what api.notion.com answers, decoded here and nowhere else

const errorBodySchema = z.looseObject({ code: z.string().optional() });

const databaseSchema = z.looseObject({
  data_sources: z.array(z.looseObject({ id: z.string() })),
});

const dataSourceSchema = z.looseObject({
  properties: z.record(z.string(), z.unknown()),
});

const pageSchema = z.looseObject({
  id: z.string(),
  properties: z.record(z.string(), z.unknown()),
});

const pageListSchema = z.looseObject({ results: z.array(z.unknown()) });

const blockListSchema = z.looseObject({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
});

const blockSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  has_children: z.boolean().optional(),
});

/** Notion error codes are snake_case words; anything else is not echoed. */
const ERROR_CODE_TOKEN = /^[a-z_]{1,40}$/;

interface HttpCall {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Map a non-2xx answer to the closed reason set. Notion cannot tell a
 * missing page from one not shared with the integration, so both are
 * `not-found`; anything else that is not a credential or a rate limit is
 * "no usable answer", the fan-out's own shape for a broken read.
 */
function describeHttpFailure(status: number, body: string): ReadResult<never> {
  const parsed = errorBodySchema.safeParse(parseJson(body));
  const code = parsed.success ? parsed.data.code : undefined;
  const codeSuffix =
    code !== undefined && ERROR_CODE_TOKEN.test(code) ? ` ${code}` : "";
  const detail = `notion answered ${status}${codeSuffix}`;

  if (status === 404) return failRead(TicketUnreadReasons.NOT_FOUND, detail);
  if (status === 401 || status === 403)
    return failRead(TicketUnreadReasons.NO_CREDENTIAL, detail);
  if (status === 429 || status === 529)
    return failRead(TicketUnreadReasons.RATE_LIMITED, detail);
  return failRead(TicketUnreadReasons.TIMEOUT, detail);
}

/** Decode an answer at the boundary; a shape drift is a broken read, never a throw. */
function decode<Shape>(
  schema: z.ZodType<Shape>,
  json: unknown,
  what: string,
): ReadResult<Shape> {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return failRead(
      TicketUnreadReasons.TIMEOUT,
      `notion ${what} had an unexpected shape`,
    );
  }
  return { ok: true, value: parsed.data };
}

function toPage(raw: z.infer<typeof pageSchema>): NotionPage {
  return { id: raw.id, properties: raw.properties };
}

function toBlockPage(raw: z.infer<typeof blockListSchema>): NotionBlockPage {
  const blocks: NotionBlock[] = [];
  for (const entry of raw.results) {
    const block = blockSchema.safeParse(entry);
    if (!block.success) continue;
    const { id, type, has_children: hasChildren } = block.data;
    blocks.push({
      id,
      type,
      hasChildren: hasChildren === true,
      payload: Reflect.get(block.data, type),
    });
  }
  const nextCursor =
    raw.has_more === true ? (raw.next_cursor ?? undefined) : undefined;
  return { blocks, nextCursor };
}

/** One call under the session's budget; the path never carries a secret. */
async function requestHttp(
  fetch: NotionFetch,
  timeoutMs: number,
  session: NotionSession,
  call: HttpCall,
): Promise<ReadResult<unknown>> {
  const url = new URL(call.path, NOTION_API_BASE);
  for (const [name, value] of Object.entries(call.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    "Notion-Version": NOTION_API_VERSION,
  };
  const init: Parameters<NotionFetch>[1] = {
    method: call.method,
    headers,
    signal: session.signal,
  };
  if (call.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(call.body);
  }

  let response: Response;
  let text: string;
  try {
    response = await fetch(url.toString(), init);
    text = await response.text();
  } catch {
    if (session.signal.aborted) {
      return failRead(
        TicketUnreadReasons.TIMEOUT,
        `no answer within ${timeoutMs} ms`,
      );
    }
    return failRead(
      TicketUnreadReasons.TIMEOUT,
      `notion unreachable (${call.path})`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    return describeHttpFailure(response.status, text);
  }
  const json = parseJson(text);
  if (json === undefined) {
    return failRead(
      TicketUnreadReasons.TIMEOUT,
      `notion sent unreadable JSON (${call.path})`,
    );
  }
  return { ok: true, value: json };
}

/** The one transport: direct calls to api.notion.com. */
export function createNotionHttpTransport(
  options: NotionHttpTransportOptions = {},
): NotionTransport {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = (
    session: NotionSession,
    call: HttpCall,
  ): Promise<ReadResult<unknown>> =>
    requestHttp(fetch, timeoutMs, session, call);

  return {
    timeoutMs,

    async getDatabase(session, databaseId) {
      const answer = await request(session, {
        method: "GET",
        path: `/v1/databases/${databaseId}`,
      });
      if (!answer.ok) return answer;
      const database = decode(databaseSchema, answer.value, "database");
      if (!database.ok) return database;
      const dataSourceIds = database.value.data_sources.map(
        (source) => source.id,
      );
      return { ok: true, value: { dataSourceIds } };
    },

    async getDataSource(session, dataSourceId) {
      const answer = await request(session, {
        method: "GET",
        path: `/v1/data_sources/${dataSourceId}`,
      });
      if (!answer.ok) return answer;
      const source = decode(dataSourceSchema, answer.value, "data source");
      if (!source.ok) return source;
      return { ok: true, value: { properties: source.value.properties } };
    },

    async queryByUniqueId(session, dataSourceId, filter) {
      const answer = await request(session, {
        method: "POST",
        path: `/v1/data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            property: filter.propertyName,
            unique_id: { equals: filter.number },
          },
          page_size: 1,
        },
      });
      if (!answer.ok) return answer;
      const pages = decode(pageListSchema, answer.value, "query");
      if (!pages.ok) return pages;
      const [first] = pages.value.results;
      if (first === undefined) return { ok: true, value: undefined };
      const page = decode(pageSchema, first, "page");
      if (!page.ok) return page;
      return { ok: true, value: toPage(page.value) };
    },

    async getPage(session, pageId) {
      const answer = await request(session, {
        method: "GET",
        path: `/v1/pages/${pageId}`,
      });
      if (!answer.ok) return answer;
      const page = decode(pageSchema, answer.value, "page");
      if (!page.ok) return page;
      return { ok: true, value: toPage(page.value) };
    },

    async listBlockChildren(session, blockId, cursor) {
      const query: Record<string, string> = {
        page_size: String(BLOCK_PAGE_SIZE),
      };
      if (cursor !== undefined) query["start_cursor"] = cursor;
      const answer = await request(session, {
        method: "GET",
        path: `/v1/blocks/${blockId}/children`,
        query,
      });
      if (!answer.ok) return answer;
      const list = decode(blockListSchema, answer.value, "block list");
      if (!list.ok) return list;
      return { ok: true, value: toBlockPage(list.value) };
    },
  };
}
