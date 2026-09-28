// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_ID,
  ATTACHMENT_ASSET_URL,
  ATTACHMENT_BRANCH_URL,
  ATTACHMENT_FILE_NAME,
} from "@web/test/attachments";
import { Markdown } from ".";
import { AttachmentScopeProvider } from "./context";

afterEach(cleanup);

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

  it("keeps a markdown image as it was", () => {
    render(<Markdown content="![shot](https://example.com/a.png)" />);

    expect(screen.getByRole("img", { name: "shot" }).getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
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

  it("routes a branch-hosted file through the proxy by its file name", () => {
    render(
      <AttachmentScopeProvider installed prNumber={7} repoId="555">
        <Markdown content={`![shot](${ATTACHMENT_BRANCH_URL})`} renderHtml />
      </AttachmentScopeProvider>,
    );

    expect(screen.getByRole("img", { name: "shot" }).getAttribute("src")).toBe(
      `/api/repos/555/pulls/7/attachments/${ATTACHMENT_FILE_NAME}`,
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
  it("keeps a type parameter that looks like a tag", () => {
    render(<Markdown content="Returns Result<T> and Promise<void>." />);

    expect(
      screen.getByText("Returns Result<T> and Promise<void>."),
    ).toBeTruthy();
  });

  it("shows a raw tag as text without the opt-in", () => {
    render(
      <Markdown
        content={`<img alt="Image" src="${ATTACHMENT_ASSET_URL}" />`}
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/<img alt="Image"/)).toBeTruthy();
  });
});
