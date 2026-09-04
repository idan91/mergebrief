import { describe, expect, it } from "vitest";
import {
  canonicalizeTicketUrl,
  collectTicketReferences,
  resolvePrimaryTicket,
  type TicketReferenceInput,
} from "../../src/context/references";

const REPO = { owner: "acme", repo: "widget" };
const NOTION = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;
const GITHUB = { kind: "github", issuesRepo: "acme/tracker" } as const;

function makeInput(
  overrides: Partial<TicketReferenceInput>,
): TicketReferenceInput {
  return {
    title: "",
    body: "",
    branch: "",
    repo: REPO,
    readable: [],
    ...overrides,
  };
}

describe("collectTicketReferences: shapes", () => {
  it.each([
    ["BRIEF-12 in the body", ["BRIEF-12"]],
    ["brief-12 lowercase", ["BRIEF-12"]],
    ["prefix mismatch DS-12", []],
    ["word-bounded xBRIEF-12", []],
    ["word-bounded BRIEF-12x", []],
    ["hyphen-bounded pre-BRIEF-12", []],
    ["slug-tailed BRIEF-12-fix-the-loop", ["BRIEF-12"]],
    ["digit-tailed BRIEF-12x", []],
  ])("key: %s", (body, keys) => {
    const refs = collectTicketReferences(makeInput({ body, tracker: NOTION }));
    expect(refs.map((r) => r.key)).toEqual(keys);
  });

  it("keys never match without a tracker block", () => {
    expect(collectTicketReferences(makeInput({ body: "BRIEF-12" }))).toEqual(
      [],
    );
  });

  it("keys never match when the tracker is github", () => {
    expect(
      collectTicketReferences(makeInput({ body: "BRIEF-12", tracker: GITHUB })),
    ).toEqual([]);
  });

  it.each([
    ["fixes #12", ["https://github.com/acme/widget/issues/12"]],
    ["see (#12)", ["https://github.com/acme/widget/issues/12"]],
    ["word#12", []],
    ["path/#12", []],
    ["# 12 heading", []],
    ["#12abc", []],
  ])("#N: %s", (body, urls) => {
    const refs = collectTicketReferences(makeInput({ body }));
    expect(refs.map((r) => r.url)).toEqual(urls);
  });

  it("#N resolves against tracker.issuesRepo when set", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "#7", tracker: GITHUB }),
    );
    expect(refs[0]?.url).toBe("https://github.com/acme/tracker/issues/7");
  });

  it("owner/repo#N always resolves to that repo", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "see other/thing#3" }),
    );
    expect(refs[0]).toMatchObject({
      number: 3,
      url: "https://github.com/other/thing/issues/3",
    });
  });

  it("GitHub issue URLs always match; pull URLs never do", () => {
    const refs = collectTicketReferences(
      makeInput({
        body: "https://github.com/o/r/issues/9 and https://github.com/o/r/pull/10",
      }),
    );
    expect(refs.map((r) => r.url)).toEqual(["https://github.com/o/r/issues/9"]);
  });

  it("branch: a path segment starting N- resolves as #N", () => {
    const refs = collectTicketReferences(
      makeInput({ branch: "feature/12-fix-thing" }),
    );
    expect(refs[0]).toMatchObject({ number: 12, foundIn: "branch" });
  });

  it("branch: a segment not starting with N- is not a reference", () => {
    expect(
      collectTicketReferences(makeInput({ branch: "feature/fix-12" })),
    ).toEqual([]);
    expect(collectTicketReferences(makeInput({ branch: "12fix" }))).toEqual([]);
  });

  it("branch: a Jira-style segment carries the key", () => {
    const refs = collectTicketReferences(
      makeInput({
        branch: "feature/BRIEF-239-ticket-references",
        tracker: NOTION,
      }),
    );
    expect(refs[0]).toMatchObject({ key: "BRIEF-239", foundIn: "branch" });
  });

  it("branch: a key matches in the branch name", () => {
    const refs = collectTicketReferences(
      makeInput({ branch: "feature/BRIEF-239/card", tracker: NOTION }),
    );
    expect(refs[0]).toMatchObject({ key: "BRIEF-239", foundIn: "branch" });
  });

  it.each([
    [
      "https://www.notion.so/Title-3cf5e9400eeb81f9bed9e1474c2cb4d4?v=abc",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4#block",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://app.notion.com/p/3cf5e9400eeb81f9bed9e1474c2cb4d4",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://acme.notion.site/Page-3cf5e9400eeb81f9bed9e1474c2cb4d4",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://www.notion.so/acme/Board-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?p=3cf5e9400eeb81f9bed9e1474c2cb4d4&pm=s",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
  ])("notion URL %s → page id", (body, pageId) => {
    const refs = collectTicketReferences(
      makeInput({ body, readable: ["notion"] }),
    );
    expect(refs[0]).toMatchObject({
      tracker: "notion",
      pageId,
      url: `https://www.notion.so/${pageId}`,
    });
  });

  it("notion URLs never match without a token", () => {
    expect(
      collectTicketReferences(
        makeInput({
          body: "https://www.notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4",
        }),
      ),
    ).toEqual([]);
  });

  it("a notion URL without a 32-hex id is not a reference", () => {
    expect(
      collectTicketReferences(
        makeInput({
          body: "https://www.notion.so/product",
          readable: ["notion"],
        }),
      ),
    ).toEqual([]);
  });

  it("keeps the closing flag when a plain mention of the same ticket comes first", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "Part of #7. Relates to #8. Closes #8." }),
    );
    expect(refs.map((r) => [r.number, r.closing])).toEqual([
      [7, false],
      [8, true],
    ]);
    expect(resolvePrimaryTicket(refs)?.number).toBe(8);
  });

  it("dedupes by identity, keeping the first location", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "#5", body: "closes #5 and #5", branch: "5-x" }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.foundIn).toBe("description");
  });
});

