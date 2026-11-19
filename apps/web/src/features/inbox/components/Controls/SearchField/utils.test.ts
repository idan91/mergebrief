import { describe, expect, it } from "vitest";

import type { SearchTextOverride } from "../../../types";
import type { SearchFieldState } from "./types";
import {
  reconcileUrlText,
  recordWrite,
  startSearchField,
  typeText,
} from "./utils";

const NONE: SearchTextOverride = { count: 0, text: "" };
const CLEARED: SearchTextOverride = { count: 1, text: "" };

function makeState(overrides: Partial<SearchFieldState>): SearchFieldState {
  return { ...startSearchField("", NONE), ...overrides };
}

describe("reconcileUrlText", () => {
  it("hands back the same state while the URL has not moved", () => {
    const state = makeState({ text: "anchor" });

    expect(reconcileUrlText(state, "", NONE)).toBe(state);
  });

  it("keeps the typing when the URL lands on the field's text, trimmed", () => {
    const state = makeState({
      text: " anchor ",
      ownWrites: ["anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anchor", NONE)).toEqual({
      text: " anchor ",
      seenUrlText: "anchor",
      ownWrites: [],
      awaitsLanding: false,
      seenOverrideCount: 0,
    });
  });

  it("an earlier write landing still awaits the later one", () => {
    const state = makeState({
      text: "anchor",
      ownWrites: ["", "anc", "anchor"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "anc", NONE)).toEqual({
      text: "anchor",
      seenUrlText: "anc",
      ownWrites: ["anchor"],
      awaitsLanding: true,
      seenOverrideCount: 0,
    });
  });

  it("takes the URL's text when the field never wrote it", () => {
    const state = makeState({
      text: "anchor",
      seenUrlText: "anchor",
      ownWrites: [],
    });

    expect(reconcileUrlText(state, "", NONE)).toEqual(
      startSearchField("", NONE),
    );
  });
});

describe("reconcileUrlText after a Clear", () => {
  it("empties the field while its first search is still loading", () => {
    const state = makeState({
      text: "foo",
      ownWrites: ["foo"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(state, "", CLEARED)).toEqual(
      startSearchField("", CLEARED),
    );
  });

  it("remembers the empty text as its own without awaiting it", () => {
    const state = makeState({ text: "foo", seenUrlText: "foo" });

    const cleared = reconcileUrlText(state, "foo", CLEARED);

    expect(cleared).toEqual({
      text: "",
      seenUrlText: "foo",
      ownWrites: [""],
      awaitsLanding: false,
      seenOverrideCount: 1,
    });
    expect(reconcileUrlText(typeText(cleared, "x"), "", CLEARED).text).toBe(
      "x",
    );
  });
});

describe("reconcileUrlText after a Back or a link", () => {
  const BACK_TO_LEDG: SearchTextOverride = { count: 1, text: "ledg" };

  it("takes the target's text though the field once wrote that text", () => {
    const ahead = makeState({
      text: "ledger",
      ownWrites: ["ledg", "ledger"],
      awaitsLanding: true,
    });

    const yielded = reconcileUrlText(ahead, "", BACK_TO_LEDG);

    expect(yielded).toEqual({
      text: "ledg",
      seenUrlText: "",
      ownWrites: ["ledg"],
      awaitsLanding: false,
      seenOverrideCount: 1,
    });
    expect(reconcileUrlText(yielded, "ledg", BACK_TO_LEDG)).toEqual({
      text: "ledg",
      seenUrlText: "ledg",
      ownWrites: [],
      awaitsLanding: false,
      seenOverrideCount: 1,
    });
  });

  it("drops every pending write when the target holds the URL's own text", () => {
    const ahead = makeState({
      text: "ledger",
      ownWrites: ["ledg", "ledger"],
      awaitsLanding: true,
    });

    expect(reconcileUrlText(ahead, "", CLEARED)).toEqual(
      startSearchField("", CLEARED),
    );
  });

  it("keeps what is typed while the target is still loading", () => {
    const yielded = reconcileUrlText(makeState({}), "", BACK_TO_LEDG);

    const typedOn = typeText(yielded, "ledgx");

    expect(reconcileUrlText(typedOn, "ledg", BACK_TO_LEDG).text).toBe("ledgx");
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
      seenOverrideCount: 0,
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
      seenOverrideCount: 0,
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
