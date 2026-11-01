// The one Markdown pipeline people's text goes through: GFM parse, HTML
// nodes, raw HTML parsed, then rehype-sanitize. The web renderer runs these
// plugins inside react-markdown; Media extraction runs them here. Runs in
// the browser and the worker.
import type { Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type PluggableList } from "unified";

import { MARKDOWN_SANITIZE_SCHEMA, REMARK_REHYPE_OPTIONS } from "./consts";

export { MARKDOWN_SANITIZE_SCHEMA, MEDIA_SANITIZE_SCHEMA } from "./consts";

/** GFM as people's text is written on GitHub. */
export const MARKDOWN_REMARK_PLUGINS: PluggableList = [remarkGfm];

/** Raw HTML parsed, then sanitized: every later step sees only what sanitize kept. */
export const SANITIZE_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
];

/** The sanitized HTML tree of `markdown`, under `schema` (the render schema by default). */
export function parseSanitizedMarkdown(
  markdown: string,
  schema: SanitizeSchema = MARKDOWN_SANITIZE_SCHEMA,
): Root {
  const processor = unified()
    .use(remarkParse)
    .use(MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, REMARK_REHYPE_OPTIONS)
    .use(rehypeRaw)
    .use(rehypeSanitize, schema);
  return processor.runSync(processor.parse(markdown));
}
