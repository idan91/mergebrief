// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BreakablePath } from ".";

describe("BreakablePath", () => {
  afterEach(cleanup);

  it("offers a break after each slash and keeps the text whole", () => {
    const { container } = render(<BreakablePath path="src/app/app/file.ts" />);

    expect(container.textContent).toBe("src/app/app/file.ts");
    expect(container.querySelectorAll("wbr")).toHaveLength(4);
    expect(container.querySelector("wbr")?.previousSibling?.textContent).toBe(
      "src/",
    );
  });
});
