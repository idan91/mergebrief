// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useReviewPosture } from "./useReviewPosture";

interface PostureReaderProps {
  seen: (string | undefined)[];
}

function PostureReader({ seen }: PostureReaderProps) {
  seen.push(useReviewPosture().composerDisabledReason);
  return null;
}

describe("useReviewPosture", () => {
  it("refuses a reader rendered outside the provider", () => {
    expect(() => render(<PostureReader seen={[]} />)).toThrow(
      "ReviewPostureProvider is missing",
    );
  });
});
