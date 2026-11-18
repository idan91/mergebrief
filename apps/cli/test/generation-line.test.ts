// The `generation` command's TTY line, one case per segment it can print.
import { describe, expect, it } from "vitest";
import { formatClaimsLine } from "../src/commands/read/generation";

const HEAD = "abc1234def5678";

describe("formatClaimsLine", () => {
  it.each([
    {
      name: "a pending head",
      generation: {
        headSha: HEAD,
        status: "pending",
        claims: 0,
        claimLimit: 3,
        exhausted: false,
      },
      line: "PR 7 · head abc1234 · pending · claims 0 of 3\n",
    },
    {
      name: "an exhausted head with its earlier failure",
      generation: {
        headSha: HEAD,
        status: "failed",
        claims: 3,
        claimLimit: 3,
        exhausted: true,
        errorCode: "provider-timeout",
      },
      line: "PR 7 · head abc1234 · failed · claims 3 of 3 · exhausted · last failure provider-timeout\n",
    },
    {
      name: "a scheduled takeover with its start",
      generation: {
        headSha: HEAD,
        status: "running",
        claims: 1,
        claimLimit: 3,
        exhausted: false,
        takeover: { state: "scheduled", runsAt: "2026-10-19T14:02:00.000Z" },
      },
      line: "PR 7 · head abc1234 · running · claims 1 of 3 · takeover scheduled at 2026-10-19T14:02:00.000Z\n",
    },
    {
      name: "a spent takeover",
      generation: {
        headSha: HEAD,
        status: "failed",
        claims: 3,
        claimLimit: 3,
        exhausted: true,
        takeover: { state: "spent" },
      },
      line: "PR 7 · head abc1234 · failed · claims 3 of 3 · exhausted · takeover spent\n",
    },
  ])("prints $name", ({ generation, line }) => {
    expect(formatClaimsLine(7, { generation })).toBe(line);
  });

  it("says no brief is queued when the body carries no generation", () => {
    expect(formatClaimsLine(7, {})).toBe("PR 7 · no brief queued yet\n");
  });
});
