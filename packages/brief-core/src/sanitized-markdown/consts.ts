import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

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
  "video",
] as const;

const FOCUS_STEERING_ATTRIBUTES = new Set(["accessKey", "tabIndex"]);

const GLOBAL_ATTRIBUTES = (defaultSchema.attributes?.["*"] ?? []).filter(
  (attribute) =>
    typeof attribute !== "string" || !FOCUS_STEERING_ATTRIBUTES.has(attribute),
);

/**
 * GitHub's editor writes a pasted screenshot as a raw `<img>` tag, so raw HTML
 * is parsed; only the elements markdown itself produces survive, plus `img`
 * and `video` with no scheme other than https. A video keeps no attribute
 * that plays, loads or fetches on its own (`autoplay`, `poster`, `preload`)
 * and no `source` child, so its one address is `src`. Every other tag is
 * unwrapped and its text kept; `script` is stripped whole.
 */
export const MARKDOWN_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...MARKDOWN_TAG_NAMES],
  attributes: {
    ...defaultSchema.attributes,
    "*": GLOBAL_ATTRIBUTES,
    img: ["src", "alt", "width", "height"],
    video: ["src", "controls", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["https"],
  },
};

/** remark-rehype keeps raw HTML as `raw` nodes so rehype-raw can parse it. */
export const REMARK_REHYPE_OPTIONS = { allowDangerousHtml: true } as const;
