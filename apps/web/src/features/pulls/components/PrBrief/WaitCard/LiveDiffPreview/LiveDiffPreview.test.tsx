// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function readDisclosureOpen(group: HTMLElement): boolean {
  return group instanceof HTMLDetailsElement && group.open;
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

    const files = screen.getAllByRole("group");
    expect(files.map((file) => readDisclosureOpen(file))).toEqual([true, true]);
  });

  it("names a file with a bidi override by a visible escape", () => {
    renderPreview(["src/\u202Etxt.exe", "docs/שלום.md"]);

    expect(screen.getByText("src/[U+202E]txt.exe")).toBeTruthy();
    expect(screen.getByText("docs/שלום.md")).toBeTruthy();
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

describe("LiveDiffPreview on a diff GitHub did not render in time", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function answerTimeout(): Response {
    return new Response(
      JSON.stringify({
        error: "github did not render the diff in time",
        code: "diff-fetch-timeout",
      }),
      { status: 504, headers: { "content-type": "application/json" } },
    );
  }

  function answerUnavailable(): Response {
    return new Response(
      JSON.stringify({
        error: "github unavailable",
        code: "github-unavailable",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  function renderLivePreview(): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LiveDiffPreview prNumber={PR_NUMBER} repoId={REPO_ID} span={SPAN} />
      </QueryClientProvider>,
    );
  }

  it("says GitHub was slow and loads the diff on retry", async () => {
    fetchMock
      .mockResolvedValueOnce(answerTimeout())
      .mockResolvedValueOnce(new Response(makeDiffText(["src/a.ts"])));
    renderLivePreview();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("GitHub took too long");
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    expect(await screen.findByText("src/a.ts")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement?.textContent).toContain("src/a.ts");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Diff loaded."),
    );
  });

  it("keeps focus on the button when the retry times out again", async () => {
    fetchMock
      .mockResolvedValueOnce(answerTimeout())
      .mockResolvedValueOnce(answerTimeout());
    renderLivePreview();
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBe(button),
    );
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("moves focus to the note and says so when the retry fails otherwise", async () => {
    fetchMock
      .mockResolvedValueOnce(answerTimeout())
      .mockResolvedValueOnce(answerUnavailable());
    renderLivePreview();
    const button = await screen.findByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    const note = await screen.findByText("The diff is not viewable right now.");
    expect(document.activeElement).toBe(note);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "The diff did not load.",
      ),
    );
  });
});
