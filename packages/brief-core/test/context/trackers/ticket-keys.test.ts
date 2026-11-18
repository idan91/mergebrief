import { describe, expect, it } from "vitest";
import { collectTicketKeys } from "../../../src/context/trackers/ticket-keys";

function readKeys(text: string, prefixes: readonly string[]): string[] {
  return collectTicketKeys(text, prefixes).map((hit) => hit.key);
}

describe("collectTicketKeys", () => {
  it("returns each key with its offset", () => {
    expect(collectTicketKeys("see ACME-12", ["ACME"])).toEqual([
      { index: 4, key: "ACME-12" },
    ]);
  });

  it.each([
    ["in a link's path", "see https://example.com/docs/ACME-12"],
    ["in a query string", "see https://example.com/?ticket=ACME-12"],
    ["in a Markdown link target", "[text](https://x/y/ACME-12)"],
    ["in a www link", "see www.example.com/ACME-12"],
  ])("a key %s does not count", (_where, text) => {
    expect(readKeys(text, ["ACME"])).toEqual([]);
  });

  it("a key beside a link still counts on both sides", () => {
    const text = "ACME-1 then https://x/ACME-2 then ACME-3";
    expect(readKeys(text, ["ACME"])).toEqual(["ACME-1", "ACME-3"]);
  });

  it("a key as a link's visible text still counts", () => {
    expect(readKeys("[ACME-12](https://x)", ["ACME"])).toEqual(["ACME-12"]);
  });

  it("matches several prefixes in one call, in text order", () => {
    const text = "OPS-3 pairs with ACME-12 and OPS-4";
    expect(readKeys(text, ["ACME", "OPS"])).toEqual([
      "OPS-3",
      "ACME-12",
      "OPS-4",
    ]);
  });

  it("matches any case and stores the prefix upper-case", () => {
    expect(readKeys("acme-12 and Acme-13", ["acme"])).toEqual([
      "ACME-12",
      "ACME-13",
    ]);
  });

  it("keeps the digits as written", () => {
    expect(readKeys("ACME-0012", ["ACME"])).toEqual(["ACME-0012"]);
  });

  it.each([
    ["after a word character", "XACME-12", []],
    ["before a word character", "ACME-12x", []],
    ["after a hyphen", "FOO-ACME-12", []],
    ["before a slug hyphen", "ACME-12-fix", ["ACME-12"]],
  ])("boundary %s", (_where, text, keys) => {
    expect(readKeys(text, ["ACME"])).toEqual(keys);
  });

  it("reads a prefix's pattern characters literally", () => {
    expect(readKeys("A.B-1 and AXB-2", ["A.B"])).toEqual(["A.B-1"]);
  });

  it("returns no hits for an empty prefix list", () => {
    expect(collectTicketKeys("ACME-12", [])).toEqual([]);
  });
});
