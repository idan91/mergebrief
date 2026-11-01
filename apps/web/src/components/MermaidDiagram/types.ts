import type { ValueOf } from "types/utils";

/** The SVG Mermaid drew, with the size its viewBox gives it. */
export interface DiagramSvg {
  readonly markup: string;
  readonly width: number;
  readonly height: number;
}

/** A diagram ready for its frame: the page the frame shows, sized from the SVG's viewBox. */
export interface RenderedDiagram {
  readonly srcDoc: string;
  readonly width: number;
  readonly height: number;
  /** The smallest scale its text stays readable at; absent, any scale is. */
  readonly readableScale?: number;
}

export const DiagramFailureKinds = {
  /** Mermaid could not draw the author's code. */
  UNREADABLE: "unreadable",
  /** The diagram library did not load. */
  UNAVAILABLE: "unavailable",
} as const;
export type DiagramFailureKind = ValueOf<typeof DiagramFailureKinds>;

export const DiagramRenderStatuses = {
  PENDING: "pending",
  RENDERED: "rendered",
  FAILED: "failed",
} as const;

interface PendingDiagramRender {
  readonly status: typeof DiagramRenderStatuses.PENDING;
}

interface RenderedDiagramRender {
  readonly status: typeof DiagramRenderStatuses.RENDERED;
  readonly diagram: RenderedDiagram;
}

interface FailedDiagramRender {
  readonly status: typeof DiagramRenderStatuses.FAILED;
}

export type DiagramRender =
  | PendingDiagramRender
  | RenderedDiagramRender
  | FailedDiagramRender;

/** A design token's custom property name, as `getPropertyValue` reads it. */
export type DesignToken = `--${string}`;
