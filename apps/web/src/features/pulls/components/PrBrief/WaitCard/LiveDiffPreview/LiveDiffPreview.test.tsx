// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChunkTokenStatuses, TokenizeModes } from "@web/utils/diffTokens/types";
import { LiveDiffPreview } from ".";

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

const SPAN = { base: "base1234", head: "head1234" };
const REPO_ID = "acme/widgets";
const PR_NUMBER = 7;

function makePatch(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,1 +1,2 @@",
    " const a = 1;",
    "+const b = 2;",
  ].join("\n");
}

function makeDiffText(files: readonly string[]): string {
  return files.map((file) => makePatch(file)).join("\n");
}

function stubClient(files: readonly string[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ["pr-diff", REPO_ID, PR_NUMBER, SPAN.base, SPAN.head],
    makeDiffText(files),
  );

  return client;
}

function renderPreview(files: readonly string[]): void {
  render(
    <QueryClientProvider client={stubClient(files)}>
      <LiveDiffPreview prNumber={PR_NUMBER} repoId={REPO_ID} span={SPAN} />
    </QueryClientProvider>,
  );
}

function readFileNames(): string[] {
  return screen.getAllByRole("group").map((group) => group.textContent ?? "");
}

beforeEach(() => {
  requestSnippetTokens.mockReset();
  requestSnippetTokens.mockReturnValue({
    promise: Promise.resolve({ status: ChunkTokenStatuses.PLAIN }),
    cancel: () => undefined,
  });
});

describe("LiveDiffPreview", () => {
  const MANY_FILES = [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.ts",
    "src/e.ts",
    "src/f.ts",
  ];

  it("opens every file when there are five or fewer", () => {
    renderPreview(["src/a.ts", "src/b.ts"]);

    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(readFileNames()).toHaveLength(2);
  });

  it("asks for tokens per open file at five files or fewer", () => {
    renderPreview(["src/a.ts", "src/b.ts"]);

    expect(requestSnippetTokens).toHaveBeenCalledTimes(2);
  });

  it("asks for nothing while every file is collapsed", () => {
    renderPreview(MANY_FILES);

    expect(requestSnippetTokens).not.toHaveBeenCalled();
  });

  it("asks once for the file the reader expands", () => {
    renderPreview(MANY_FILES);

    // jsdom does not toggle a <details> on a summary click, so the open
    // state is set the way the browser would before the event is dispatched.
    const [first] = screen.getAllByRole("group");
    if (!(first instanceof HTMLDetailsElement)) {
      throw new Error("no file disclosure was rendered");
    }
    first.open = true;
    fireEvent(first, new Event("toggle", { bubbles: false }));

    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      filePath: "src/a.ts",
      mode: TokenizeModes.HUNK,
    });
  });
});
