// The group-scoped comment selection must resolve everything the old
// whole-list subscription could: in particular, an addressed flag whose
// evidence links a comment anchored in ANOTHER group's chunk, dropping the
// linked-id half of the filter would render "evidence comment missing" for a
// disposition the reviewer legitimately recorded.
import { describe, expect, it } from "vitest";

import type { ReviewComment } from "@web/features/review/utils";
import type { RiskFlag } from "../../../../utils/viewModel";
import { selectGroupReviewComments } from "./utils";

function comment(id: string, chunkId: string): ReviewComment {
  return {
    id,
    anchor: {
      chunkId,
      file: "src/x.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
      rowIds: [],
      selectedText: "",
    },
    body: `${id} body`,
    status: "draft",
    collapsed: false,
  };
}

const FLAG: RiskFlag = {
  id: "flag-1",
  attr: "hot-path",
  chunkId: "c1",
  file: "src/x.ts",
  groupId: "g1",
  source: "built-in",
  deEmphasized: false,
};

describe("selectGroupReviewComments", () => {
  it("keeps comments anchored on the group's own chunks", () => {
    const result = selectGroupReviewComments(
      {
        dispositions: {},
        reviewComments: [comment("own", "c1"), comment("foreign", "c9")],
      },
      [],
      new Set(["c1"]),
    );
    expect(result.map((entry) => entry.id)).toEqual(["own"]);
  });

  it("keeps an evidence-linked comment anchored in another group", () => {
    const result = selectGroupReviewComments(
      {
        dispositions: {
          "flag-1": {
            kind: "addressed",
            evidence: { kind: "linked-comment", commentId: "foreign" },
          },
        },
        reviewComments: [comment("own", "c1"), comment("foreign", "c9")],
      },
      [FLAG],
      new Set(["c1"]),
    );
    expect(result.map((entry) => entry.id)).toEqual(["own", "foreign"]);
  });

  it("ignores evidence on flags outside the group", () => {
    const result = selectGroupReviewComments(
      {
        dispositions: {
          "other-group-flag": {
            kind: "addressed",
            evidence: { kind: "linked-comment", commentId: "foreign" },
          },
        },
        reviewComments: [comment("foreign", "c9")],
      },
      [FLAG],
      new Set(["c1"]),
    );
    expect(result).toEqual([]);
  });
});
