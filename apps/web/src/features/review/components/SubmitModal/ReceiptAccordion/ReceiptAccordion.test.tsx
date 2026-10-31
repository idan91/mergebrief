// @vitest-environment jsdom
// The accordion receipt view: outcome pinned, folds carry their counts in
// the summaries, coverage open by default, raw artifact behind a disclosure.
// Importing I18nProvider registers appI18n as the react-i18next default.
// The bare-rendered subtree below resolves it without a provider.
// oxlint-disable-next-line import/no-unassigned-import -- registration is the point.
import "../../../../../i18n/I18nProvider";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Receipt, ReceiptLine } from "../../../utils/receipt";
import { ReceiptAccordion } from ".";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";

const RAW_LINES: ReceiptLine[] = [
  "Reviewed by @you (human) · octo/hello #7 @ aaaaaaa",
  "      read as counts only:",
  { file: "dist/install.js" },
  { file: "vendor/.bin/install.js" },
  "  not checked: business intent",
];

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
        evidenceLabel: "Linked comment token.ts:+12",
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
        side: DiffSides.NEW,
        startLine: 3,
        endLine: 5,
        firstLine: "Race on refresh.",
        status: DraftCommentStatuses.DRAFT,
      },
      {
        id: "comment:2",
        kind: CommentAnchorKinds.LINE,
        file: "src/b.ts",
        side: DiffSides.OLD,
        startLine: 9,
        endLine: 9,
        firstLine: "Dead branch.",
        status: DraftCommentStatuses.SUBMITTED,
      },
    ],
    reclassifiedCount: 0,
  };
}

const SIGNATURE_LINE =
  "Reviewed with MergeBrief: 3/4 chunks read · 1 risks addressed · 0 dismissed · 1 open · 2 inline comments";

function renderAccordion(overrides: Partial<Receipt> = {}) {
  return render(
    <ReceiptAccordion
      outcome="comment"
      rawLines={RAW_LINES}
      receipt={{ ...receipt(), ...overrides }}
      signatureLine={SIGNATURE_LINE}
    />,
  );
}

function findFold(summaryText: RegExp): HTMLDetailsElement | null {
  const summary = screen.getByText(summaryText);
  return summary.closest("details");
}

