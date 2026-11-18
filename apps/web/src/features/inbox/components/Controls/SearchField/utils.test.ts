import { describe, expect, it } from "vitest";

import type { SearchFieldState } from "./types";
import {
  reconcileUrlText,
  recordWrite,
  startSearchField,
  typeText,
} from "./utils";

function makeState(overrides: Partial<SearchFieldState>): SearchFieldState {
  return { ...startSearchField("", 0), ...overrides };
}

describe("reconcileUrlText", () => {
  it("hands back the same state while the URL has not moved", () => {
    const state = makeState({ text: "anchor" });

    expect(reconcileUrlText(state, "", 0)).toBe(state);
  });

  it("keeps the typing when the URL lands on the field's text, trimmed", () => {
    const state = makeState({
      text: " anchor ",
      ownWrites: ["anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anchor", 0)).toEqual({
      text: " anchor ",
      seenUrlText: "anchor",
      ownWrites: [],
      awaitsLanding: false,
      seenClearCount: 0,
    });
  });

  it("an earlier write landing still awaits the later one", () => {
    const state = makeState({
      text: "anchor",
      ownWrites: ["", "anc", "anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anc", 0)).toEqual({
      text: "anchor",
      seenUrlText: "anc",
      ownWrites: ["anchor"],
      awaitsLanding: true,
      seenClearCount: 0,
    });
  });

  it("takes the URL's text when the field never wrote it", () => {
    const state = makeState({
      text: "anchor",
      seenUrlText: "anchor",
      ownWrites: [],
    });

    expect(reconcileUrlText(state, "", 0)).toEqual(startSearchField("", 0));
  });
});

describe("reconcileUrlText after a Clear", () => {
  it("empties the field while its first search is still loading", () => {
    const state = makeState({
      text: "foo",
      ownWrites: ["foo"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "", 1)).toEqual(startSearchField("", 1));
  });

  it("awaits the cleared URL when the one on screen holds text", () => {
    const state = makeState({ text: "foo", seenUrlText: "foo" });

    expect(reconcileUrlText(state, "foo", 1)).toEqual({
      text: "",
      seenUrlText: "foo",
      ownWrites: [""],
      awaitsLanding: true,
      seenClearCount: 1,
    });
  });
});

describe("typeText", () => {
  it("moves the text on and stops awaiting the list for older text", () => {
    const state = makeState({
      text: "fo",
      ownWrites: ["fo"],
      awaitsLanding: true,
    });

    expect(typeText(state, "foo")).toEqual({
      text: "foo",
      seenUrlText: "",
      ownWrites: ["fo"],
      awaitsLanding: false,
      seenClearCount: 0,
    });
  });
});

describe("recordWrite", () => {
  it("remembers the write and awaits its list", () => {
    const state = makeState({ text: "fo" });

    expect(recordWrite(state, "fo")).toEqual({
      text: "fo",
      seenUrlText: "",
      ownWrites: ["fo"],
      awaitsLanding: true,
      seenClearCount: 0,
    });
  });

  it("forgets dropped writes when the text is back to the URL's", () => {
    const state = makeState({
      text: "foo",
      seenUrlText: "foo",
      ownWrites: [""],
    });

    expect(recordWrite(state, "foo").ownWrites).toEqual([]);
  });

  it("records nothing for a text the URL already shows", () => {
    const state = makeState({ text: "anchor ", seenUrlText: "anchor" });

    expect(recordWrite(state, "anchor")).toBe(state);
  });

  it("keeps the newest four writes", () => {
    const state = makeState({ ownWrites: ["a", "ab", "abc", "abcd"] });

    expect(recordWrite(state, "abcde").ownWrites).toEqual([
      "ab",
      "abc",
      "abcd",
      "abcde",
    ]);
  });
});
