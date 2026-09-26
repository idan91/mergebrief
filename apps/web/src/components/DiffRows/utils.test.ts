// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { DiffLine } from "@web/utils/diffTokens/types";
import { findRowByLine, hasPairedSides } from "./utils";

const ctx: DiffLine = { kind: "ctx", content: "a", oldLine: 1, newLine: 1 };
const add: DiffLine = { kind: "add", content: "b", newLine: 2 };
const del: DiffLine = { kind: "del", content: "c", oldLine: 2 };

describe("hasPairedSides", () => {
  it("pairs only a diff with both additions and deletions", () => {
    expect(hasPairedSides([ctx, del, add])).toBe(true);
    expect(hasPairedSides([ctx, add])).toBe(false);
    expect(hasPairedSides([ctx, del])).toBe(false);
    expect(hasPairedSides([ctx])).toBe(false);
  });
});

describe("findRowByLine", () => {
  function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }

  it("finds the unified row whose number cell on the side matches", () => {
    const root = mount(
      '<table><tbody><tr id="a"><td data-line-old="13">13</td><td data-line-new="10">10</td></tr>' +
        '<tr id="b"><td data-line-old="14">14</td><td></td></tr></tbody></table>',
    );

    expect(findRowByLine(root, "new", 10)?.id).toBe("a");
    expect(findRowByLine(root, "old", 14)?.id).toBe("b");
    expect(findRowByLine(root, "new", 14)).toBeNull();
  });

  it("skips a nested table, a suggestion preview inside a comment", () => {
    const root = mount(
      '<table><tbody><tr id="a"><td data-line-old="8">8</td><td data-line-new="9">9</td></tr>' +
        '<tr><td><table><tbody><tr id="preview"><td></td><td data-line-new="11">11</td></tr></tbody></table></td></tr>' +
        '<tr id="b"><td data-line-old="10">10</td><td data-line-new="11">11</td></tr></tbody></table>',
    );

    expect(findRowByLine(root, "new", 11)?.id).toBe("b");
  });

  it("finds the split cell on the side, the pair's row is not the target", () => {
    const root = mount(
      '<table><tbody><tr><td data-side="left" data-line-old="14">14</td><td id="l" data-side="left" tabindex="-1"></td>' +
        '<td data-side="right" data-line-new="11">11</td><td id="r" data-side="right" tabindex="0"></td></tr></tbody></table>',
    );

    expect(findRowByLine(root, "new", 11)?.id).toBe("r");
    expect(findRowByLine(root, "old", 14)?.id).toBe("l");
  });
});
