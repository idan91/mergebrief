/**
 * Key path: databases → data source schema → query by unique_id number, page
 * prefix equal to the tracker's case-insensitively; a prefix miss, an empty
 * query and a 404 are all `not-found`. URL path: one page read, no board.
 * Body: one line per block, nested indented, pages of 100, capped at 20,000
 * chars. Header: title · Status · Type · Priority · assignees · key, empty
 * pieces omitted. 401/403 `no-credential`, 429 `rate-limited`, abort `timeout`.
 * Every request carries the bearer and API version; no detail or log line
 * carries the token, a body or a query; bad JSON or shape never throws.
 */
import { describe, expect, it } from "vitest";
import { createNotionRead } from "../../../../src/context/trackers/notion";
import {
  NotionTransports,
  type NotionHttpTransportOptions,
} from "../../../../src/context/trackers/notion";
import {
  ContextProviderTypes,
  type ContextProviderDeps,
} from "../../../../src/context/types";
import type { TicketReference } from "../../../../src/context/trackers/types";
import { TicketUnreadReasons } from "../../../../src/types";

const TOKEN = "ntn_secret_value_never_shown";
/** The walk's cap on child-list calls per read. */
const MAX_CHILD_LIST_CALLS = 50;
/** More toggles than the cap, each with an empty child list. */
const TOGGLE_COUNT = 80;
const DATABASE_ID = "a".repeat(32);
const DATA_SOURCE_ID = "d".repeat(32);
const PAGE_ID = "3cf5e9400eeb81f9bed9e1474c2cb4d4";
const PAGE_ID_DASHED = "3cf5e940-0eeb-81f9-bed9-e1474c2cb4d4";

interface Recorded {
  readonly status: number;
  readonly body: unknown;
  readonly raw?: string;
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly redirect: string | undefined;
}

/** A recorded Notion: routes keyed `METHOD /path` (query string ignored). */
function stubFetch(routes: Record<string, Recorded | Recorded[]>) {
  const calls: Call[] = [];
  const served = new Map<string, number>();
  const fetch = async (
    url: string,
    init: {
      method?: string;
      headers: Record<string, string>;
      body?: string;
      signal: AbortSignal;
      redirect?: string;
    },
  ): Promise<Response> => {
    const method = init.method ?? "GET";
    const key = `${method} ${new URL(url).pathname}`;
    calls.push({
      method,
      url,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      redirect: init.redirect,
    });
    const route = routes[key];
    if (route === undefined) {
      return new Response(
        JSON.stringify({
          object: "error",
          status: 404,
          code: "object_not_found",
        }),
        { status: 404 },
      );
    }
    const sequence = Array.isArray(route) ? route : [route];
    const index = Math.min(served.get(key) ?? 0, sequence.length - 1);
    served.set(key, index + 1);
    const hit = sequence[index] ?? sequence[0]!;
    const payload = hit.raw ?? JSON.stringify(hit.body);
    return new Response(payload, { status: hit.status });
  };
  return { fetch, calls };
}

function makeRichText(plain: string) {
  return [{ type: "text", plain_text: plain }];
}

function makeBlock(
  id: string,
  type: string,
  plain: string,
  extra: Record<string, unknown> = {},
) {
  return {
    object: "block",
    id,
    type,
    has_children: false,
    [type]: { rich_text: makeRichText(plain) },
    ...extra,
  };
}

function makeListPage(results: unknown[], nextCursor: string | null = null) {
  return {
    object: "list",
    results,
    has_more: nextCursor !== null,
    next_cursor: nextCursor,
  };
}

const PAGE = {
  object: "page",
  id: PAGE_ID_DASHED,
  url: `https://www.notion.so/Build-the-Notion-provider-${PAGE_ID}`,
  properties: {
    Name: {
      id: "title",
      type: "title",
      title: makeRichText("Build the Notion provider"),
    },
    Status: { type: "status", status: { name: "In progress", color: "blue" } },
    Type: { type: "select", select: { name: "Build" } },
    Priority: { type: "select", select: null },
    Assignee: {
      type: "people",
      people: [{ object: "user", id: "u1", name: "Idan" }],
    },
    Reviewer: { type: "people", people: [{ object: "user", id: "u2" }] },
    ID: { type: "unique_id", unique_id: { prefix: "BRIEF", number: 239 } },
    Estimate: { type: "formula", formula: { type: "number", number: 3 } },
    Weird: "not an object",
  },
};

