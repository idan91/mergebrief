import { describe, expect, it } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import { findMentions, findSourceMentions, splitMentionText } from "./mentions";

function listTargets(text: string): string[] {
  const targets = findMentions(text).map((match) => match.target);
  return targets;
}

describe("findMentions", () => {
  it.each([
    ["@a", ["a"]],
    ["hi @cara, thanks", ["cara"]],
    ["@cara.", ["cara"]],
    ["(@cara)", ["cara"]],
    ["@acme/backend please", ["acme/backend"]],
    ["@acme/web.app here", ["acme/web.app"]],
    ["@acme/backend.", ["acme/backend"]],
    ["@mona_octocorp", ["mona_octocorp"]],
    [`@${"a".repeat(39)}`, ["a".repeat(39)]],
    ["@one and @two", ["one", "two"]],
    ["cc @alice/@bob", ["bob"]],
    ["@cara.\nnext", ["cara"]],
  ])("finds %j", (text, targets) => {
    expect(listTargets(text)).toEqual(targets);
  });

  it.each([
    "a@b.com",
    "@-cara",
    "@cara-",
    "@ cara",
    "x@cara",
    "@",
    `@${"a".repeat(40)}`,
    "@alice/",
    "@acme/-ops",
    "@acme/.git",
    "@cara.github.io",
  ])("finds nothing in %j", (text) => {
    expect(findMentions(text)).toEqual([]);
  });

  it("tells a team from a user and keeps each span's offsets", () => {
    const text = "cc @cara and @acme/backend";

    expect(findMentions(text)).toEqual([
      { start: 3, end: 8, target: "cara", kind: "user" },
      { start: 13, end: 26, target: "acme/backend", kind: "team" },
    ]);
  });
});

describe("splitMentionText", () => {
  it("cuts text into its plain runs and its mentions, in order", () => {
    expect(splitMentionText("cc @cara, @acme/core!")).toEqual([
      { text: "cc " },
      {
        text: "@cara",
        mention: {
          start: 3,
          end: 8,
          target: "cara",
          kind: MentionCandidateKinds.USER,
        },
      },
      { text: ", " },
      {
        text: "@acme/core",
        mention: {
          start: 10,
          end: 20,
          target: "acme/core",
          kind: MentionCandidateKinds.TEAM,
        },
      },
      { text: "!" },
    ]);
  });

  it("returns the text whole when it holds no mention", () => {
    expect(splitMentionText("a@b.com")).toEqual([{ text: "a@b.com" }]);
  });
});

describe("findSourceMentions", () => {
  it.each([
    "drop the `@Override` here",
    "```\n@Test\n```",
    "see [@cara](https://example.test)",
    "![@cara](https://example.test/a.png)",
    "<https://medium.com/@cara>",
    "https://medium.com/@cara",
    "www.example.test/@cara",
  ])("leaves %j as typed", (text) => {
    expect(findSourceMentions(text)).toEqual([]);
  });

  it("keeps the mentions outside code, links and URLs", () => {
    const text = "`@x` then @cara, https://x.test/@y and @acme/core";

    expect(findSourceMentions(text).map((match) => match.target)).toEqual([
      "cara",
      "acme/core",
    ]);
  });
});
