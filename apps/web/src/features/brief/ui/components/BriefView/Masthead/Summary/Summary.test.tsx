// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  buildAddressMediaKey,
  buildMermaidMediaKey,
  type MediaKey,
} from "brief-core/media";
import { SummaryMediaPositions, type SummaryMedia } from "brief-core/types";
import { LocalBriefKinds } from "contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AttachmentScopeProvider,
  VideoAssetsScope,
  type VideoAssets,
} from "@web/components/Markdown/context";
import {
  buildDiagramSvg,
  buildSandboxFrameMarkup,
} from "@web/components/MermaidDiagram/test-utils";
import {
  ATTACHMENT_ASSET_ID,
  ATTACHMENT_ASSET_URL,
} from "@web/test/attachments";
import type { Brief } from "../../../../../model/types";
import { briefFixture } from "../../../../../test-utils/fixtures";
import { useMediaGallery } from "../MediaStrip/useMediaGallery";
import { Summary } from ".";

interface StubbedSummaryProps {
  brief: Brief;
}

/** The masthead's wiring: one gallery, handed to the summary. */
function StubbedSummary({ brief }: StubbedSummaryProps) {
  const gallery = useMediaGallery(brief);
  return <Summary brief={brief} gallery={gallery} />;
}

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

const OUTSIDE_AFTER_URL = "https://example.com/after.png";
const OUTSIDE_THIRD_URL = "https://example.com/third.png";
const VIDEO_URL = "https://github.com/acme/widgets/raw/main/demo.mp4";
const STALE_URL = "https://example.com/gone.png";
const DIAGRAM_CODE = "sequenceDiagram\n  A->>B: hi\n";
const DESCRIPTION = [
  `![Before](${ATTACHMENT_ASSET_URL})`,
  `![After](${OUTSIDE_AFTER_URL})`,
  `![Third](${OUTSIDE_THIRD_URL})`,
  `<video src="${VIDEO_URL}"></video>`,
  `\`\`\`mermaid\n${DIAGRAM_CODE}\`\`\``,
].join("\n\n");
const BEFORE = readAddressKey(ATTACHMENT_ASSET_URL);
const AFTER = readAddressKey(OUTSIDE_AFTER_URL);
const THIRD = readAddressKey(OUTSIDE_THIRD_URL);
const VIDEO = readAddressKey(VIDEO_URL);
const STALE = readAddressKey(STALE_URL);
const DIAGRAM = buildMermaidMediaKey(DIAGRAM_CODE);
const LEDE = "Adds a retry to the upload.";
const WITH_CHANGELOG = `${LEDE}\n\n## Changelog\n\n- Retries twice`;
const POINTER_NAME = "Before and after, in Media below";
const NO_VIDEO_ASSETS: VideoAssets = { requestVideoAssets: () => {} };

function readAddressKey(address: string): MediaKey {
  const key = buildAddressMediaKey(address);
  if (key === undefined) {
    throw new Error(`no key for ${address}`);
  }
  return key;
}

function makeBrief(
  summary: string,
  summaryMedia?: SummaryMedia,
  description = DESCRIPTION,
): Brief {
  const brief: Brief = {
    ...briefFixture,
    summary,
    pr: { ...briefFixture.pr, description },
  };
  if (summaryMedia !== undefined) {
    brief.summaryMedia = summaryMedia;
  }
  return brief;
}

function renderSummary(brief: Brief) {
  return render(
    <AttachmentScopeProvider
      installed
      prNumber={7}
      repoId="555"
      repoSlug={briefFixture.pr.repo}
    >
      <VideoAssetsScope value={NO_VIDEO_ASSETS}>
        <StubbedSummary brief={brief} />
      </VideoAssetsScope>
    </AttachmentScopeProvider>,
  );
}

