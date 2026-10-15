// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeReviewPosture } from "../utils/review-posture";
import { ReviewPostureProvider, useReviewPosture } from "./useReviewPosture";

interface PostureReaderProps {
  seen: (string | undefined)[];
}

function PostureReader({ seen }: PostureReaderProps) {
  seen.push(useReviewPosture().composerDisabledReason);
  return null;
}

describe("useReviewPosture", () => {
  it("shows a posture change to its readers in the same render", () => {
    const seen: (string | undefined)[] = [];
    const { rerender } = render(
      <ReviewPostureProvider posture={makeReviewPosture()}>
        <PostureReader seen={seen} />
      </ReviewPostureProvider>,
    );

    rerender(
      <ReviewPostureProvider
        posture={makeReviewPosture({ composerDisabledReason: "Read only." })}
      >
        <PostureReader seen={seen} />
      </ReviewPostureProvider>,
    );

    expect(seen).toEqual([undefined, "Read only."]);
  });

  it("refuses a reader rendered outside the provider", () => {
    expect(() => render(<PostureReader seen={[]} />)).toThrow(
      "ReviewPostureProvider is missing",
    );
  });
});
