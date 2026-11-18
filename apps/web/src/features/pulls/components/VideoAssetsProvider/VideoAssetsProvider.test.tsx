// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ATTACHMENT_ASSET_PATH_PREFIX } from "contract";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@web/components/Markdown";
import { AttachmentScopeProvider } from "@web/components/Markdown/context";
import { ATTACHMENT_ASSET_ID } from "@web/test/attachments";

vi.mock("../../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../../data/apiFetch";
import { VideoAssetsProvider } from ".";

const apiFetchMock = vi.mocked(apiFetch);

const REPO_ID = "42";
const PR_NUMBER = 7;
const VIDEO_ID = ATTACHMENT_ASSET_ID;
const IMAGE_ID = "96abe080-db23-4366-9eb8-32a76d148ae5";
const LATER_ID = "0f6c1f2e-61b3-4d55-9c1a-0b2d7f3e9a10";
const ASSET_PREFIX = `https://github.com${ATTACHMENT_ASSET_PATH_PREFIX}`;
const VIDEO_ASSETS_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/video-assets`;
const SETTLE_ROUNDS = 5;

function answerVideoAssets(assetIds: readonly string[]): Response {
  return new Response(JSON.stringify({ assetIds }), { status: 200 });
}

/** Lets each fetch and the state it sets land; the query cache notifies on a timer. */
async function settle(): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

interface PageProps {
  bodies: readonly string[];
  prNumber?: number;
}

/** A description and its comments, rendered the way the brief page renders people's text. */
function Page({ bodies, prNumber = PR_NUMBER }: PageProps) {
  return (
    <AttachmentScopeProvider installed prNumber={prNumber} repoId={REPO_ID}>
      <VideoAssetsProvider prNumber={prNumber} repoId={REPO_ID}>
        {bodies.map((body) => (
          <Markdown content={body} key={body} renderHtml renderMentions />
        ))}
      </VideoAssetsProvider>
    </AttachmentScopeProvider>
  );
}

function renderPage(bodies: readonly string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<Page bodies={bodies} />, { wrapper: Wrapper });
}

function countVideos(container: HTMLElement): number {
  return container.querySelectorAll("video").length;
}

describe("VideoAssetsProvider", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("plays the confirmed lines and asks once by name for the rest", async () => {
    apiFetchMock.mockImplementation(async () => answerVideoAssets([VIDEO_ID]));
    const description = `Demo:\n${ASSET_PREFIX}${VIDEO_ID}`;
    const comment = `Same again\n\n${ASSET_PREFIX}${VIDEO_ID}\n\n${ASSET_PREFIX}${IMAGE_ID}`;

    const { container } = renderPage([description, comment]);
    await settle();

    expect(apiFetchMock.mock.calls.map(([path]) => path)).toEqual([
      VIDEO_ASSETS_PATH,
      `${VIDEO_ASSETS_PATH}?missing=${IMAGE_ID}`,
    ]);
    expect(countVideos(container)).toBe(2);
    const imageLine = `${ASSET_PREFIX}${IMAGE_ID}`;
    expect(screen.getByRole("link", { name: imageLine })).toBeTruthy();
  });

  it("plays a confirmed line in a description with CRLF line breaks", async () => {
    apiFetchMock.mockResolvedValue(answerVideoAssets([VIDEO_ID]));
    const description = `Demo:\r\n${ASSET_PREFIX}${VIDEO_ID}\r\nAfter text.`;

    const { container } = renderPage([description]);
    await settle();

    expect(countVideos(container)).toBe(1);
  });

  it("asks nothing for text with no bare asset line", async () => {
    renderPage([`See [the clip](${ASSET_PREFIX}${VIDEO_ID}).`]);
    await settle();

    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("keeps every line a link when the read fails", async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = renderPage([`${ASSET_PREFIX}${VIDEO_ID}`]);
    await settle();

    expect(countVideos(container)).toBe(0);
    const line = `${ASSET_PREFIX}${VIDEO_ID}`;
    expect(screen.getByRole("link", { name: line })).toBeTruthy();
  });

  it("asks again once for a line posted after the answer", async () => {
    apiFetchMock
      .mockResolvedValueOnce(answerVideoAssets([VIDEO_ID]))
      .mockResolvedValueOnce(answerVideoAssets([VIDEO_ID, LATER_ID]));
    const first = `${ASSET_PREFIX}${VIDEO_ID}`;

    const view = renderPage([first]);
    await settle();
    view.rerender(<Page bodies={[first, `${ASSET_PREFIX}${LATER_ID}`]} />);
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock.mock.calls[1]?.[0]).toBe(
      `${VIDEO_ASSETS_PATH}?missing=${LATER_ID}`,
    );
    expect(countVideos(view.container)).toBe(2);
  });

  it("asks again once for a line that mounted before a stale answer", async () => {
    apiFetchMock
      .mockResolvedValueOnce(answerVideoAssets([VIDEO_ID]))
      .mockResolvedValueOnce(answerVideoAssets([VIDEO_ID, LATER_ID]));
    const bodies = [`${ASSET_PREFIX}${VIDEO_ID}`, `${ASSET_PREFIX}${LATER_ID}`];

    const { container } = renderPage(bodies);
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock.mock.calls[1]?.[0]).toBe(
      `${VIDEO_ASSETS_PATH}?missing=${LATER_ID}`,
    );
    expect(countVideos(container)).toBe(2);
  });

  it("asks nothing on the next pull request when its text has no line", async () => {
    apiFetchMock.mockResolvedValue(answerVideoAssets([VIDEO_ID]));

    const view = renderPage([`${ASSET_PREFIX}${VIDEO_ID}`]);
    await settle();
    view.rerender(
      <Page bodies={["No media here."]} prNumber={PR_NUMBER + 1} />,
    );
    await settle();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(VIDEO_ASSETS_PATH);
  });
});
