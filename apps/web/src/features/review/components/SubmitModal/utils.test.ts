import { describe, expect, it } from "vitest";

import { buildUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { UnresolvedItem } from "../../utils/state";
import type { SubmitGateInputs } from "./types";
import {
  deriveSubmitDescribedBy,
  deriveSubmitGate,
  groupUnresolvedItems,
  pickEntryView,
} from "./utils";

const COPY = {
  uploadPending: "upload pending",
  receiptUploadPending: "receipt upload pending",
  staleWarning: "stale",
  receiptStaleWarning: "receipt stale",
};
const UPLOADING = `see\n${buildUploadPlaceholder("shot.png")}`;

function makeGateInputs(
  overrides: Partial<SubmitGateInputs> = {},
): SubmitGateInputs {
  return {
    reviewComment: "",
    blockedReasonOverride: undefined,
    blockedReasonWith: undefined,
    staleUnacked: false,
    submitPending: false,
    submitError: null,
    submitNote: null,
    copy: COPY,
    ...overrides,
  };
}

describe("pickEntryView", () => {
  it("opens on the verdict unless items are unresolved", () => {
    const unresolved: UnresolvedItem[] = [
      {
        id: "remainder:u-7e7f21ef",
        kind: "unreviewed-remainder",
        label: "src/orphan.ts",
        targetId: "u-7e7f21ef",
      },
    ];

    expect(pickEntryView([])).toBe("verdict");
    expect(pickEntryView(unresolved)).toBe("advisory");
  });
});

describe("deriveSubmitDescribedBy", () => {
  it("ranks a blocked reason over a stale head over an error", () => {
    expect(deriveSubmitDescribedBy("x", true, "e")).toBe(
      "submit-modal-blocked",
    );
    expect(deriveSubmitDescribedBy(undefined, true, "e")).toBe(
      "submit-modal-stale-warning",
    );
    expect(deriveSubmitDescribedBy(undefined, false, "e")).toBe(
      "submit-modal-error",
    );
    expect(deriveSubmitDescribedBy(undefined, false, null)).toBeUndefined();
  });
});

describe("deriveSubmitGate", () => {
  it("lets Submit run with nothing in the way", () => {
    const gate = deriveSubmitGate(makeGateInputs());

    expect(gate.disabled).toBe(false);
    expect(gate.describedBy).toBeUndefined();
    expect(gate.verdictRefusal).toBeUndefined();
    expect(gate.receiptRefusal).toBeUndefined();
  });

  it("refuses an unacknowledged newer head in both views", () => {
    const gate = deriveSubmitGate(makeGateInputs({ staleUnacked: true }));

    expect(gate.disabled).toBe(true);
    expect(gate.describedBy).toBe("submit-modal-stale-warning");
    expect(gate.verdictRefusal).toBe("stale");
    expect(gate.receiptRefusal).toBe("receipt stale");
    expect(gate.receiptStaleWarning).toBe("receipt stale");
  });

  it("names Back on the receipt for a pending upload", () => {
    const gate = deriveSubmitGate(
      makeGateInputs({ reviewComment: UPLOADING, staleUnacked: true }),
    );

    expect(gate.describedBy).toBe("submit-modal-blocked");
    expect(gate.verdictStatus.blockedReason).toBe("upload pending");
    expect(gate.receiptStatus.blockedReason).toBe("receipt upload pending");
    expect(gate.verdictRefusal).toBe("upload pending");
    expect(gate.receiptRefusal).toBe("receipt upload pending");
  });

  it("keeps the screen's override first in both views", () => {
    const gate = deriveSubmitGate(
      makeGateInputs({
        reviewComment: UPLOADING,
        blockedReasonOverride: "read-only",
        blockedReasonWith: () => "needs content",
      }),
    );

    expect(gate.verdictRefusal).toBe("read-only");
    expect(gate.receiptRefusal).toBe("read-only");
  });

  it("asks the live content rule only when nothing outranks it", () => {
    const gate = deriveSubmitGate(
      makeGateInputs({ blockedReasonWith: () => "needs content" }),
    );

    expect(gate.verdictStatus.blockedReason).toBe("needs content");
    expect(gate.receiptStatus.blockedReason).toBe("needs content");
  });

  it("holds Submit while one is in flight without naming a reason", () => {
    const gate = deriveSubmitGate(makeGateInputs({ submitPending: true }));

    expect(gate.disabled).toBe(true);
    expect(gate.verdictRefusal).toBeUndefined();
  });
});

describe("groupUnresolvedItems", () => {
  function makeItem(id: string, kind: UnresolvedItem["kind"]): UnresolvedItem {
    return { id, kind, label: `src/${id}.ts`, targetId: id };
  }

  it("orders kinds by rank and keeps each kind's items in order", () => {
    const items = [
      makeItem("draft", "draft-comment"),
      makeItem("evidence", "missing-evidence"),
      makeItem("core-1", "unreviewed-core"),
      makeItem("risk-1", "open-risk"),
      makeItem("core-2", "unreviewed-core"),
      makeItem("risk-2", "open-risk"),
    ];

    const groups = groupUnresolvedItems(items).map((group) => [
      group.kind,
      group.items.map((item) => item.id),
    ]);

    expect(groups).toEqual([
      ["open-risk", ["risk-1", "risk-2"]],
      ["missing-evidence", ["evidence"]],
      ["unreviewed-core", ["core-1", "core-2"]],
      ["draft-comment", ["draft"]],
    ]);
  });

  it("returns no groups for no items", () => {
    expect(groupUnresolvedItems([])).toEqual([]);
  });
});
