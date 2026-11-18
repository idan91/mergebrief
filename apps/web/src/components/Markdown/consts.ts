import { DiagramAwarePre } from "./DiagramAwarePre";
import { InlineImage } from "./InlineImage";
import { InlineVideo } from "./InlineVideo";
import { MentionAwareSpan } from "./MentionAwareSpan";
import { PastedAssetAwareLink } from "./PastedAssetAwareLink";

/**
 * A "#" in a comment renders as an h3 and a "##" as an h4, so a comment can
 * never add a second h1 to a screen that already has one.
 */
export const DEMOTED_HEADING_COMPONENTS = { h1: "h3", h2: "h4" } as const;

export const MARKDOWN_COMPONENTS = {
  ...DEMOTED_HEADING_COMPONENTS,
  a: PastedAssetAwareLink,
  img: InlineImage,
  pre: DiagramAwarePre,
  video: InlineVideo,
} as const;

/** The renderer's components, plus the span a mention renders through. */
export const MENTION_AWARE_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  span: MentionAwareSpan,
} as const;

/**
 * The brief's own prose never renders an image: model output an injected PR
 * steered could point one at an outside URL, and the browser would fetch it,
 * secrets in the query string included, the moment the page opens.
 */
export const PROSE_DISALLOWED_ELEMENTS: readonly string[] = ["img"];

/** Text people wrote keeps every element the sanitize schema allows. */
export const NO_DISALLOWED_ELEMENTS: readonly string[] = [];
