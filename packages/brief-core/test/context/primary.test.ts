import { describe, expect, it } from "vitest";
import { fetchContextSnippets } from "../../src/context/fan-out";
import { toPrimaryTicket } from "../../src/context/primary";
import type { TicketReference } from "../../src/context/references";
import type {
  PrimaryRead,
  TrackerReads,
} from "../../src/context/trackers/types";
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
  references: [reference],
};

function stubUrlProvider(): ContextProvider {
  return {
    providerId: ContextProviderTypes.URL,
    fetch: async () => ({ ok: true, value: [] }),
  };
}

/** The same read behind every tracker, so a test is indifferent to the reference's kind. */
function stubReads(read: PrimaryRead): TrackerReads {
  return { github: read, notion: read };
}

function stubRead(readPrimary: PrimaryRead["readPrimary"]): PrimaryRead {
  return { kind: "github", readPrimary };
}

describe("fetchContextSnippets: the primary ticket", () => {
  it("is absent when the query names no primary", async () => {
    const { primary: _drop, ...noPrimary } = query;
    const outcome = await fetchContextSnippets(noPrimary, [stubUrlProvider()]);
    expect(outcome.primaryTicket).toBeUndefined();
  });

  it("is unread/unsupported when the root has no read for the tracker", async () => {
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
    const read = stubRead(async () => ({
      ok: true,
      value: snippet,
    }));
    const { primaryTicket } = await fetchContextSnippets(query, [], undefined, {
      reads: stubReads(read),
    });
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });

  it("carries the provider's failure reason when the read fails", async () => {
    const logs: string[] = [];
    const read = stubRead(async () => ({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND, detail: "404" },
    }));
    const { primaryTicket } = await fetchContextSnippets(
      query,
      [],
      (m) => logs.push(m),
      { reads: stubReads(read) },
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: TicketUnreadReasons.NOT_FOUND,
    });
    expect(logs.some((l) => l.includes("not-found"))).toBe(true);
  });

  it("is unread/timeout when the read outlives its budget", async () => {
    const read = stubRead(() => new Promise(() => undefined));
    const { primaryTicket } = await fetchContextSnippets(query, [], () => {}, {
      timeoutMs: 10,
      reads: stubReads(read),
    });
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: TicketUnreadReasons.TIMEOUT,
    });
  });

  it("is unread/timeout-shaped when the provider throws, never a crash", async () => {
    const read = stubRead(async () => {
      throw new Error("boom");
    });
    const { primaryTicket } = await fetchContextSnippets(query, [], undefined, {
      reads: stubReads(read),
    });
    expect(primaryTicket?.status).toBe("unread");
  });

  it("reads each candidate through its own tracker's read", async () => {
    const notionRef: TicketReference = {
      tracker: "notion",
      key: "BRIEF-1",
      url: "",
      foundIn: "description",
      closing: true,
    };
    const visited: string[] = [];
    const record = stubRead(async (ref) => {
      visited.push(ref.tracker);
      return { ok: true, value: snippet };
    });
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: notionRef, references: [notionRef, reference] },
      [],
      undefined,
      { reads: { github: record, notion: record } },
    );
    expect(visited).toEqual(["notion"]);
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });

  it("reports a primary whose tracker this root cannot read as unread, touching no other read", async () => {
    const notionRef: TicketReference = {
      tracker: "notion",
      key: "BRIEF-1",
      url: "",
      foundIn: "description",
      closing: true,
    };
    const github = stubRead(async () => {
      throw new Error("must not be called");
    });
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: notionRef, references: [notionRef, reference] },
      [],
      undefined,
      { reads: { github } },
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: "unsupported",
      detail: "no notion read on this deployment",
    });
  });

  it("a supplied primary replaces the read and is stamped as read", async () => {
    const read = stubRead(async () => {
      throw new Error("must not be called");
    });
    const { primaryTicket } = await fetchContextSnippets(query, [], () => {}, {
      suppliedPrimary: snippet,
      reads: stubReads(read),
    });
    expect(primaryTicket).toEqual({ status: "read", snippet });
  });
});

describe("fetchContextSnippets: a primary that is not a ticket", () => {
  const prNumber: TicketReference = {
    ...reference,
    number: 465,
    url: "https://github.com/o/r/issues/465",
    closing: true,
  };
  const resolvedToPullRequest = {
    ok: false as const,
    error: {
      reason: TicketUnreadReasons.NOT_FOUND,
      detail: "#465 is a pull request, not an issue",
      resolvedToPullRequest: true as const,
    },
  };

  it("falls through to the next reference in parser order", async () => {
    const logs: string[] = [];
    const read = stubRead(async (ref) =>
      ref.number === 465 ? resolvedToPullRequest : { ok: true, value: snippet },
    );
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: prNumber, references: [prNumber, reference] },
      [],
      (m) => logs.push(m),
      { reads: stubReads(read) },
    );
    expect(primaryTicket).toEqual({ status: "read", snippet });
    expect(logs.some((l) => l.includes("not a ticket"))).toBe(true);
  });

  it("shares one budget across candidates", async () => {
    // The PR hit spends most of the budget; the real read then gets only
    // the remainder, which a per-candidate budget would not have cut.
    const read = stubRead(async (ref) => {
      await new Promise((r) => setTimeout(r, 30));
      return ref.number === 465
        ? resolvedToPullRequest
        : { ok: true, value: snippet };
    });
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: prNumber, references: [prNumber, reference] },
      [],
      () => {},
      { timeoutMs: 40, graceMs: 5, reads: stubReads(read) },
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: "timeout",
      reference,
    });
  });

  it("picks the next candidate by the primary rule, not by raw order", async () => {
    // Closes #465 (a PR) / See #10 / Fixes #12: the closing #12 wins over #10.
    const plain: TicketReference = {
      ...reference,
      number: 10,
      url: "https://github.com/o/r/issues/10",
      closing: false,
    };
    const closing: TicketReference = {
      ...reference,
      number: 12,
      url: "https://github.com/o/r/issues/12",
      closing: true,
    };
    const visited: number[] = [];
    const read = stubRead(async (ref) => {
      visited.push(ref.number ?? 0);
      return ref.number === 465
        ? resolvedToPullRequest
        : { ok: true, value: { ...snippet, source: ref.url } };
    });
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: prNumber, references: [prNumber, plain, closing] },
      [],
      undefined,
      { reads: stubReads(read) },
    );
    expect(visited).toEqual([465, 12]);
    expect(
      primaryTicket?.status === "read" && primaryTicket.snippet.source,
    ).toBe("https://github.com/o/r/issues/12");
  });

  it("yields no primary when every reference is a pull request", async () => {
    const read = stubRead(async () => resolvedToPullRequest);
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: prNumber, references: [prNumber] },
      [],
      undefined,
      { reads: stubReads(read) },
    );
    expect(primaryTicket).toBeUndefined();
  });

  it("keeps an ordinary not-found as the primary's outcome", async () => {
    const read = stubRead(async () => ({
      ok: false,
      error: { reason: TicketUnreadReasons.NOT_FOUND, detail: "HTTP 404" },
    }));
    const { primaryTicket } = await fetchContextSnippets(
      { ...query, primary: prNumber, references: [prNumber, reference] },
      [],
      undefined,
      { reads: stubReads(read) },
    );
    expect(primaryTicket).toMatchObject({
      status: "unread",
      reason: "not-found",
      reference: prNumber,
    });
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
