import { describe, expect, it } from "vitest";
import { fetchContextSnippets } from "../../src/context/fan-out";
import { toPrimaryTicket } from "../../src/context/primary";
import type { TicketReference } from "../../src/context/references";
import {
  ContextProviderTypes,
  type ContextProvider,
  type PrimarySnippet,
} from "../../src/context/types";
import { TicketUnreadReasons } from "../../src/types";

const reference: TicketReference = {
  tracker: "github",
  key: "",
  number: 7,
  url: "https://github.com/o/r/issues/7",
  foundIn: "description",
  closing: true,
};

const snippet: PrimarySnippet = {
  providerId: ContextProviderTypes.URL,
  source: reference.url,
  text: "Make the retry loop stop after three attempts.",
  tracker: "github",
  key: "",
  title: "Retry loop",
  header: "open · bug",
  foundIn: "description",
};

const query = {
  title: "t",
  body: "fixes #7",
  headRef: "",
  repo: { owner: "o", repo: "r" },
  primary: reference,
};

function stubUrlProvider(): ContextProvider {
  return {
    providerId: ContextProviderTypes.URL,
    fetch: async () => ({ ok: true, value: [] }),
  };
}

function stubIssueProvider(
  readPrimary: NonNullable<ContextProvider["readPrimary"]>,
): ContextProvider {
  return {
    providerId: ContextProviderTypes.URL,
    tracker: "github",
    fetch: async () => ({ ok: true, value: [] }),
    readPrimary,
  };
}

describe("fetchContextSnippets: the primary ticket", () => {
  it("is absent when the query names no primary", async () => {
    const { primary: _drop, ...noPrimary } = query;
    const outcome = await fetchContextSnippets(noPrimary, [stubUrlProvider()]);
    expect(outcome.primaryTicket).toBeUndefined();
  });

  it("is unread/unsupported when no provider reads the tracker", async () => {
    const { primaryTicket } = await fetchContextSnippets(query, [
      stubUrlProvider(),
    ]);
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: TicketUnreadReasons.UNSUPPORTED,
      reference,
    });
  });

  it("is read through the provider that owns the tracker", async () => {
    const provider = stubIssueProvider(async () => ({
      ok: true,
      value: snippet,
    }));
    const { primaryTicket } = await fetchContextSnippets(query, [provider]);
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });

  it("carries the provider's failure reason when the read fails", async () => {
    const logs: string[] = [];
    const provider = stubIssueProvider(async () => ({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND, detail: "404" },
    }));
    const { primaryTicket } = await fetchContextSnippets(
      query,
      [provider],
      (m) => logs.push(m),
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: TicketUnreadReasons.NOT_FOUND,
    });
    expect(logs.some((l) => l.includes("not-found"))).toBe(true);
  });

  it("is unread/timeout when the read outlives its budget", async () => {
    const provider = stubIssueProvider(() => new Promise(() => undefined));
    const { primaryTicket } = await fetchContextSnippets(
      query,
      [provider],
      () => {},
      { timeoutMs: 10 },
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: TicketUnreadReasons.TIMEOUT,
    });
  });

  it("is unread/timeout-shaped when the provider throws, never a crash", async () => {
    const provider = stubIssueProvider(async () => {
      throw new Error("boom");
    });
    const { primaryTicket } = await fetchContextSnippets(query, [provider]);
    expect(primaryTicket?.status).toBe("unread");
  });

  it("a supplied primary replaces the read and is stamped as read", async () => {
    const provider = stubIssueProvider(async () => {
      throw new Error("must not be called");
    });
    const { primaryTicket } = await fetchContextSnippets(
      query,
      [provider],
      () => {},
      { suppliedPrimary: snippet },
    );
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });
});

describe("fetchContextSnippets: a supplied primary's provenance", () => {
  it("takes only its location from the parsed reference", async () => {
    const notionRef: TicketReference = {
      tracker: "notion",
      key: "BRIEF-1",
      url: "",
      foundIn: "branch",
      closing: false,
    };
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: notionRef },
      [],
      () => {},
      { suppliedPrimary: { ...snippet, tracker: "notion", key: "DS-42" } },
    );
    expect(primaryTicket).toEqual({
      status: "read",
      snippet: {
        ...snippet,
        tracker: "notion",
        key: "DS-42",
        foundIn: "branch",
      },
    });
  });

  it("stands alone when no reference matched", async () => {
    const { primary: _drop, ...noPrimary } = query;
    const { primaryTicket } = await fetchContextSnippets(
      noPrimary,
      [],
      () => {},
      {
        suppliedPrimary: snippet,
      },
    );
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });
});

describe("toPrimaryTicket", () => {
  it("maps a read snippet to the stored shape", () => {
    expect(toPrimaryTicket({ status: "read", snippet })).toEqual({
      key: "",
      url: reference.url,
      tracker: "github",
      foundIn: "description",
      title: "Retry loop",
      header: "open · bug",
      status: "read",
      reason: "",
    });
  });

  it("maps an unread reference with empty title and header", () => {
    expect(
      toPrimaryTicket({
        status: "unread",
        reference,
        reason: TicketUnreadReasons.NO_CREDENTIAL,
        detail: "exit 4",
      }),
    ).toEqual({
      key: "",
      url: reference.url,
      tracker: "github",
      foundIn: "description",
      title: "",
      header: "",
      status: "unread",
      reason: "no-credential",
    });
  });
});
