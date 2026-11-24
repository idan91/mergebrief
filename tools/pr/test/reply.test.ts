import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readReplyIds } from "../src/logic/replies";
import { runReply } from "../src/logic/reply";
import type { CommandOutcome } from "../src/types";

function git(): CommandOutcome {
  return {
    status: 0,
    stdout: "git@github.com:idan91/mergebrief.git\n",
    stderr: "",
  };
}

describe("runReply", () => {
  it("posts on the thread root and records the reply", () => {
    const store = join(
      mkdtempSync(join(tmpdir(), "pr-reply-")),
      "replies.json",
    );
    const outcomes: CommandOutcome[] = [
      {
        status: 0,
        stdout: JSON.stringify({ id: 7, in_reply_to_id: null }),
        stderr: "",
      },
      {
        status: 0,
        stdout: JSON.stringify({ id: 70, html_url: "https://x/70" }),
        stderr: "",
      },
    ];
    function gh(): CommandOutcome {
      return outcomes.shift() ?? { status: 1, stdout: "", stderr: "" };
    }

    const result = runReply(
      { git, gh, replyStorePath: store },
      58,
      7,
      "/tmp/body.md",
    );

    expect(result).toEqual({
      ok: true,
      value: "replied 70 on 7: https://x/70",
    });
    expect(readReplyIds(store)).toEqual({ ok: true, value: new Set([70]) });
  });

  it("records nothing when the post fails", () => {
    const store = join(
      mkdtempSync(join(tmpdir(), "pr-reply-")),
      "replies.json",
    );
    function gh(): CommandOutcome {
      return { status: 1, stdout: "", stderr: "HTTP 422" };
    }

    const result = runReply(
      { git, gh, replyStorePath: store },
      58,
      7,
      "/tmp/body.md",
    );

    expect(result.ok).toBe(false);
    expect(readReplyIds(store)).toEqual({ ok: true, value: new Set() });
  });
});