const DATABASE = {
  object: "database",
  id: DATABASE_ID,
  data_sources: [{ id: DATA_SOURCE_ID, name: "Board" }],
};

const DATA_SOURCE = {
  object: "data_source",
  id: DATA_SOURCE_ID,
  properties: {
    Name: { id: "title", name: "Name", type: "title", title: {} },
    ID: {
      id: "x%3Ay",
      name: "ID",
      type: "unique_id",
      unique_id: { prefix: "BRIEF" },
    },
  },
};

const BODY = makeListPage([
  makeBlock("b1", "paragraph", "Goal: read a ticket from Notion."),
  makeBlock("b2", "heading_2", "Acceptance"),
  makeBlock("b3", "bulleted_list_item", "key lookup works", {
    has_children: true,
  }),
  makeBlock("b4", "to_do", "URL lookup works", {
    to_do: { rich_text: makeRichText("URL lookup works"), checked: true },
  }),
  {
    object: "block",
    id: "b5",
    type: "table_row",
    has_children: false,
    table_row: { cells: [makeRichText("a"), makeRichText("b")] },
  },
  {
    object: "block",
    id: "b6",
    type: "child_page",
    has_children: true,
    child_page: { title: "Sub page" },
  },
  {
    object: "block",
    id: "b7",
    type: "divider",
    has_children: false,
    divider: {},
  },
]);

const NESTED = makeListPage([
  makeBlock("b3a", "bulleted_list_item", "by prefix and number"),
]);

function makeKeyReference(key = "BRIEF-239"): TicketReference {
  return {
    tracker: "notion",
    key,
    url: "",
    databaseId: DATABASE_ID,
    foundIn: "description",
    closing: false,
  };
}

function makeUrlReference(): TicketReference {
  return {
    tracker: "notion",
    key: "",
    pageId: PAGE_ID,
    url: `https://www.notion.so/${PAGE_ID}`,
    foundIn: "title",
    closing: false,
  };
}

function stubDeps(
  logs: string[] = [],
  signal = new AbortController().signal,
): ContextProviderDeps {
  return { log: (m) => logs.push(m), signal };
}

