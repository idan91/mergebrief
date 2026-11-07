// @vitest-environment jsdom
// The receipt view: the outcome chip and the counts as tiles, then one section
// at a time in tabs, the raw artifact in the last.
// Importing I18nProvider registers appI18n as the react-i18next default.
// The bare-rendered subtree below resolves it without a provider.
// oxlint-disable-next-line import/no-unassigned-import -- registration is the point.
import "../../../../../i18n/I18nProvider";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LANDSCAPE_HEIGHT_PX } from "@web/hooks/useMobileViewport";
import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
  SHORT_SCREEN_MEDIA,
} from "@web/test/compiled-css";
import type { Receipt, ReceiptLine } from "../../../utils/receipt";
import { ReceiptBody } from ".";
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

function renderBody(overrides: Partial<Receipt> = {}) {
  return render(
    <ReceiptBody
      outcome="comment"
      rawLines={RAW_LINES}
      receipt={{ ...receipt(), ...overrides }}
      signatureLine={SIGNATURE_LINE}
    />,
  );
}

function findPanel(tabName: RegExp): HTMLElement {
  const tab = screen.getByRole("tab", { name: tabName });
  const panel = document.getElementById(
    tab.getAttribute("aria-controls") ?? "",
  );
  if (panel === null) {
    throw new Error("tab controls no panel");
  }
  return panel;
}

