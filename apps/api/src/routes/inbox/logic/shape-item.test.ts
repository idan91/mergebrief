import { describe, expect, it } from "vitest";
import { shapeStack } from "./shape-item";

describe("shapeStack", () => {
  it("reduces a linear chain to its position and size", () => {
    const stack = {
      members: [
        { number: 1, title: "one" },
        { number: 2, title: "two" },
        { number: 3, title: "three" },
      ],
      index: 2,
    };

    expect(shapeStack(stack)).toEqual({ index: 2, size: 3 });
  });

  it("gives a fork no position", () => {
    const fork = {
      parent: { number: 1, title: "one" },
      children: [
        { number: 2, title: "two" },
        { number: 3, title: "three" },
      ],
    };

    expect(shapeStack(fork)).toBeNull();
  });

  it("gives an unparseable snapshot no position", () => {
    expect(shapeStack(null)).toBeNull();
    expect(shapeStack({ members: [], index: 1 })).toBeNull();
  });
});
