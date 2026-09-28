import type { Options as MarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

import { MARKDOWN_SANITIZE_SCHEMA } from "./consts";
import { rehypeNormalizeImages } from "./images";
import { rehypePrefixFragmentLinks } from "./links";

export type MarkdownRehypePlugins = NonNullable<
  MarkdownOptions["rehypePlugins"]
>;

export interface RehypePluginOptions {
  readonly renderHtml: boolean;
}

const NO_PLUGINS: MarkdownRehypePlugins = [];

/** Order is the contract: every later step only sees what sanitize kept. */
export function buildRehypePlugins(
  options: RehypePluginOptions,
): MarkdownRehypePlugins {
  if (!options.renderHtml) {
    return NO_PLUGINS;
  }
  return [
    rehypeRaw,
    [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
    rehypeNormalizeImages,
    rehypePrefixFragmentLinks,
  ];
}
