// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentScopeProvider } from "@web/components/Markdown/context";
import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import {
  ATTACHMENT_ASSET_ID,
  ATTACHMENT_ASSET_URL,
} from "@web/test/attachments";
import {
  ChunkTokenStatuses,
  GrammarNames,
  TokenizeModes,
} from "@web/utils/diffTokens/types";
import { CommentAnchorKinds } from "types/comments";
import { CommentSides, type CommentAnchor } from "../../utils/comments";
import { MarkdownPreview } from ".";

const { requestSnippetTokens } = vi.hoisted(() => ({
  requestSnippetTokens: vi.fn(),
}));

vi.mock("@web/utils/diffTokens/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    canTokenizeChunks: () => true,
    requestSnippetTokens,
    warmDiffTokenWorker: () => undefined,
  };
});

const ANCHOR: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  file: "src/a.ts",
  chunkId: "chunk-1",
  side: CommentSides.NEW,
  startLine: 4,
  endLine: 4,
  rowIds: ["r4"],
  selectedText: "const a = 1;",
};

const BODY = "Try this:\n```suggestion\nconst a = 2;\n```";

beforeEach(() => {
  requestSnippetTokens.mockReset();
  requestSnippetTokens.mockReturnValue({
    promise: Promise.resolve({ status: ChunkTokenStatuses.PLAIN }),
    cancel: () => undefined,
  });
});

afterEach(cleanup);

describe("MarkdownPreview suggestion colour", () => {
  it("anchors the suggestion's language on the comment's file", () => {
    render(
      <TokenPlanProvider
        briefKey="brief-1"
        chunkSizes={[{ file: "src/a.ts", rowCount: 3 }]}
      >
        <MarkdownPreview anchor={ANCHOR} body={BODY} />
      </TokenPlanProvider>,
    );

    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      briefKey: "brief-1",
      filePath: "src/a.ts",
      mode: TokenizeModes.HUNK,
    });
  });

  it("admits the grammar the anchored file resolves to", () => {
    render(
      <TokenPlanProvider
        briefKey="brief-1"
        chunkSizes={[{ file: "src/a.ts", rowCount: 3 }]}
      >
        <MarkdownPreview anchor={ANCHOR} body={BODY} />
      </TokenPlanProvider>,
    );

    const request = requestSnippetTokens.mock.calls[0]?.[0] as
      | { admitted: ReadonlySet<string> }
      | undefined;

    expect(request?.admitted.has(GrammarNames.TYPESCRIPT)).toBe(true);
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("MarkdownPreview raw html images", () => {
  it("renders a pasted screenshot tag as an image", () => {
    render(
      <MarkdownPreview
        anchor={ANCHOR}
        body={`<img width="20" height="10" alt="Image" src="${ATTACHMENT_ASSET_URL}" />`}
      />,
    );

    const image = screen.getByRole("img", { name: "Image" });
    expect(image.getAttribute("src")).toBe(ATTACHMENT_ASSET_URL);
    expect(image.getAttribute("width")).toBe("20");
    expect(screen.queryByText(/<img/)).toBeNull();
  });

  it("routes an attachment through the api proxy inside a scope", () => {
    render(
      <AttachmentScopeProvider prNumber={7} repoId="555">
        <MarkdownPreview
          anchor={ANCHOR}
          body={`<img alt="Image" src="${ATTACHMENT_ASSET_URL}" />`}
        />
      </AttachmentScopeProvider>,
    );

    expect(screen.getByRole("img", { name: "Image" }).getAttribute("src")).toBe(
      `/api/repos/555/pulls/7/attachments/${ATTACHMENT_ASSET_ID}`,
    );
  });

  it("drops a script tag entirely", () => {
    const { container } = render(
      <MarkdownPreview
        anchor={ANCHOR}
        body={`<script>window.pwned = true</script>\n\nText`}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("pwned");
  });
});

describe("MarkdownPreview headings", () => {
  it("demotes authored headings the way a posted comment renders them", () => {
    render(
      <MarkdownPreview anchor={ANCHOR} body={"# Blocking\n\n## Detail"} />,
    );

    expect(screen.getByRole("heading", { name: "Blocking" }).tagName).toBe(
      "H3",
    );
    expect(screen.getByRole("heading", { name: "Detail" }).tagName).toBe("H4");
  });
});
