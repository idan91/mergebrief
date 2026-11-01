// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@web/components/Markdown";
import {
  AttachmentScopeProvider,
  VideoAssetsScope,
  type VideoAssets,
} from "@web/components/Markdown/context";
import {
  ATTACHMENT_ASSET_ID as ASSET_ID,
  ATTACHMENT_ASSET_URL as ASSET_URL,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import type { Brief } from "../../../../../../model/types";
import { briefFixture } from "../../../../../../test-utils/fixtures";
import {
  buildDiagramSvg,
  buildSandboxFrameMarkup,
} from "@web/components/MermaidDiagram/test-utils";
import { Summary } from "../../Summary";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

const REPO_ID = "555";
const PR_NUMBER = 7;
const ASSET_READ = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/attachments/${ASSET_ID}`;
const OUTSIDE_URL = "https://example.com/shot.png";
const DIAGRAM_CODE = "sequenceDiagram\n  A->>B: hi\n";
const DESCRIPTION = [
  `![Before](${ASSET_URL})`,
  `![Outside](${OUTSIDE_URL})`,
  `\`\`\`mermaid\n${DIAGRAM_CODE}\`\`\``,
].join("\n\n");
const NO_VIDEO_ASSETS: VideoAssets = { requestVideoAssets: () => {} };
const VIDEO_DESCRIPTION = `Demo:\n\n${ASSET_URL}\n\n![Outside](${OUTSIDE_URL})`;
const CONFIRMED_VIDEO: VideoAssets = {
  requestVideoAssets: () => {},
  videoAssetIds: new Set([requireAttachmentAssetId(ASSET_ID)]),
};

function makeBrief(description: string): Brief {
  return { ...briefFixture, pr: { ...briefFixture.pr, description } };
}

function renderSummary(
  description = DESCRIPTION,
  videoAssets: VideoAssets = NO_VIDEO_ASSETS,
) {
  return render(
    <AttachmentScopeProvider
      installed
      prNumber={PR_NUMBER}
      repoId={REPO_ID}
      repoSlug={briefFixture.pr.repo}
    >
      <VideoAssetsScope value={videoAssets}>
        <Summary brief={makeBrief(description)} />
        <Markdown content={`![Outside](${OUTSIDE_URL})`} renderHtml />
      </VideoAssetsScope>
    </AttachmentScopeProvider>,
  );
}

function openTile(name: string): HTMLElement {
  const tile = screen.getByRole("button", { name });
  fireEvent.click(tile);
  return tile;
}

function readDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function loadImage(image: HTMLElement, width: number, height: number): void {
  Object.defineProperty(image, "naturalWidth", { value: width });
  Object.defineProperty(image, "naturalHeight", { value: height });
  fireEvent.load(image);
}

function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
}

function stubStageSize(width: number, height: number): void {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(height);
}

function stubPointerCapture(): void {
  Element.prototype.setPointerCapture = vi.fn();
}

function readZoomItem(): HTMLElement {
  return within(readDialog()).getByTestId("lightbox-zoom-item");
}

function readZoomViewport(): HTMLElement {
  const viewport = readZoomItem().parentElement?.parentElement;
  if (viewport === null || viewport === undefined) {
    throw new Error("no zoom viewport");
  }
  return viewport;
}

function clickZoom(name: string): void {
  fireEvent.click(within(readDialog()).getByRole("button", { name }));
}