describe("ReceiptAccordion", () => {
  it("pins the outcome card with the signature line", () => {
    renderAccordion();
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(screen.getByText("Comment")).toBeTruthy();
    expect(screen.getByText(SIGNATURE_LINE)).toBeTruthy();
  });

  it("opens coverage by default and keeps every other fold collapsed", () => {
    renderAccordion();
    expect(findFold(/what the reviewer covered/i)?.open).toBe(true);
    expect(findFold(/inline comments \(2\)/i)?.open).toBe(false);
    expect(findFold(/risk disposition/i)?.open).toBe(false);
    expect(findFold(/^not checked$/i)?.open).toBe(false);
    expect(findFold(/show raw receipt/i)?.open).toBe(false);
  });

  it("shows the outline the grouping read and the files read shortened", () => {
    renderAccordion({
      generation: {
        outlineForm: "headers",
        shortened: [
          { file: "pnpm-lock.yaml", readAs: "package-summary" },
          { file: "dist/app.js", readAs: "counts-only" },
          { file: "vendor/x.js", readAs: "counts-only" },
        ],
      },
    });

    const outline = screen.getByTestId("receipt-outline-form").textContent;
    expect(outline).toContain("hunk headers only");
    expect(outline).toContain("The grouping saw no code lines");
    expect(screen.getByTestId("receipt-shortened-files").textContent).toBe(
      "1 file as package changes · 2 files as counts only",
    );
  });

  it("names paths and counts, never headers, for the per-file outline", () => {
    renderAccordion({ generation: { outlineForm: "files", shortened: [] } });

    const outline = screen.getByTestId("receipt-outline-form").textContent;
    expect(outline).toContain("one line per file");
    expect(outline).toContain(
      "The grouping saw no code lines or hunk headers; groups were formed from paths and counts.",
    );
  });

  it("names only the read-as kinds that have a file", () => {
    renderAccordion({
      generation: {
        outlineForm: "full",
        shortened: [{ file: "pnpm-lock.yaml", readAs: "package-summary" }],
      },
    });

    expect(screen.getByTestId("receipt-shortened-files").textContent).toBe(
      "1 file as package changes",
    );
  });

  it("shows no shortened-files row when a multi-call run shortened nothing", () => {
    renderAccordion({
      generation: { outlineForm: "full", shortened: [] },
    });

    expect(screen.getByTestId("receipt-outline-form")).not.toBeNull();
    expect(screen.queryByTestId("receipt-shortened-files")).toBeNull();
  });

  it("shows no generation rows on a single-call receipt", () => {
    renderAccordion();

    expect(screen.queryByTestId("receipt-outline-form")).toBeNull();
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
      screen.getByText(/risk disposition: 1 addressed · 1 dismissed · 1 open/i),
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
    expect(screen.getByText(/Auth · token\.ts/)).toBeTruthy();
    expect(screen.getByText("Linked comment token.ts:+12")).toBeTruthy();
    expect(screen.getByText(/measured — bounded at 50 rows/)).toBeTruthy();
    expect(screen.getByText(/Not addressed, not dismissed/)).toBeTruthy();
  });

  it("marks mentions in dismiss reasons and comment lines the reviewer wrote", () => {
    const dismissed = [
      { id: "flag:b", attr: "perf", file: "src/list.ts", reason: "ask @cara" },
    ];
    const comments = receipt().comments.map((comment) => ({
      ...comment,
      firstLine: `${comment.firstLine} @dan`,
    }));
    renderAccordion({ dismissed, comments });

    const marked = screen
      .getAllByTestId("mention")
      .map((node) => node.textContent);
    expect(marked).toEqual(["@dan", "@dan", "@cara"]);
  });

  it("keeps the frozen artifact verbatim inside the raw disclosure", () => {
    renderAccordion();
    const fold = findFold(/^show raw receipt$/i);
    expect(fold?.querySelector("pre")?.textContent).toBe(
      [
        "Reviewed by @you (human) · octo/hello #7 @ aaaaaaa",
        "      read as counts only:",
        "        dist/install.js",
        "        vendor/.bin/install.js",
        "  not checked: business intent",
      ].join("\n"),
    );
  });

  it("copies a selection inside the raw receipt as its plain text", () => {
    renderAccordion();
    const pre = findFold(/^show raw receipt$/i)?.querySelector("pre");
    if (!pre) {
      throw new Error("raw receipt missing");
    }
    window.getSelection()?.selectAllChildren(pre);
    const setData = vi.fn();

    const proceeded = fireEvent.copy(pre, { clipboardData: { setData } });

    expect(proceeded).toBe(false);
    expect(setData).toHaveBeenCalledWith("text/plain", pre.textContent);
  });

  it("leaves a copy that reaches past the raw receipt to the browser", () => {
    renderAccordion();
    const pre = findFold(/^show raw receipt$/i)?.querySelector("pre");
    if (!pre) {
      throw new Error("raw receipt missing");
    }
    window.getSelection()?.selectAllChildren(document.body);
    const setData = vi.fn();

    const proceeded = fireEvent.copy(pre, { clipboardData: { setData } });

    expect(proceeded).toBe(true);
    expect(setData).not.toHaveBeenCalled();
  });

  it("isolates each named file's full path as left-to-right text", () => {
    renderAccordion();
    const fold = findFold(/^show raw receipt$/i);
    const paths = [...(fold?.querySelectorAll("bdi") ?? [])].map((node) => [
      node.dir,
      node.textContent,
    ]);
    expect(paths).toEqual([
      ["ltr", "dist/install.js"],
      ["ltr", "vendor/.bin/install.js"],
    ]);
  });
});