function expectInDocumentOrder(elements: readonly HTMLElement[]): void {
  elements.slice(1).forEach((element, index) => {
    const before = elements[index];
    const position = before?.compareDocumentPosition(element) ?? 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
}

function readPointer(): HTMLElement {
  return screen.getByRole("button", { name: POINTER_NAME });
}

const BEFORE_AND_AFTER: SummaryMedia = {
  shown: [
    { key: BEFORE, position: SummaryMediaPositions.BEFORE_LEDE },
    { key: AFTER, position: SummaryMediaPositions.AFTER_LEDE },
  ],
  pointer: { label: "Before and after", items: [THIRD] },
};

describe("Summary", () => {
  afterEach(() => {
    cleanup();
    mermaid.render.mockReset();
  });

  it("never parses html in the summary", () => {
    const withHtml: Brief = {
      ...briefFixture,
      summary: 'Returns Result<T>. <img alt="Summary image" src="x.png" />',
    };
    render(<StubbedSummary brief={withHtml} />);

    expect(screen.queryByRole("img", { name: "Summary image" })).toBeNull();
    expect(screen.getByTestId("brief-summary").textContent).toContain(
      '<img alt="Summary image"',
    );
  });

  it("names a Delta summary above its lede and a full brief not at all", () => {
    renderSummary(makeBrief(LEDE, BEFORE_AND_AFTER));
    expect(screen.queryByText("Delta brief")).toBeNull();
    cleanup();

    renderSummary({
      ...makeBrief(LEDE, BEFORE_AND_AFTER),
      artifactKind: LocalBriefKinds.DELTA,
    });
    expect(screen.getByText("Delta brief")).toBeTruthy();
  });

  it("orders shown Media, lede, changelog, pointer line, then the strip", () => {
    renderSummary(makeBrief(WITH_CHANGELOG, BEFORE_AND_AFTER));

    expectInDocumentOrder([
      screen.getByRole("button", { name: "Enlarge Before" }),
      screen.getByText(LEDE),
      screen.getByRole("button", { name: "Enlarge After" }),
      screen.getByRole("heading", { name: "Changelog" }),
      readPointer(),
      screen.getByTestId("media-strip"),
    ]);
  });

  it("ends the summary with the after-lede items when it has no changelog", () => {
    renderSummary(makeBrief(LEDE, BEFORE_AND_AFTER));

    expectInDocumentOrder([
      screen.getByText(LEDE),
      screen.getByRole("button", { name: "Enlarge After" }),
      readPointer(),
      screen.getByTestId("media-strip"),
    ]);
  });

  it("sets two items of one position together in one row", () => {
    renderSummary(
      makeBrief(WITH_CHANGELOG, {
        shown: [
          { key: BEFORE, position: SummaryMediaPositions.AFTER_LEDE },
          { key: AFTER, position: SummaryMediaPositions.AFTER_LEDE },
        ],
      }),
    );

    const row = screen.getByTestId("summary-media-after-lede");
    expect(
      within(row).getAllByRole("button", { name: /^Enlarge/ }),
    ).toHaveLength(2);
    expect(screen.queryByTestId("summary-media-before-lede")).toBeNull();
  });

  it("swaps a shown image that fails for the failed row", () => {
    renderSummary(makeBrief(LEDE, BEFORE_AND_AFTER));

    const row = screen.getByTestId("summary-media-before-lede");
    fireEvent.error(within(row).getByRole("img", { name: "Before" }));

    const failed = within(row).getByTestId("media-failed-row");
    expect(failed.textContent).toContain("Before");
    expect(
      within(failed)
        .getByRole("link", { name: /open on github/i })
        .getAttribute("href"),
    ).toBe(ATTACHMENT_ASSET_URL);
  });

  it("drops stored keys the strip lacks and a pointer left empty", () => {
    renderSummary(
      makeBrief(LEDE, {
        shown: [{ key: STALE, position: SummaryMediaPositions.AFTER_LEDE }],
        pointer: { label: "Before and after", items: [STALE] },
      }),
    );

    expect(screen.queryByTestId("summary-media-after-lede")).toBeNull();
    expect(screen.queryByRole("button", { name: POINTER_NAME })).toBeNull();
    expect(screen.getByTestId("media-strip")).toBeTruthy();
  });

  it("opens the lightbox at the pointer set's first item", () => {
    renderSummary(
      makeBrief(LEDE, {
        shown: [],
        pointer: { label: "Before and after", items: [STALE, THIRD, AFTER] },
      }),
    );

    fireEvent.click(readPointer());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Third");
    expect(dialog.textContent).toContain("3 of 5");
  });

  it("opens the lightbox at a shown image", () => {
    renderSummary(makeBrief(LEDE, BEFORE_AND_AFTER));

    fireEvent.click(screen.getByRole("button", { name: "Enlarge After" }));

    expect(screen.getByRole("dialog").textContent).toContain("2 of 5");
  });

  it("renders the pointer label as text, never as markup", () => {
    const label = "<b>Before</b> **and** after";
    renderSummary(
      makeBrief(LEDE, { shown: [], pointer: { label, items: [THIRD] } }),
    );

    const pointer = screen.getByRole("button", {
      name: `${label}, in Media below`,
    });
    expect(pointer.querySelector("b, strong")).toBeNull();
  });

  it("plays a shown video with controls and only its metadata", () => {
    renderSummary(
      makeBrief(LEDE, {
        shown: [{ key: VIDEO, position: SummaryMediaPositions.AFTER_LEDE }],
      }),
    );

    const row = screen.getByTestId("summary-media-after-lede");
    const video = row.querySelector("video");
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("autoplay")).toBe(false);
  });

  it("draws a shown diagram in place", () => {
    renderSummary(
      makeBrief(LEDE, {
        shown: [{ key: DIAGRAM, position: SummaryMediaPositions.BEFORE_LEDE }],
      }),
    );

    const row = screen.getByTestId("summary-media-before-lede");
    expect(within(row).getByTestId("mermaid-diagram")).toBeTruthy();
  });

  it("caps a tall shown diagram and opens it in the lightbox", async () => {
    const code = "sequenceDiagram\n  C->>D: tall\n";
    mermaid.render.mockResolvedValue({
      svg: buildSandboxFrameMarkup(buildDiagramSvg("0 0 900 2400")),
    });
    renderSummary(
      makeBrief(
        LEDE,
        {
          shown: [
            {
              key: buildMermaidMediaKey(code),
              position: SummaryMediaPositions.BEFORE_LEDE,
            },
          ],
        },
        `\`\`\`mermaid\n${code}\`\`\``,
      ),
    );

    const row = screen.getByTestId("summary-media-before-lede");
    const opener = await within(row).findByRole("button", {
      name: "Open diagram: Sequence diagram",
    });
    expect(row.querySelector("iframe")?.style.maxInlineSize).toBe("120px");
    expect(within(row).getByText("Show source")).toBeTruthy();

    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe(
      "Sequence diagram",
    );
  });

  it("names a caption-less shown image by its kind, never its id", () => {
    renderSummary(
      makeBrief(
        LEDE,
        {
          shown: [{ key: BEFORE, position: SummaryMediaPositions.AFTER_LEDE }],
        },
        `![](${ATTACHMENT_ASSET_URL})`,
      ),
    );

    const row = screen.getByTestId("summary-media-after-lede");
    expect(
      within(row).getByRole("button", { name: "Enlarge image" }),
    ).toBeTruthy();
    expect(row.textContent).not.toContain(ATTACHMENT_ASSET_ID);
  });

  it("leaves the Delta summary without Summary Media", () => {
    const delta: Brief = {
      ...makeBrief(WITH_CHANGELOG, BEFORE_AND_AFTER),
      artifactKind: LocalBriefKinds.DELTA,
    };
    renderSummary(delta);

    expect(screen.queryByTestId("summary-media-before-lede")).toBeNull();
    expect(screen.queryByTestId("summary-media-after-lede")).toBeNull();
    expect(screen.queryByRole("button", { name: POINTER_NAME })).toBeNull();
    expect(screen.getByRole("heading", { name: "Changelog" })).toBeTruthy();
  });
});
