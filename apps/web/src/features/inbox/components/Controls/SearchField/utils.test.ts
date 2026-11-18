import { describe, expect, it } from "vitest";

import type { SearchFieldState } from "./types";
import {
  reconcileUrlText,
  recordWrite,
  startSearchField,
  typeText,
} from "./utils";

function makeState(overrides: Partial<SearchFieldState>): SearchFieldState {
  return { ...startSearchField(""), ...overrides };
}

describe("reconcileUrlText", () => {
  it("hands back the same state while the URL has not moved", () => {
    const state = makeState({ text: "anchor" });

    expect(reconcileUrlText(state, "")).toBe(state);
  });

  it("keeps the typing when the URL lands on the field's text, trimmed", () => {
    const state = makeState({
      text: " anchor ",
      ownWrites: ["anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anchor")).toEqual({
      text: " anchor ",
      seenUrlText: "anchor",
      ownWrites: [],
      awaitsLanding: false,
    });
  });

  it("an earlier write landing still awaits the later one", () => {
    const state = makeState({
      text: "anchor",
      ownWrites: ["", "anc", "anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anc")).toEqual({
      text: "anchor",
      seenUrlText: "anc",
      ownWrites: ["anchor"],
      awaitsLanding: true,
    });
  });

  it("takes the URL's text when the field never wrote it", () => {
    const state = makeState({
      text: "anchor",
      seenUrlText: "anchor",
      ownWrites: [],
    });

    expect(reconcileUrlText(state, "")).toEqual(startSearchField(""));
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
    });
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