describe("ReceiptBody", () => {
  it("shows the outcome and gives the signature line its own tab", () => {
    renderBody();
    expect(screen.getByText("Review outcome")).toBeTruthy();
    expect(screen.getByText("Comment")).toBeTruthy();
    expect(findPanel(/^signature$/i).textContent).toBe(SIGNATURE_LINE);
  });

  it("opens on the open risks and counts them on their tab", () => {
    renderBody();
    const tab = screen.getByRole("tab", { name: /open risks/i });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.textContent).toBe("Open risks 1");
    expect(findPanel(/open risks/i).hidden).toBe(false);
  });

  it("opens on the signature line once no risk is open", () => {
    renderBody({ open: [], counts: { addressed: 1, dismissed: 1, open: 0 } });
    expect(
      screen
        .getByRole("tab", { name: /signature/i })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("shows one section at a time, switched by its tab", () => {
    renderBody();
    expect(findPanel(/comments/i).hidden).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /comments/i }));

    expect(findPanel(/comments/i).hidden).toBe(false);
    expect(findPanel(/open risks/i).hidden).toBe(true);
    expect(findPanel(/not checked/i).textContent).toContain("Business intent");
  });

  it("shows the outline the grouping read and the files read shortened", () => {
    renderBody({
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
    renderBody({ generation: { outlineForm: "files", shortened: [] } });

    const outline = screen.getByTestId("receipt-outline-form").textContent;
    expect(outline).toContain("one line per file");
    expect(outline).toContain(
      "The grouping saw no code lines or hunk headers; groups were formed from paths and counts.",
    );
  });

  it("names only the read-as kinds that have a file", () => {
    renderBody({
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
    renderBody({
      generation: { outlineForm: "full", shortened: [] },
    });

    expect(screen.getByTestId("receipt-outline-form")).not.toBeNull();
    expect(screen.queryByTestId("receipt-shortened-files")).toBeNull();
  });

  it("shows no generation rows on a single-call receipt", () => {
    renderBody();

    expect(screen.queryByTestId("receipt-outline-form")).toBeNull();
  });

  it("renders chunks read, flags open and comments as tiles", () => {
    renderBody();
    const readRow = screen.getByText("Chunks read").parentElement;
    expect(readRow?.textContent).toContain("3/4");
    const flagsRow = screen.getByText("Flags open").parentElement;
    expect(flagsRow?.textContent).toContain("1");
    const commentsRow = screen.getByText("Inline comments").parentElement;
    expect(commentsRow?.textContent).toContain("2");
  });

  it("puts the counts on the risk and comment tabs", () => {
    renderBody();
    expect(screen.getByRole("tab", { name: "Open risks 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Comments 2" })).toBeTruthy();
  });

  it("lists comments with anchors and tags already-posted ones", () => {
    renderBody();
    expect(screen.getByText("src/a.ts:+3-5")).toBeTruthy();
    expect(screen.getByText("src/b.ts:-9")).toBeTruthy();
    expect(screen.getAllByText("· posted")).toHaveLength(1);
    expect(screen.getByText("Race on refresh.")).toBeTruthy();
  });

  it("sets the posted tag beside the anchor's code, not inside it", () => {
    renderBody();
    expect(screen.getByText("· posted").closest("code")).toBeNull();
  });

  it("isolates a comment anchor so it can be cut from the start", () => {
    renderBody();
    const anchor = screen.getByText("src/a.ts:+3-5");

    expect(anchor.tagName).toBe("BDI");
    expect(anchor.getAttribute("dir")).toBe("ltr");
    expect(anchor.closest("code")?.getAttribute("title")).toBe("src/a.ts:+3-5");
  });

  it("anchors a comment on a path with a bidi override by an escape", () => {
    const [first] = receipt().comments;
    renderBody({
      comments: [{ ...first!, file: "src/\u202Etxt.exe" }],
    });

    expect(screen.getByText("src/[U+202E]txt.exe:+3-5")).toBeTruthy();
  });

  it("shows the empty-comments copy when nothing is drafted", () => {
    renderBody({ comments: [] });
    expect(screen.getByText(/no draft comments in this preview/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Comments 0" })).toBeTruthy();
  });

  it("lists open risks first and keeps detail for resolved ones only", () => {
    renderBody();
    const headings = [...findPanel(/open risks/i).querySelectorAll("h3")].map(
      (node) => node.textContent,
    );
    expect(headings).toEqual([
      "Open risks at submit",
      "Addressed risks",
      "Dismissed risks",
    ]);
    expect(screen.getByText("Linked comment token.ts:+12")).toBeTruthy();
    expect(screen.getByText(/measured — bounded at 50 rows/)).toBeTruthy();
    expect(screen.queryByText(/Not addressed, not dismissed/)).toBeNull();
  });

  it("drops the group heading when only open risks remain", () => {
    renderBody({ addressed: [], dismissed: [] });
    expect(findPanel(/open risks/i).querySelector("h3")).toBeNull();
    expect(screen.getByText("schema.ts")).toBeTruthy();
  });

  it("heads addressed risks when they are the only group left", () => {
    renderBody({ open: [], dismissed: [] });
    const headings = [...findPanel(/open risks/i).querySelectorAll("h3")].map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(["Addressed risks"]);
  });

  it("marks mentions in dismiss reasons and comment lines the reviewer wrote", () => {
    const dismissed = [
      { id: "flag:b", attr: "perf", file: "src/list.ts", reason: "ask @cara" },
    ];
    const comments = receipt().comments.map((comment) => ({
      ...comment,
      firstLine: `${comment.firstLine} @dan`,
    }));
    renderBody({ dismissed, comments });

    const marked = screen
      .getAllByTestId("mention")
      .map((node) => node.textContent);
    expect(marked).toEqual(["@cara", "@dan", "@dan"]);
  });

  it("keeps the frozen artifact verbatim in the raw tab", () => {
    renderBody();
    expect(findPanel(/^raw$/i).querySelector("pre")?.textContent).toBe(
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
    renderBody();
    const pre = findPanel(/^raw$/i).querySelector("pre");
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
    renderBody();
    const pre = findPanel(/^raw$/i).querySelector("pre");
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
    renderBody();
    const paths = [...findPanel(/^raw$/i).querySelectorAll("bdi")].map(
      (node) => [node.dir, node.textContent],
    );
    expect(paths).toEqual([
      ["ltr", "dist/install.js"],
      ["ltr", "vendor/.bin/install.js"],
    ]);
  });
});

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BODY_STYLESHEET = join(TEST_DIRECTORY, "ReceiptBody.module.scss");
const BODY_RULES = parseCompiledRules(compileStylesheet(BODY_STYLESHEET));
const VIEW_STYLESHEET = join(TEST_DIRECTORY, "..", "SubmitModal.module.scss");
const VIEW_RULES = parseCompiledRules(compileStylesheet(VIEW_STYLESHEET));
const TALL_TOUCH_MEDIA = `(pointer: coarse) and (height > ${String(LANDSCAPE_HEIGHT_PX)}px)`;

describe("ReceiptBody scrolling", () => {
  it("hands a scroll past the section panel to the body with a fine pointer", () => {
    const panel = readDeclarations(BODY_RULES, ".stack .panel");
    const shortPanel = readDeclarations(
      BODY_RULES,
      ".stack .panel",
      SHORT_SCREEN_MEDIA,
    );
    const body = readDeclarations(VIEW_RULES, ".receiptBody");

    expect(panel.get("overflow-y")).toBe("auto");
    expect(panel.has("overscroll-behavior")).toBe(false);
    expect(shortPanel.has("overscroll-behavior")).toBe(false);
    expect(body.get("overscroll-behavior")).toBe("contain");
  });

  it("stops a scroll at the panel's end with a coarse pointer when tall", () => {
    const touchPanel = readDeclarations(
      BODY_RULES,
      ".stack .panel",
      TALL_TOUCH_MEDIA,
    );

    expect(touchPanel.get("overscroll-behavior")).toBe("contain");
  });

  it("hands a drag past the body on to the box when short", () => {
    const body = readDeclarations(
      VIEW_RULES,
      ".receiptBody",
      SHORT_SCREEN_MEDIA,
    );
    const box = readDeclarations(VIEW_RULES, ".receiptBox", SHORT_SCREEN_MEDIA);

    expect(body.get("overscroll-behavior")).toBe("auto");
    expect(box.get("overscroll-behavior")).toBe("contain");
  });
});