describe("resolvePrimaryTicket", () => {
  it("returns undefined with no references", () => {
    expect(resolvePrimaryTicket([])).toBeUndefined();
  });

  it("prefers the description over the title over the branch", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "#1", body: "see #2", branch: "3-x" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
    const noBody = collectTicketReferences(
      makeInput({ title: "#1", branch: "3-x" }),
    );
    expect(resolvePrimaryTicket(noBody)?.number).toBe(1);
    const branchOnly = collectTicketReferences(makeInput({ branch: "3-x" }));
    expect(resolvePrimaryTicket(branchOnly)?.number).toBe(3);
  });

  it("a closing keyword in the description beats reading order", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "Related: #1.\n\nFixes #2" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
  });

  it.each([
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
    "Resolves:",
  ])("recognizes the closing keyword %s", (keyword) => {
    const refs = collectTicketReferences(
      makeInput({ body: `#1 then ${keyword} #2` }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
  });

  it("a closing keyword in the title does not outrank the description", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "fixes #9", body: "see #4" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(4);
  });

  it("with a notion tracker, a key in the title outranks a bare #N in the description", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "[BRIEF-239] x", body: "on #467", tracker: NOTION }),
    );
    expect(resolvePrimaryTicket(refs, NOTION.kind)?.key).toBe("BRIEF-239");
  });

  it("with a notion tracker, a closing #N still loses to a key", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "[BRIEF-239] x", body: "Fixes #12", tracker: NOTION }),
    );
    expect(resolvePrimaryTicket(refs, NOTION.kind)?.key).toBe("BRIEF-239");
  });

  it("with a notion tracker and no key anywhere, a bare #N still resolves", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "see #4", tracker: NOTION }),
    );
    expect(resolvePrimaryTicket(refs, NOTION.kind)?.number).toBe(4);
  });

  it("with no keyword the first reference in reading order wins", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "BRIEF-7 then #3", tracker: NOTION }),
    );
    expect(resolvePrimaryTicket(refs)?.key).toBe("BRIEF-7");
  });
});

describe("canonicalizeTicketUrl", () => {
  it.each([
    ["https://github.com/o/r/issues/9/", "https://github.com/o/r/issues/9"],
    ["https://github.com/o/r/issues/9?x=1", "https://github.com/o/r/issues/9"],
    [
      "https://github.com/o/r/issues/9#issuecomment-1",
      "https://github.com/o/r/issues/9",
    ],
    [
      "https://www.notion.so/Title-3cf5e9400eeb81f9bed9e1474c2cb4d4?v=abc",
      "https://www.notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    ["https://docs.example/a.md", "https://docs.example/a.md"],
    ["https://github.com/o/r/pull/9", "https://github.com/o/r/pull/9"],
  ])("%s → %s", (raw, canonical) => {
    expect(canonicalizeTicketUrl(raw)).toBe(canonical);
  });
});
