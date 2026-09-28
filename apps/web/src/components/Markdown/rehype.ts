import type { Options as MarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

import { MARKDOWN_SANITIZE_SCHEMA } from "./consts";
import type { AttachmentScope } from "./context";
import { rehypeNormalizeImages, rehypeProxyAttachmentSources } from "./images";
import { rehypePrefixFragmentLinks } from "./links";

export type MarkdownRehypePlugins = NonNullable<
  MarkdownOptions["rehypePlugins"]
>;

export interface RehypePluginOptions {
  readonly renderHtml: boolean;
  /** The pull request the body belongs to; absent, attachments stay on GitHub. */
  readonly scope?: AttachmentScope | undefined;
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
    [rehypeProxyAttachmentSources, options.scope],
  ];
}
