// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@web/components/Markdown";
import { MermaidDiagram } from ".";
import { buildDiagramSvg, buildSandboxFrameMarkup } from "./test-utils";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

afterEach(() => {
  cleanup();
  mermaid.render.mockReset();
});

function stubDrawnSvg(svgContent: string, viewBox = "0 0 400 200"): void {
  const frame = buildSandboxFrameMarkup(buildDiagramSvg(viewBox, svgContent));
  mermaid.render.mockResolvedValue({ svg: frame });
}

async function readFrame(title: string): Promise<HTMLIFrameElement> {
  const frame = await screen.findByTitle(title);
  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error(`${title} is not a frame`);
  }
  return frame;
}

describe("MermaidDiagram in text people wrote", () => {
  it("draws a mermaid fence in a frame with every sandbox flag off", async () => {
    stubDrawnSvg("<text>Alice</text>");

    render(
      <Markdown
        content={"Flow:\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```"}
        renderHtml
      />,
    );

    const frame = await readFrame("Sequence diagram");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("<text>Alice</text>");
    expect(frame.outerHTML).not.toContain("allow-");
    expect(frame.style.maxInlineSize).toBe("400px");
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^mergebrief-diagram-\d+$/),
      "sequenceDiagram\n  A->>B: hi\n",
      expect.any(HTMLElement),
    );
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "sandbox" }),
    );
  });

  it("keeps the source one disclosure away", async () => {
    stubDrawnSvg("<text>B</text>");

    render(<Markdown content={'```mermaid\npie\n  "a": 1\n```'} renderHtml />);

    await readFrame("Pie chart");
    const summary = screen.getByText("Show source");
    expect(summary.closest("details")?.textContent).toContain('"a": 1');
  });

  it("holds the frame in a focusable region a keyboard can scroll", async () => {
    stubDrawnSvg("<text>Flow</text>");

    render(<MermaidDiagram code={"flowchart LR\n  A --> B\n"} />);

    const frame = await readFrame("Flowchart");
    const region = screen.getByRole("region", { name: "Flowchart" });
    expect(region.contains(frame)).toBe(true);
    expect(region.tabIndex).toBe(0);
  });

  it("shows the source and no frame while Mermaid loads", () => {
    mermaid.render.mockReturnValue(new Promise(() => undefined));

    render(<MermaidDiagram code={"gantt\n  title Plan\n"} />);

    expect(screen.queryByTitle("Gantt chart")).toBeNull();
    expect(screen.getByTestId("mermaid-diagram").dataset["state"]).toBe(
      "pending",
    );
    expect(screen.getByText("Show source")).toBeTruthy();
  });

  it("keeps the code block under a note when Mermaid cannot draw it", async () => {
    mermaid.render.mockRejectedValue(new Error("Parse error on line 2"));

    render(
      <Markdown
        content={"```mermaid\nflowchart LR\n  A -->\n```"}
        renderHtml
      />,
    );

    const note = await screen.findByText("Diagram could not render");
    const block = note.parentElement?.querySelector("pre code");
    expect(block?.textContent).toBe("flowchart LR\n  A -->\n");
    expect(screen.queryByText("Show source")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("keeps author html in a label out of this page", async () => {
    const label =
      '<foreignObject><div><img src="https://cdn.test/x.png" onerror="window.__drawn=1"><script>window.__drawn=2</script></div></foreignObject>';
    stubDrawnSvg(label);

    render(
      <Markdown
        content={
          '```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"]\n```'
        }
        renderHtml
      />,
    );

    const frame = await readFrame("Flowchart");
    expect(frame.getAttribute("srcdoc")).toContain("onerror");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("foreignObject, foreignobject")).toBeNull();
    expect(Reflect.get(window, "__drawn")).toBeUndefined();
  });

  it("removes what Mermaid left on the page when a render throws", async () => {
    mermaid.render.mockImplementation(
      (renderId: string, _code: string, container?: Element) => {
        const sandbox = document.createElement("iframe");
        sandbox.id = `i${renderId}`;
        const measuring = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        (container ?? document.body).append(sandbox);
        document.body.append(measuring);
        return Promise.reject(new Error("draw failed"));
      },
    );

    render(<MermaidDiagram code={"classDiagram\n  class Foo\n"} />);

    await screen.findByText("Diagram could not render");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.body.querySelector(":scope > svg")).toBeNull();
  });

  it("draws in a hidden container, never in the page's visible flow", async () => {
    const frame = buildSandboxFrameMarkup(buildDiagramSvg("0 0 400 200"));
    const hosts: (string | undefined)[] = [];
    mermaid.render.mockImplementation(
      async (renderId: string, _code: string, container?: Element) => {
        const sandbox = document.createElement("iframe");
        sandbox.id = `i${renderId}`;
        (container ?? document.body).append(sandbox);
        const host = sandbox.parentElement;
        const hidden =
          host instanceof HTMLElement &&
          host !== document.body &&
          host.style.visibility === "hidden" &&
          host.style.position === "fixed";
        hosts.push(hidden ? "hidden" : host?.localName);
        sandbox.remove();
        return { svg: frame };
      },
    );

    render(<MermaidDiagram code={"pie\n  title Pets\n"} />);

    await readFrame("Pie chart");
    expect(hosts).toEqual(["hidden"]);
  });

  it("draws no diagram in the brief's own prose", () => {
    render(<Markdown content={"```mermaid\nstateDiagram\n```"} />);

    expect(screen.queryByTestId("mermaid-diagram")).toBeNull();
    expect(document.querySelector("pre code")?.textContent).toBe(
      "stateDiagram\n",
    );
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
