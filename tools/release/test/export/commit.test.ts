import { describe, expect, it } from "vitest";
import {
  buildReleaseCommitInputs,
  formatReleaseMessage,
} from "../../src/logic/export/commit";

const IDENTITY = {
  name: "Idan Ram",
  email: "44946814+Idan91@users.noreply.github.com",
};

describe("the release message", () => {
  it("is the release line alone", () => {
    expect(formatReleaseMessage("0.1.0")).toBe("Release 0.1.0\n");
  });
});

describe("the release commit inputs", () => {
  it("builds a root commit from the source date and fixed identity", () => {
    const inputs = buildReleaseCommitInputs({
      treeSha: "aaaa",
      sourceCommitterDate: "2026-10-25T22:19:08Z",
      version: "0.1.0",
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
    });

    expect(inputs.parent).toBe("bbbb");
    expect(inputs.message).toBe("Release 0.2.0\n");
  });
});