const KEY_ROUTES = {
  [`GET /v1/databases/${DATABASE_ID}`]: { status: 200, body: DATABASE },
  [`GET /v1/data_sources/${DATA_SOURCE_ID}`]: {
    status: 200,
    body: DATA_SOURCE,
  },
  [`POST /v1/data_sources/${DATA_SOURCE_ID}/query`]: {
    status: 200,
    body: makeListPage([PAGE]),
  },
  [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: { status: 200, body: BODY },
  "GET /v1/blocks/b3/children": { status: 200, body: NESTED },
};

const URL_ROUTES = {
  [`GET /v1/pages/${PAGE_ID}`]: { status: 200, body: PAGE },
  [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: { status: 200, body: BODY },
  "GET /v1/blocks/b3/children": { status: 200, body: NESTED },
};

async function readThroughProvider(
  routes: Record<string, Recorded | Recorded[]>,
  reference: TicketReference,
  options: { logs?: string[]; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const recorded = stubFetch(routes);
  const provider = readWith({
    fetch: recorded.fetch,
    timeoutMs: options.timeoutMs,
  });
  const result = await provider.readPrimary(
    reference,
    stubDeps(options.logs, options.signal),
  );
  return { result, calls: recorded.calls, provider };
}

/** The shared deps of a root that lists Notion and holds its token; the tests' one way in. */
const SHARED = {
  env: { NOTION_TOKEN: TOKEN },
  contextSources: [{ type: "notion" as const }],
};

function readWith(options: NotionHttpTransportOptions = {}) {
  const read = createNotionRead(SHARED, NotionTransports.HTTP.create(options));
  if (!read.ok) {
    throw new Error("unreachable");
  }
  return read.value;
}

describe("createNotionRead", () => {
  it("declares the notion kind for a root that lists Notion with its token", () => {
    expect(readWith().kind).toBe("notion");
  });

  it("refuses a root with no Notion slot", () => {
    const read = createNotionRead(SHARED, undefined);
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.error.issues[0]).toMatch(/no transport/);
  });

  it("refuses a root whose config lists no Notion source", () => {
    const read = createNotionRead(
      { env: { NOTION_TOKEN: TOKEN }, contextSources: [] },
      NotionTransports.HTTP.create(),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    expect(read.error.issues.join("; ")).toContain("contextSources");
  });

  it("reads the named token var and refuses an unset one without echoing it", () => {
    const named = createNotionRead(
      {
        env: { MY_NOTION: "ntn_y" },
        contextSources: [{ type: "notion", tokenEnv: "MY_NOTION" }],
      },
      NotionTransports.HTTP.create(),
    );
    expect(named.ok).toBe(true);
    const unset = createNotionRead(
      {
        env: { NOTION_TOKEN: "ntn_should_not_leak" },
        contextSources: [{ type: "notion", tokenEnv: "MY_NOTION" }],
      },
      NotionTransports.HTTP.create(),
    );
    expect(unset.ok).toBe(false);
    if (unset.ok) {
      return;
    }
    const text = unset.error.issues.join("; ");
    expect(text).toContain("MY_NOTION");
    expect(text).not.toContain("ntn_");
  });

  it("refuses a token pasted where the var NAME belongs without echoing it", () => {
    const read = createNotionRead(
      {
        env: {},
        contextSources: [{ type: "notion", tokenEnv: "ntn_pasted-value" }],
      },
      NotionTransports.HTTP.create(),
    );
    expect(read.ok).toBe(false);
    if (read.ok) {
      return;
    }
    const text = read.error.issues.join("; ");
    expect(text).toContain("NAME");
    expect(text).not.toContain("ntn_pasted");
  });

  it("reads a key via its named data source: data source, query, blocks", async () => {
    const { result, calls } = await readThroughProvider(KEY_ROUTES, {
      ...makeKeyReference(),
      databaseId: DATA_SOURCE_ID,
    });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v1/data_sources/${DATA_SOURCE_ID}`,
      `POST /v1/data_sources/${DATA_SOURCE_ID}/query`,
      `GET /v1/blocks/${PAGE_ID_DASHED}/children`,
      "GET /v1/blocks/b3/children",
    ]);
  });

  it("reads a key via a named database: database, source, query, blocks", async () => {
    const { result, calls } = await readThroughProvider(
      KEY_ROUTES,
      makeKeyReference(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v1/data_sources/${DATABASE_ID}`,
      `GET /v1/databases/${DATABASE_ID}`,
      `GET /v1/data_sources/${DATA_SOURCE_ID}`,
      `POST /v1/data_sources/${DATA_SOURCE_ID}/query`,
      `GET /v1/blocks/${PAGE_ID_DASHED}/children`,
      "GET /v1/blocks/b3/children",
    ]);
    expect(calls[3]?.body).toEqual({
      filter: { property: "ID", unique_id: { equals: 239 } },
      page_size: 1,
    });
    expect(result.value).toMatchObject({
      providerId: ContextProviderTypes.NOTION,
      tracker: "notion",
      key: "BRIEF-239",
      source: `https://www.notion.so/${PAGE_ID}`,
      title: "Build the Notion provider",
      header:
        "Build the Notion provider · In progress · Build · Idan · BRIEF-239",
      foundIn: "description",
    });
    expect(result.value.text).toBe(
      [
        "Goal: read a ticket from Notion.",
        "## Acceptance",
        "- key lookup works",
        "  - by prefix and number",
        "[x] URL lookup works",
        "a | b",
        "Sub page",
      ].join("\n"),
    );
  });

  it("reads the data source carrying the prefix when the board holds several", async () => {
    const otherId = "e".repeat(32);
    const other = {
      ...DATA_SOURCE,
      id: otherId,
      properties: {
        ...DATA_SOURCE.properties,
        ID: { ...DATA_SOURCE.properties.ID, unique_id: { prefix: "OTHER" } },
      },
    };
    const { result, calls } = await readThroughProvider(
      {
        ...KEY_ROUTES,
        [`GET /v1/databases/${DATABASE_ID}`]: {
          status: 200,
          body: {
            ...DATABASE,
            data_sources: [
              { id: otherId, name: "Other" },
              { id: DATA_SOURCE_ID, name: "Board" },
            ],
          },
        },
        [`GET /v1/data_sources/${otherId}`]: { status: 200, body: other },
      },
      makeKeyReference(),
    );
    expect(result.ok).toBe(true);
    expect(
      calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ).toContain(`POST /v1/data_sources/${DATA_SOURCE_ID}/query`);
  });

  it("is not-found and names the fix when many data sources carry the prefix", async () => {
    const twinId = "f".repeat(32);
    const { result, calls } = await readThroughProvider(
      {
        ...KEY_ROUTES,
        [`GET /v1/databases/${DATABASE_ID}`]: {
          status: 200,
          body: {
            ...DATABASE,
            data_sources: [
              { id: DATA_SOURCE_ID, name: "Board" },
              { id: twinId, name: "Twin" },
            ],
          },
        },
        [`GET /v1/data_sources/${twinId}`]: {
          status: 200,
          body: { ...DATA_SOURCE, id: twinId },
        },
      },
      makeKeyReference(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND },
    });
    if (result.ok) {
      return;
    }
    expect(result.error.detail).toContain("name the data source id");
    expect(calls.some((call) => call.url.includes("/query"))).toBe(false);
  });

  it("matches the key prefix case-insensitively", async () => {
    const { result } = await readThroughProvider(
      KEY_ROUTES,
      makeKeyReference("brief-239"),
    );
    expect(result.ok).toBe(true);
  });

  it("is not-found when the board's unique-id prefix is another tracker's", async () => {
    const { result, calls } = await readThroughProvider(
      KEY_ROUTES,
      makeKeyReference("DS-239"),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND },
    });
    expect(calls).toHaveLength(3);
  });

  it("is not-found when the returned page carries another prefix", async () => {
    const page = {
      ...PAGE,
      properties: {
        ...PAGE.properties,
        ID: { type: "unique_id", unique_id: { prefix: "OTHER", number: 239 } },
      },
    };
    const { result } = await readThroughProvider(
      {
        ...KEY_ROUTES,
        [`POST /v1/data_sources/${DATA_SOURCE_ID}/query`]: {
          status: 200,
          body: makeListPage([page]),
        },
      },
      makeKeyReference(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND },
    });
  });

  it("is not-found when the query returns no page", async () => {
    const { result } = await readThroughProvider(
      {
        ...KEY_ROUTES,
        [`POST /v1/data_sources/${DATA_SOURCE_ID}/query`]: {
          status: 200,
          body: makeListPage([]),
        },
      },
      makeKeyReference(),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND },
    });
  });

  it("reads a page URL with one page read and no board", async () => {
    const { result, calls } = await readThroughProvider(
      URL_ROUTES,
      makeUrlReference(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(calls[0]?.url).toBe(`https://api.notion.com/v1/pages/${PAGE_ID}`);
    expect(result.value).toMatchObject({
      key: "BRIEF-239",
      source: `https://www.notion.so/${PAGE_ID}`,
      title: "Build the Notion provider",
      foundIn: "title",
    });
  });

  it("sends the bearer, the API version and JSON on every request", async () => {
    const { calls } = await readThroughProvider(KEY_ROUTES, makeKeyReference());
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(call.headers["Notion-Version"]).toBe("2025-09-03");
    }
    expect(calls[3]?.headers["Content-Type"]).toBe("application/json");
  });

  it("refuses to follow a redirect on every request", async () => {
    const { calls } = await readThroughProvider(KEY_ROUTES, makeKeyReference());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.map((call) => call.redirect)).toEqual(
      calls.map(() => "error"),
    );
  });

  it("stops the block walk at 50 child-list calls", async () => {
    const toggles = Array.from({ length: TOGGLE_COUNT }, (_, index) => ({
      ...makeBlock(`t${index}`, "toggle", ""),
      has_children: true,
    }));
    const routes: Record<string, Recorded> = {
      [`GET /v1/pages/${PAGE_ID}`]: { status: 200, body: PAGE },
      [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: {
        status: 200,
        body: makeListPage(toggles),
      },
    };
    for (const toggle of toggles) {
      routes[`GET /v1/blocks/${toggle.id}/children`] = {
        status: 200,
        body: makeListPage([]),
      };
    }

    const { result, calls } = await readThroughProvider(
      routes,
      makeUrlReference(),
    );
    expect(result.ok).toBe(true);
    const blockCalls = calls.filter((call) => call.url.includes("/children"));
    expect(blockCalls).toHaveLength(MAX_CHILD_LIST_CALLS);
  });

  it("omits empty header pieces and reads the page's key on the URL path", async () => {
    const page = {
      ...PAGE,
      properties: {
        Name: { type: "title", title: makeRichText("Bare page") },
        Status: { type: "status", status: null },
      },
    };
    const { result } = await readThroughProvider(
      {
        ...URL_ROUTES,
        [`GET /v1/pages/${PAGE_ID}`]: { status: 200, body: page },
      },
      makeUrlReference(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.header).toBe("Bare page");
    expect(result.value.key).toBe("");
  });

  it("follows block pages and stops at the 20,000-char cap", async () => {
    const big = "x".repeat(9_000);
    const routes = {
      ...URL_ROUTES,
      [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: [
        {
          status: 200,
          body: makeListPage([makeBlock("p1", "paragraph", big)], "cursor-2"),
        },
        {
          status: 200,
          body: makeListPage([makeBlock("p2", "paragraph", big)], "cursor-3"),
        },
        {
          status: 200,
          body: makeListPage([makeBlock("p3", "paragraph", big)], "cursor-4"),
        },
        {
          status: 200,
          body: makeListPage([makeBlock("p4", "paragraph", big)]),
        },
      ],
    };
    const { result, calls } = await readThroughProvider(
      routes,
      makeUrlReference(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.text).toHaveLength(20_000);
    const blockCalls = calls.filter((c) => c.url.includes("/children"));
    expect(blockCalls).toHaveLength(3);
    expect(new URL(blockCalls[1]!.url).searchParams.get("start_cursor")).toBe(
      "cursor-2",
    );
    expect(new URL(blockCalls[0]!.url).searchParams.get("page_size")).toBe(
      "100",
    );
  });

  it.each([
    [
      404,
      { object: "error", code: "object_not_found" },
      TicketUnreadReasons.NOT_FOUND,
    ],
    [
      401,
      { object: "error", code: "unauthorized" },
      TicketUnreadReasons.NO_CREDENTIAL,
    ],
    [
      403,
      { object: "error", code: "restricted_resource" },
      TicketUnreadReasons.NO_CREDENTIAL,
    ],
    [
      429,
      { object: "error", code: "rate_limited" },
      TicketUnreadReasons.RATE_LIMITED,
    ],
    [
      503,
      { object: "error", code: "service_unavailable" },
      TicketUnreadReasons.TIMEOUT,
    ],
  ])("maps HTTP %s to %s", async (status, body, reason) => {
    const { result, calls } = await readThroughProvider(
      { [`GET /v1/pages/${PAGE_ID}`]: { status, body } },
      makeUrlReference(),
    );
    expect(result).toMatchObject({ ok: false, error: { reason } });
    expect(calls).toHaveLength(1);
  });

  it("keeps a read whose leading container's children cannot be fetched", async () => {
    const logs: string[] = [];
    const routes = {
      ...URL_ROUTES,
      [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: [
        {
          status: 200,
          body: makeListPage([
            { ...makeBlock("s1", "synced_block", ""), has_children: true },
            makeBlock("p2", "paragraph", "After the header"),
          ]),
        },
      ],
      "GET /v1/blocks/s1/children": [
        { status: 403, body: { code: "restricted_resource" } },
      ],
    };
    const { result } = await readThroughProvider(routes, makeUrlReference(), {
      logs,
    });
    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.includes("block walk ended early"))).toBe(true);
  });

  it("keeps what was read when a nested children call fails", async () => {
    const routes = {
      ...URL_ROUTES,
      [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: [
        {
          status: 200,
          body: makeListPage([
            makeBlock("p1", "paragraph", "First"),
            { ...makeBlock("t1", "toggle", "Toggle"), has_children: true },
            makeBlock("p2", "paragraph", "Last"),
          ]),
        },
      ],
      "GET /v1/blocks/t1/children": [
        { status: 403, body: { code: "restricted_resource" } },
      ],
    };
    const { result } = await readThroughProvider(routes, makeUrlReference());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.text).toBe("First\nToggle");
  });

  it("stays a failure when the page's own first block call fails", async () => {
    const routes = {
      ...URL_ROUTES,
      [`GET /v1/blocks/${PAGE_ID_DASHED}/children`]: [
        { status: 403, body: { code: "restricted_resource" } },
      ],
    };
    const { result } = await readThroughProvider(routes, makeUrlReference());
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "no-credential" },
    });
  });

  it("never retries a 429", async () => {
    const { calls } = await readThroughProvider(
      {
        [`GET /v1/pages/${PAGE_ID}`]: [
          { status: 429, body: {} },
          { status: 200, body: PAGE },
        ],
      },
      makeUrlReference(),
    );
    expect(calls).toHaveLength(1);
  });

  it("is a timeout when the budget runs out, aborting the request", async () => {
    let seenAbort = false;
    const fetch = (
      _url: string,
      init: { signal: AbortSignal },
    ): Promise<Response> =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          seenAbort = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const provider = readWith({ fetch, timeoutMs: 20 });
    const result = await provider.readPrimary(makeUrlReference(), stubDeps());
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
    expect(seenAbort).toBe(true);
  });

  it("is a timeout when the fan-out's signal aborts", async () => {
    const controller = new AbortController();
    const fetch = (
      _url: string,
      init: { signal: AbortSignal },
    ): Promise<Response> =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const provider = readWith({ fetch });
    const pending = provider.readPrimary(
      makeUrlReference(),
      stubDeps([], controller.signal),
    );
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
  });

  it("never throws on malformed JSON or an unexpected shape", async () => {
    const malformed = await readThroughProvider(
      {
        [`GET /v1/pages/${PAGE_ID}`]: {
          status: 200,
          body: null,
          raw: "{not json",
        },
      },
      makeUrlReference(),
    );
    expect(malformed.result.ok).toBe(false);
    const shape = await readThroughProvider(
      {
        [`GET /v1/pages/${PAGE_ID}`]: { status: 200, body: { object: "page" } },
      },
      makeUrlReference(),
    );
    expect(shape.result.ok).toBe(false);
    const noSource = await readThroughProvider(
      {
        [`GET /v1/databases/${DATABASE_ID}`]: {
          status: 200,
          body: { data_sources: [] },
        },
      },
      makeKeyReference(),
    );
    expect(noSource.result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND },
    });
  });

  it("keeps the token, bodies and query strings out of details and logs", async () => {
    const logs: string[] = [];
    const secretBody = {
      object: "error",
      code: "object_not_found",
      message: "leak-me",
    };
    const failed = await readThroughProvider(
      { [`GET /v1/pages/${PAGE_ID}`]: { status: 404, body: secretBody } },
      makeUrlReference(),
      { logs },
    );
    const okRead = await readThroughProvider(KEY_ROUTES, makeKeyReference(), {
      logs,
    });
    expect(okRead.result.ok).toBe(true);
    const surfaced = [
      ...logs,
      failed.result.ok ? "" : failed.result.error.detail,
    ].join("\n");
    expect(surfaced).not.toContain(TOKEN);
    expect(surfaced).not.toContain("leak-me");
    expect(surfaced).not.toContain("?");
    expect(surfaced).not.toContain("Goal:");
  });

  it("refuses a key reference that names no board", async () => {
    const { databaseId: _board, ...noBoard } = makeKeyReference();
    const { result, calls } = await readThroughProvider(KEY_ROUTES, noBoard);
    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.UNSUPPORTED },
    });
    expect(calls).toHaveLength(0);
  });
});
