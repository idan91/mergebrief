import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import { MentionAwareSpan } from "./MentionAwareSpan";

/**
 * A "#" in a comment renders as an h3 and a "##" as an h4, so a comment can
 * never add a second h1 to a screen that already has one.
 */
export const DEMOTED_HEADING_COMPONENTS = { h1: "h3", h2: "h4" } as const;

/** The headings demoted, plus the span a mention renders through. */
export const MENTION_AWARE_COMPONENTS = {
  ...DEMOTED_HEADING_COMPONENTS,
  span: MentionAwareSpan,
} as const;

const MARKDOWN_TAG_NAMES = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "strong",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const FOCUS_STEERING_ATTRIBUTES = new Set(["accessKey", "tabIndex"]);

const GLOBAL_ATTRIBUTES = (defaultSchema.attributes?.["*"] ?? []).filter(
  (attribute) =>
    typeof attribute !== "string" || !FOCUS_STEERING_ATTRIBUTES.has(attribute),
);

/**
 * GitHub's editor writes a pasted screenshot as a raw `<img>` tag, so raw HTML
 * is parsed; only the elements markdown itself produces survive, plus `img`
 * with no scheme other than https. Every other tag is unwrapped and its text
 * kept; `script` is stripped whole.
 */
export const MARKDOWN_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...MARKDOWN_TAG_NAMES],
  attributes: {
    ...defaultSchema.attributes,
    "*": GLOBAL_ATTRIBUTES,
    img: ["src", "alt", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["https"],
  },
};
