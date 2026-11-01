import type { Mermaid } from "mermaid";
import type { Mutable, Result } from "types/utils";

import {
  DIAGRAM_DRAW_CONTAINER_ID,
  DIAGRAM_DRAW_CONTAINER_STYLE,
  DIAGRAM_RENDER_ID_PREFIX,
  MERMAID_ENCLOSING_ID_PREFIX,
  MERMAID_LAYOUT_CONTAINER_ID,
  MERMAID_SANDBOX_FRAME_ID_PREFIX,
  MERMAID_TOOLTIP_CLASS,
} from "./consts";
import { buildMermaidConfig, readReadableScale } from "./theme";
import {
  DiagramFailureKinds,
  type DiagramFailureKind,
  type RenderedDiagram,
} from "./types";
import { buildDiagramDocument } from "./frame-document";
import { readSandboxedSvg } from "./utils";

export type DiagramRenderResult = Result<RenderedDiagram, DiagramFailureKind>;

const UNREADABLE: DiagramRenderResult = {
  ok: false,
  error: DiagramFailureKinds.UNREADABLE,
};
const UNAVAILABLE: DiagramRenderResult = {
  ok: false,
  error: DiagramFailureKinds.UNAVAILABLE,
};

/** Mermaid set up for this page, and the scale its diagrams stay readable at. */
interface DiagramRenderer {
  readonly mermaid: Mermaid;
  readonly readableScale: number | undefined;
}

let rendererLoad: Promise<DiagramRenderer> | undefined;
let renderCount = 0;
const diagramRenders = new Map<string, Promise<DiagramRenderResult>>();

async function importMermaid(): Promise<DiagramRenderer> {
  const { default: mermaid } = await import("mermaid");
  const root = document.documentElement;
  mermaid.initialize(buildMermaidConfig(root));
  return { mermaid, readableScale: readReadableScale(root) };
}

/** One load per page; a failed load is forgotten so the next diagram tries again. */
function loadMermaid(): Promise<DiagramRenderer> {
  rendererLoad ??= importMermaid().catch((error: unknown) => {
    rendererLoad = undefined;
    throw error;
  });
  return rendererLoad;
}

/** What Mermaid appends to the page body while it draws: its sandbox frame, measuring SVGs, layout box, tooltip. */
function isRenderLeftover(element: Element, renderId: string): boolean {
  const leftoverIds = [
    renderId,
    `${MERMAID_SANDBOX_FRAME_ID_PREFIX}${renderId}`,
    `${MERMAID_ENCLOSING_ID_PREFIX}${renderId}`,
    MERMAID_LAYOUT_CONTAINER_ID,
  ];
  if (leftoverIds.includes(element.id)) {
    return true;
  }
  if (element.classList.contains(MERMAID_TOOLTIP_CLASS)) {
    return true;
  }
  const isBareSvg =
    element.localName === "svg" && element.attributes.length === 0;
  return isBareSvg;
}

/** One hidden container per page, made on the first draw. */
function readDrawContainer(): HTMLElement {
  const existing = document.getElementById(DIAGRAM_DRAW_CONTAINER_ID);
  if (existing !== null) {
    return existing;
  }
  const container = document.createElement("div");
  container.id = DIAGRAM_DRAW_CONTAINER_ID;
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, DIAGRAM_DRAW_CONTAINER_STYLE);
  document.body.append(container);
  return container;
}

/** Mermaid removes these itself when a render ends cleanly; a throw part-way can leave them. */
function removeRenderLeftovers(
  renderId: string,
  bodyBefore: ReadonlySet<Element>,
  container: Element,
): void {
  const children = [...document.body.children, ...container.children];
  for (const child of children) {
    const isNewLeftover =
      !bodyBefore.has(child) && isRenderLeftover(child, renderId);
    if (isNewLeftover) {
      child.remove();
    }
  }
}

async function drawDiagram(
  { mermaid, readableScale }: DiagramRenderer,
  code: string,
): Promise<DiagramRenderResult> {
  renderCount += 1;
  const renderId = `${DIAGRAM_RENDER_ID_PREFIX}${renderCount}`;
  const container = readDrawContainer();
  const bodyBefore = new Set(Array.from(document.body.children));

  try {
    const { svg: frameMarkup } = await mermaid.render(
      renderId,
      code,
      container,
    );
    const svg = readSandboxedSvg(frameMarkup);
    if (svg === undefined) {
      return UNREADABLE;
    }

    const diagram: Mutable<RenderedDiagram> = {
      srcDoc: buildDiagramDocument(svg.markup),
      width: svg.width,
      height: svg.height,
    };
    if (readableScale !== undefined) {
      diagram.readableScale = readableScale;
    }

    return { ok: true, value: diagram };
  } catch {
    return UNREADABLE;
  } finally {
    removeRenderLeftovers(renderId, bodyBefore, container);
  }
}

async function loadAndDrawDiagram(code: string): Promise<DiagramRenderResult> {
  let renderer: DiagramRenderer;
  try {
    renderer = await loadMermaid();
  } catch (error: unknown) {
    console.error("The diagram library did not load", error);
    return UNAVAILABLE;
  }
  return drawDiagram(renderer, code);
}

/**
 * Draws `code` with Mermaid in its sandbox mode, loading Mermaid on the
 * first call, and hands back the page our own sandboxed frame shows.
 * One render per code; a load that failed is tried again next time.
 */
export function drawMermaidDiagram(code: string): Promise<DiagramRenderResult> {
  const cached = diagramRenders.get(code);
  if (cached !== undefined) {
    return cached;
  }

  const render = loadAndDrawDiagram(code).then((result) => {
    if (!result.ok && result.error === DiagramFailureKinds.UNAVAILABLE) {
      diagramRenders.delete(code);
    }
    return result;
  });
  diagramRenders.set(code, render);
  return render;
}
