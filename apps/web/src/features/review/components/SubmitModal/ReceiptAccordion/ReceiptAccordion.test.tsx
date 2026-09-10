// @vitest-environment jsdom
// The accordion receipt view: outcome pinned, folds carry their counts in
// the summaries, coverage open by default, raw artifact behind a disclosure.
// Importing I18nProvider registers appI18n as the react-i18next default.
// The bare-rendered subtree below resolves it without a provider.
// oxlint-disable-next-line import/no-unassigned-import -- registration is the point.
import "../../../../../i18n/I18nProvider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Receipt } from "../../../utils/receipt";
import { ReceiptAccordion } from "./ReceiptAccordion";
import { CommentAnchorKinds } from "types";
import {
  CommentSides,
  ReviewCommentStatuses,
} from "@web/features/review/utils";

const RAW =
  "Reviewed by @you (human) · octo/hello #7 @ aaaaaaa\n  not checked: business intent";

function receipt(): Receipt {
  return {
    subject: { repo: "octo/hello", number: 7, sha: "a".repeat(40) },
    progress: { reviewedChunks: 3, chunkTotal: 4, flagTotal: 3 },
    counts: { addressed: 1, dismissed: 1, open: 1 },
    addressed: [
      {
        id: "flag:a",
        attr: "auth",
        file: "src/auth/token.ts",
        evidenceLabel: "linked comment token.ts:+12",
      },
    ],
    dismissed: [
      {
        id: "flag:b",
        attr: "perf",
        file: "src/list.ts",
        reason: "measured — bounded at 50 rows",
      },
    ],
    open: [{ id: "flag:c", attr: "migration", file: "src/db/schema.ts" }],
    comments: [
      {
        id: "comment:1",
        kind: CommentAnchorKinds.LINE,
        file: "src/a.ts",
        side: CommentSides.NEW,
        startLine: 3,
        endLine: 5,
        firstLine: "Race on refresh.",
        status: ReviewCommentStatuses.DRAFT,
      },
      {
        id: "comment:2",
        kind: CommentAnchorKinds.LINE,
        file: "src/b.ts",
        side: CommentSides.OLD,
        startLine: 9,
        endLine: 9,
        firstLine: "Dead branch.",
        status: ReviewCommentStatuses.SUBMITTED,
      },
    ],
    reclassifiedCount: 0,
  };
}

function renderAccordion(overrides: Partial<Receipt> = {}) {
  return render(
    <ReceiptAccordion
      outcome="comment"
      raw={RAW}
      receipt={{ ...receipt(), ...overrides }}
    />,
  );
}

function findFold(summaryText: RegExp): HTMLDetailsElement | null {
  const summary = screen.getByText(summaryText);
  return summary.closest("details");
}

describe("ReceiptAccordion", () => {
  afterEach(cleanup);

  it("pins the outcome card with the signature line", () => {
    renderAccordion();
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(screen.getByText("Comment")).toBeTruthy();
    expect(screen.getByText(/3 chunks read, 1 risks addressed/i)).toBeTruthy();
  });

  it("opens coverage by default and keeps every other fold collapsed", () => {
    renderAccordion();
    expect(findFold(/what the reviewer covered/i)?.open).toBe(true);
    expect(findFold(/inline comments \(2\)/i)?.open).toBe(false);
    expect(findFold(/risk disposition/i)?.open).toBe(false);
    expect(findFold(/^not checked$/i)?.open).toBe(false);
    expect(findFold(/show raw receipt/i)?.open).toBe(false);
  });

  it("renders coverage metrics from the receipt", () => {
    renderAccordion();
    expect(screen.getByText("Chunks reviewed")).toBeTruthy();
    expect(screen.getByText("3/4")).toBeTruthy();
    expect(screen.getByText("Risk flags")).toBeTruthy();
  });

  it("puts the counts in the fold summaries", () => {
    renderAccordion();
    expect(screen.getByText("Inline comments (2)")).toBeTruthy();
    expect(
      screen.getByText(
        /risk disposition — 1 addressed · 1 dismissed · 1 open/i,
      ),
    ).toBeTruthy();
  });

  it("lists comments with anchors and tags already-posted ones", () => {
    renderAccordion();
    expect(screen.getByText("src/a.ts:+3-5")).toBeTruthy();
    expect(screen.getByText(/src\/b\.ts:-9 · posted/)).toBeTruthy();
    expect(screen.getByText("Race on refresh.")).toBeTruthy();
  });

  it("shows the empty-comments copy when nothing is drafted", () => {
    renderAccordion({ comments: [] });
    expect(screen.getByText(/no draft comments in this preview/i)).toBeTruthy();
    expect(screen.getByText("Inline comments (0)")).toBeTruthy();
  });

  it("groups the risk disposition with per-flag detail", () => {
    renderAccordion();
    expect(screen.getByText("Addressed risks")).toBeTruthy();
    expect(screen.getByText(/auth · token\.ts/)).toBeTruthy();
    expect(screen.getByText("linked comment token.ts:+12")).toBeTruthy();
    expect(screen.getByText(/measured — bounded at 50 rows/)).toBeTruthy();
    expect(screen.getByText(/not addressed, not dismissed/)).toBeTruthy();
  });

  it("keeps the frozen artifact verbatim inside the raw disclosure", () => {
    renderAccordion();
    const fold = findFold(/show raw receipt \(as posted to github\)/i);
    expect(fold?.querySelector("pre")?.textContent).toBe(RAW);
  });
});
