import { describe, expect, it } from "vitest";

import { findMentions } from "./mentions";

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