describe("MediaLightbox", () => {
  afterEach(() => {
    cleanup();
    mermaid.render.mockReset();
    vi.restoreAllMocks();
  });

  it("opens from a tile at its place with caption and counter", () => {
    renderSummary();

    openTile("Open image: Outside");

    const dialog = readDialog();
    expect(within(dialog).getByRole("heading").textContent).toBe("Outside");
    expect(dialog.textContent).toContain("2 of 3");
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      OUTSIDE_URL,
    );
  });

  it("titles a caption-less pasted image by its kind, never its id", () => {
    renderSummary(`![](${ASSET_URL})`);

    openTile("Open image");

    const dialog = readDialog();
    expect(within(dialog).getByRole("heading").textContent).toBe("Image");
    expect(document.body.textContent).not.toContain(ASSET_ID);
  });

  it("links the original on GitHub only for a GitHub host", () => {
    renderSummary();

    openTile("Open image: Outside");
    expect(within(readDialog()).queryByRole("link")).toBeNull();

    pressKey("ArrowLeft");
    const link = within(readDialog()).getByRole("link", {
      name: /open on github/i,
    });
    expect(link.getAttribute("href")).toBe(ASSET_URL);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(readDialog()).getByRole("img").getAttribute("src")).toBe(
      ASSET_READ,
    );
  });

  it("steps with the arrow keys and buttons, wrapping at either end", () => {
    renderSummary();
    openTile("Open image: Before");

    pressKey("ArrowLeft");
    expect(readDialog().textContent).toContain("3 of 3");
    pressKey("ArrowRight");
    expect(readDialog().textContent).toContain("1 of 3");
    fireEvent.click(within(readDialog()).getByRole("button", { name: "Next" }));
    expect(readDialog().textContent).toContain("2 of 3");
    fireEvent.click(
      within(readDialog()).getByRole("button", { name: "Previous" }),
    );
    expect(readDialog().textContent).toContain("1 of 3");
  });

  it("closes on Escape and returns focus to the tile that opened it", async () => {
    renderSummary();
    const tile = openTile("Open image: Outside");

    pressKey("Escape");
    await Promise.resolve();

    expect(readDialog().parentElement?.getAttribute("data-state")).toBe(
      "closed",
    );
    expect(document.activeElement).toBe(tile);
  });

  it("opens from an inline description image at its own place", () => {
    renderSummary();
    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    const [descriptionImage] = screen.getAllByRole("button", {
      name: "Enlarge Outside",
    });
    if (descriptionImage === undefined) {
      throw new Error("no inline opener");
    }
    fireEvent.click(descriptionImage);

    expect(readDialog().textContent).toContain("2 of 3");
  });

  it("leaves an image outside the description as an image", () => {
    renderSummary();
    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    expect(
      screen.getAllByRole("button", { name: "Enlarge Outside" }),
    ).toHaveLength(1);
    const images = screen.getAllByRole("img", { name: "Outside" });
    const plain = images.filter((image) => image.closest("button") === null);
    expect(plain).toHaveLength(1);
  });

  it("keeps a linked copy of a strip image as the author's link", () => {
    renderSummary(
      `![Outside](${OUTSIDE_URL})\n\n[![Outside](${OUTSIDE_URL})](${OUTSIDE_URL})`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    const links = screen.getAllByRole("link", { name: "Outside" });
    expect(links).toHaveLength(1);
    expect(links[0]?.querySelector("button")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Enlarge Outside" }),
    ).toHaveLength(1);
  });

  it("shows the failed panel and keeps stepping", () => {
    renderSummary();
    openTile("Open image: Before");

    fireEvent.error(within(readDialog()).getByRole("img"));

    const panel = screen.getByTestId("media-failed-panel");
    expect(panel.textContent).toContain("Image could not load");
    expect(within(panel).getByRole("link").getAttribute("href")).toBe(
      ASSET_URL,
    );
    pressKey("ArrowRight");
    expect(screen.queryByTestId("media-failed-panel")).toBeNull();
  });

  it("shows a diagram's source when it cannot be drawn", async () => {
    mermaid.render.mockRejectedValue(new Error("Parse error"));
    renderSummary();

    openTile("Open diagram: Sequence diagram");

    const dialog = readDialog();
    const note = await within(dialog).findByText("Diagram could not render");
    expect(note.parentElement?.querySelector("pre code")?.textContent).toBe(
      DIAGRAM_CODE,
    );
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("zooms an image past the stage to its natural pixels and back", () => {
    stubStageSize(1200, 800);
    renderSummary();
    openTile("Open image: Outside");

    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);
    expect(readZoomItem().style.inlineSize).toBe("1200px");
    clickZoom("Show actual size");

    expect(readZoomItem().style.inlineSize).toBe("2880px");
    expect(readZoomItem().style.blockSize).toBe("1800px");
    clickZoom("Fit to screen");
    expect(readZoomItem().style.inlineSize).toBe("1200px");
  });

  it("draws natural pixels as CSS pixels on a dense screen", () => {
    stubStageSize(1200, 800);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    renderSummary();
    openTile("Open image: Outside");

    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);
    clickZoom("Show actual size");

    expect(readZoomItem().style.inlineSize).toBe("2880px");
  });

  it("offers no zoom for an image that already fits", () => {
    stubStageSize(1200, 800);
    renderSummary();
    openTile("Open image: Outside");

    loadImage(within(readDialog()).getByRole("img"), 800, 600);

    expect(
      within(readDialog()).queryByRole("button", { name: "Show actual size" }),
    ).toBeNull();
    expect(readZoomItem().style.inlineSize).toBe("800px");
  });

  it("returns to fit on a click, but not on one that ends a drag", () => {
    stubStageSize(1200, 800);
    stubPointerCapture();
    renderSummary();
    openTile("Open image: Outside");
    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);
    clickZoom("Show actual size");
    const viewport = readZoomViewport();

    const toggle = within(readDialog()).getByRole("button", {
      name: "Fit to screen",
    });

    fireEvent.pointerDown(toggle, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(toggle, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(toggle, { pointerId: 1, clientX: 400 });
    fireEvent.click(toggle, { detail: 1 });

    expect(viewport.scrollLeft).toBe(100);
    expect(readZoomItem().style.inlineSize).toBe("2880px");
    fireEvent.pointerDown(toggle, { pointerId: 2, button: 0, clientX: 500 });
    fireEvent.pointerUp(toggle, { pointerId: 2, clientX: 500 });
    fireEvent.click(toggle, { detail: 1 });
    expect(readZoomItem().style.inlineSize).toBe("1200px");
  });

  it("pans a zoomed image with the arrows instead of stepping", () => {
    stubStageSize(1200, 800);
    const scrollBy = vi.fn();
    const original = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollBy",
    );
    Element.prototype.scrollBy = scrollBy;
    renderSummary();
    openTile("Open image: Outside");
    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);
    clickZoom("Show actual size");

    pressKey("ArrowRight");

    expect(readDialog().textContent).toContain("2 of 3");
    expect(scrollBy).toHaveBeenCalledWith({ left: 40, top: 0 });
    fireEvent.click(within(readDialog()).getByRole("button", { name: "Next" }));
    expect(readDialog().textContent).toContain("3 of 3");
    if (original === undefined) {
      Reflect.deleteProperty(Element.prototype, "scrollBy");
    } else {
      Object.defineProperty(Element.prototype, "scrollBy", original);
    }
  });

  it("opens the next item at fit after stepping from a zoomed one", () => {
    stubStageSize(1200, 800);
    renderSummary(`![One](${OUTSIDE_URL})\n\n![Two](${OUTSIDE_URL}?2)`);
    openTile("Open image: One");
    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);
    clickZoom("Show actual size");

    fireEvent.click(within(readDialog()).getByRole("button", { name: "Next" }));
    loadImage(within(readDialog()).getByRole("img"), 2880, 1800);

    expect(readZoomItem().style.inlineSize).toBe("1200px");
  });

  it("zooms a diagram larger than the stage to its own size", async () => {
    stubStageSize(1200, 800);
    mermaid.render.mockResolvedValue({
      svg: buildSandboxFrameMarkup(buildDiagramSvg("0 0 1600 900")),
    });
    renderSummary("```mermaid\nsequenceDiagram\n  C->>D: wide\n```");
    openTile("Open diagram: Sequence diagram");

    fireEvent.click(
      await within(readDialog()).findByRole("button", {
        name: "Show actual size",
      }),
    );

    expect(readZoomItem().style.inlineSize).toBe("1600px");
  });

  it("leaves arrows on a focused player to seek, not step", () => {
    renderSummary(VIDEO_DESCRIPTION, CONFIRMED_VIDEO);
    openTile("Open video: Demo");

    const video = readDialog().querySelector("video");
    if (video === null) {
      throw new Error("no player in the lightbox");
    }
    fireEvent.keyDown(video, { key: "ArrowRight" });

    expect(readDialog().textContent).toContain("1 of 2");
  });

  it("shows a failed video's panel and still steps both ways", () => {
    renderSummary(VIDEO_DESCRIPTION, CONFIRMED_VIDEO);
    openTile("Open video: Demo");

    const video = readDialog().querySelector("video");
    if (video === null) {
      throw new Error("no player in the lightbox");
    }
    fireEvent.error(video);

    const panel = screen.getByTestId("media-failed-panel");
    expect(panel.textContent).toContain("Video could not load");
    expect(within(panel).getByRole("link").getAttribute("href")).toBe(
      ASSET_URL,
    );
    fireEvent.click(within(readDialog()).getByRole("button", { name: "Next" }));
    expect(readDialog().textContent).toContain("2 of 2");
    fireEvent.click(
      within(readDialog()).getByRole("button", { name: "Previous" }),
    );
    expect(readDialog().textContent).toContain("1 of 2");
  });

  it("shows no arrows when the strip holds one item", () => {
    renderSummary(`![Outside](${OUTSIDE_URL})`);
    openTile("Open image: Outside");

    expect(readDialog().textContent).toContain("1 of 1");
    expect(
      within(readDialog()).queryByRole("button", { name: "Next" }),
    ).toBeNull();
  });
});
