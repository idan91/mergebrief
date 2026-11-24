import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildStackQuery,
  fetchStack,
  parseRepoSlug,
  parseStackResponse,
  postReply,
} from "../src/logic/github";
import type { CommandOutcome } from "../src/types";

const RESPONSE = readFileSync(
  new URL("fixtures/stack-response.json", import.meta.url),
  "utf8",
);

function stubRunner(outcomes: readonly CommandOutcome[]) {
  const calls: (readonly string[])[] = [];
  let next = 0;
  function run(args: readonly string[]): CommandOutcome {
    calls.push(args);
    const outcome = outcomes[next] ?? {
      status: 1,
      stdout: "",
      stderr: "no stub",
    };
    next += 1;
    return outcome;
  }
  return { run, calls };
}

describe("parseRepoSlug", () => {
  it("reads ssh and https remotes", () => {
    expect(parseRepoSlug("git@github.com:idan91/mergebrief.git")).toEqual({
      ok: true,
      value: { owner: "idan91", name: "mergebrief" },
    });
    expect(parseRepoSlug("https://github.com/idan91/mergebrief\n")).toEqual({
      ok: true,
      value: { owner: "idan91", name: "mergebrief" },
    });
  });

  it("refuses a remote that is not GitHub", () => {
    expect(parseRepoSlug("git@gitlab.com:a/b.git").ok).toBe(false);
  });

  it("keeps an embedded token out of the error", () => {
    const result = parseRepoSlug("https://bot:ghp_secret@gitlab.com/a/b.git");

    expect(result.ok ? "" : result.error.message).not.toContain("ghp_secret");
  });
});

describe("parseStackResponse", () => {
  it("flattens each PR in the order asked", () => {
    const result = parseStackResponse(RESPONSE, [59, 58]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const [merged, open] = result.value;
    expect(merged?.state).toBe("MERGED");
    expect(open).toMatchObject({
      number: 58,
      head: "chore/BRIEF-476/1-pr-stack-status",
      base: "main",
      activitySince: "2026-11-24T10:00:00Z",
      threadsTruncated: true,
      reviews: [{ id: 4648695178, commentIds: [3539470933] }],
      issueComments: [
        { id: 77, author: { login: "mergebrief", isBot: true } },
        { id: 78, author: undefined },
      ],
      threads: [
        {
          isOutdated: true,
          comments: [
            { id: 3539470933, path: "tools/pr/src/main.ts", line: undefined },
          ],
        },
      ],
    });
  });

  it("counts from a push that GitHub dates before the commit", () => {
    const response = JSON.parse(RESPONSE);
    const commit = response.data.repository.pr58.commits.nodes[0].commit;
    commit.committedDate = "2026-11-24T10:30:00Z";

    const result = parseStackResponse(JSON.stringify(response), [58]);

    expect(result.ok && result.value[0]?.activitySince).toBe(
      "2026-11-24T10:20:00Z",
    );
  });

  it("falls back to the commit time when no check suite records the push", () => {
    const result = parseStackResponse(RESPONSE, [59]);

    expect(result.ok && result.value[0]?.activitySince).toBe(
      "2026-11-24T11:00:00Z",
    );
  });

  it("keeps a thread's root and its latest message, not its first page", () => {
    const response = JSON.parse(RESPONSE);
    const thread = response.data.repository.pr58.reviewThreads.nodes[0];
    thread.latest.nodes = [
      {
        ...thread.root.nodes[0],
        databaseId: 999,
        createdAt: "2026-11-24T12:00:00Z",
      },
    ];

    const result = parseStackResponse(JSON.stringify(response), [58]);

    const comments = result.ok ? result.value[0]?.threads[0]?.comments : [];
    expect(comments?.map((comment) => comment.id)).toEqual([3539470933, 999]);
  });

  it("names a PR number the repository does not have", () => {
    const result = parseStackResponse(RESPONSE, [58, 404]);

    expect(result).toEqual({
      ok: false,
      error: new Error("PR #404 not found in the GitHub response"),
    });
  });

  it("refuses malformed JSON", () => {
    expect(parseStackResponse("{", [58]).ok).toBe(false);
  });
});

describe("fetchStack", () => {
  it("asks for every PR in one GraphQL call", () => {
    const { run, calls } = stubRunner([
      { status: 0, stdout: RESPONSE, stderr: "" },
    ]);

    const result = fetchStack(
      run,
      { owner: "idan91", name: "mergebrief" },
      [58, 59],
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("owner=idan91");
    expect(buildStackQuery([58, 59])).toContain(
      "pr59: pullRequest(number: 59)",
    );
  });

  it("surfaces the gh error text", () => {
    const { run } = stubRunner([{ status: 1, stdout: "", stderr: "HTTP 401" }]);

    const result = fetchStack(run, { owner: "o", name: "r" }, [1]);

    expect(result).toEqual({
      ok: false,
      error: new Error("gh api graphql failed: HTTP 401"),
    });
  });
});

describe("postReply", () => {
  it("replies on the thread root when given a reply's id", () => {
    const { run, calls } = stubRunner([
      {
        status: 0,
        stdout: JSON.stringify({ id: 9, in_reply_to_id: 5 }),
        stderr: "",
      },
      {
        status: 0,
        stdout: JSON.stringify({ id: 12, html_url: "https://x/12" }),
        stderr: "",
      },
    ]);

    const result = postReply(
      run,
      { owner: "o", name: "r" },
      58,
      9,
      "/tmp/body.md",
    );

    expect(result).toEqual({
      ok: true,
      value: { id: 12, url: "https://x/12" },
    });
    expect(calls[1]).toEqual([
      "api",
      "-X",
      "POST",
      "repos/o/r/pulls/58/comments/5/replies",
      "-F",
      "body=@/tmp/body.md",
    ]);
  });

  it("uses the id itself when it is the root", () => {
    const { run, calls } = stubRunner([
      {
        status: 0,
        stdout: JSON.stringify({ id: 5, in_reply_to_id: null }),
        stderr: "",
      },
      {
        status: 0,
        stdout: JSON.stringify({ id: 13, html_url: "https://x/13" }),
        stderr: "",
      },
    ]);

    postReply(run, { owner: "o", name: "r" }, 58, 5, "/tmp/body.md");

    expect(calls[1]?.[3]).toBe("repos/o/r/pulls/58/comments/5/replies");
  });

  it("stops when the comment cannot be read", () => {
    const { run, calls } = stubRunner([
      { status: 1, stdout: "", stderr: "HTTP 404" },
    ]);

    const result = postReply(
      run,
      { owner: "o", name: "r" },
      58,
      5,
      "/tmp/body.md",
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
