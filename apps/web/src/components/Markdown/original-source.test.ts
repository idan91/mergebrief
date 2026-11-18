import { describe, expect, it } from "vitest";

import { dropOriginalSource } from "./original-source";

describe("dropOriginalSource", () => {
  it("keeps every attribute but the recorded original address", () => {
    const attributes = {
      title: "Weekly chart",
      align: "right",
      "data-original-source": "https://github.com/o/r/raw/main/a.png",
    };

    expect(dropOriginalSource(attributes)).toEqual({
      title: "Weekly chart",
      align: "right",
    });
    expect(attributes["data-original-source"]).toBeDefined();
  });
});
