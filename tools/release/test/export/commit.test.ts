import { describe, expect, it } from "vitest";
import {
  buildReleaseCommitInputs,
  collectCoAuthorTrailers,
  formatReleaseMessage,
} from "../../src/logic/export/commit";

const IDENTITY = {
  name: "Idan Ram",
  email: "44946814+Idan91@users.noreply.github.com",
};

describe("collecting co-author trailers", () => {
  it("dedupes by address, keeping the first spelling, sorted by address", () => {
    const trailers = collectCoAuthorTrailers([
      "Zed Example <Zed@example.org>",
      "Ann Example <ann@example.org>",
      "zed example <zed@example.org>",
      "Ann Example <ann@example.org>",
    ]);

    expect(trailers).toEqual([
      "Ann Example <ann@example.org>",
      "Zed Example <Zed@example.org>",
    ]);
  });

  it("orders addresses by code unit, not by the host's collation", () => {
    const sorted = collectCoAuthorTrailers([
      "Ann Lee <ann_lee@y.org>",
      "Ann <ann@x.org>",
      "Ann One <ann1@y.org>",
    ]);

    expect(sorted).toEqual([
      "Ann One <ann1@y.org>",
      "Ann <ann@x.org>",
      "Ann Lee <ann_lee@y.org>",
    ]);
  });

  it("drops the maintainer's own address and agent addresses", () => {
    const trailers = collectCoAuthorTrailers([
      "Idan Ram <44946814+Idan91@users.noreply.github.com>",
      "Claude Fable 5.1 <noreply@anthropic.com>",
      "Cursor <CursorAgent@cursor.com>",
      "Ann Example <ann@example.org>",
      "",
      "not a trailer",
    ]);

    expect(trailers).toEqual(["Ann Example <ann@example.org>"]);
  });
});

describe("the release message", () => {
  it("is the release line alone when no one else is credited", () => {
    expect(formatReleaseMessage("0.1.0", [])).toBe("Release 0.1.0\n");
  });

  it("carries one Co-authored-by line per credited contributor", () => {
    const message = formatReleaseMessage("0.1.0", [
      "Ann Example <ann@example.org>",
      "Zed Example <zed@example.org>",
    ]);

    expect(message).toBe(
      "Release 0.1.0\n\nCo-authored-by: Ann Example <ann@example.org>\nCo-authored-by: Zed Example <zed@example.org>\n",
    );
  });
});

describe("the release commit inputs", () => {
  it("builds a root commit from the source date and fixed identity", () => {
    const inputs = buildReleaseCommitInputs({
      treeSha: "aaaa",
      sourceCommitterDate: "2026-10-25T22:19:08Z",
      version: "0.1.0",
      trailers: [],
    });

    expect(inputs).toEqual({
      treeSha: "aaaa",
      author: IDENTITY,
      committer: IDENTITY,
      date: "2026-10-25T22:19:08Z",
      message: "Release 0.1.0\n",
    });
  });

  it("names the previous release commit as the parent when one exists", () => {
    const inputs = buildReleaseCommitInputs({
      treeSha: "aaaa",
      parent: "bbbb",
      sourceCommitterDate: "2026-10-25T22:19:08Z",
      version: "0.2.0",
      trailers: ["Ann Example <ann@example.org>"],
    });

    expect(inputs.parent).toBe("bbbb");
    expect(inputs.message).toBe(
      "Release 0.2.0\n\nCo-authored-by: Ann Example <ann@example.org>\n",
    );
  });
});
