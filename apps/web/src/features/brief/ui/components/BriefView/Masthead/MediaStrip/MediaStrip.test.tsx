// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AttachmentScopeProvider,
  VideoAssetsScope,
  type VideoAssets,
} from "@web/components/Markdown/context";
import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  ATTACHMENT_READ_PATH as READ_PATH,
  ATTACHMENT_SCOPE as SCOPE,
  MERMAID_SEQUENCE_FENCE as SEQUENCE,
  OUTSIDE_IMAGE_URL as OUTSIDE_URL,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import type { Brief } from "../../../../../model/types";
import { briefFixture } from "../../../../../test-utils/fixtures";
import { useStripEntries } from "./useStripEntries";
import { MediaStrip } from ".";

const REPO_ID = SCOPE.repoId;
const PR_NUMBER = SCOPE.prNumber;
const ASSET_READ = `${READ_PATH}/attachments/${ASSET_ID}`;
const NO_VIDEO_ASSETS: VideoAssets = { requestVideoAssets: () => {} };

function makeBrief(description: string): Brief {
  return { ...briefFixture, pr: { ...briefFixture.pr, description } };
}

interface HarnessProps {
  brief: Brief;
}

function Harness({ brief }: HarnessProps) {
  const entries = useStripEntries(brief);
  return <MediaStrip entries={entries} />;
}

function renderStrip(description: string, videoAssets = NO_VIDEO_ASSETS) {
  return render(
    <AttachmentScopeProvider
      installed
      prNumber={PR_NUMBER}
      repoId={REPO_ID}
      repoSlug={briefFixture.pr.repo}
    >
      <VideoAssetsScope value={videoAssets}>
        <Harness brief={makeBrief(description)} />
      </VideoAssetsScope>
    </AttachmentScopeProvider>,
  );
}

function readTiles(): HTMLElement[] {
  return screen.getAllByTestId("media-tile");
}

describe("MediaStrip", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows nothing when the description holds no Media", () => {
    renderStrip("Just words, and [a link](https://example.com).");

    expect(screen.queryByTestId("media-strip")).toBeNull();
  });

  it("names the strip and counts its kinds", () => {
    renderStrip(`![A](${ASSET_URL})\n\n![B](${OUTSIDE_URL})\n\n${SEQUENCE}`);

    const strip = screen.getByRole("region", { name: "Media" });
    expect(strip.textContent).toContain(
      "2 images, 1 diagram from the description",
    );
  });

  it("asks the read for a proxied image's thumbnail", () => {
    renderStrip(`![Login screen](${ASSET_URL})`);

    const [tile] = readTiles();
    const image = tile?.querySelector("img");
    expect(image?.getAttribute("src")).toBe(`${ASSET_READ}?thumbnail=strip`);
    expect(image?.hasAttribute("referrerpolicy")).toBe(false);
    expect(tile?.textContent).toBe("Login screen");
  });

  it("loads an outside-host image directly", () => {
    renderStrip(`![Shot](${OUTSIDE_URL})`);

    const image = readTiles()[0]?.querySelector("img");
    expect(image?.getAttribute("src")).toBe(OUTSIDE_URL);
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("shows the failed tile when the thumbnail fails, never the original", () => {
    renderStrip(`![Login screen](${ASSET_URL})`);
    const [tile] = readTiles();
    if (tile === undefined) {
      throw new Error("no tile");
    }

    fireEvent.error(within(tile).getByRole("presentation"));

    expect(tile.querySelector("img")).toBeNull();
    expect(tile.textContent).toContain("Image could not load");
    expect(tile.textContent).toContain("Login screen");
  });

  it("draws a diagram as a tile named for its type, never a live render", () => {
    renderStrip(SEQUENCE);

    const [tile] = readTiles();
    expect(tile?.getAttribute("data-kind")).toBe("diagram");
    expect(tile?.querySelector("iframe")).toBeNull();
    expect(
      within(tile ?? document.body).getAllByText("Sequence diagram"),
    ).not.toHaveLength(0);
  });

  it("asks about a pasted asset line and lists it once it is a video", () => {
    const requestVideoAssets = vi.fn();
    const description = `Demo:\n\n${ASSET_URL}`;

    const { unmount } = renderStrip(description, { requestVideoAssets });
    expect(requestVideoAssets).toHaveBeenCalledWith(ASSET_ID);
    expect(screen.queryByTestId("media-strip")).toBeNull();
    unmount();

    renderStrip(description, {
      requestVideoAssets,
      videoAssetIds: new Set([requireAttachmentAssetId(ASSET_ID)]),
    });
    const [tile] = readTiles();
    expect(tile?.getAttribute("data-kind")).toBe("video");
    expect(tile?.querySelector("img, video")).toBeNull();
  });

  it("leaves a video on an outside host out of the strip", () => {
    renderStrip('<video src="https://example.com/demo.mp4"></video>');

    expect(screen.queryByTestId("media-strip")).toBeNull();
  });
});
