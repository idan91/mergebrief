import { SANITIZE_REHYPE_PLUGINS } from "brief-core/sanitized-markdown";
import type { Options as MarkdownOptions } from "react-markdown";

import type { AttachmentScope } from "./context";
import {
  rehypeNormalizeImages,
  rehypeProxyAttachmentSources,
  rehypeRecordOriginalSources,
} from "./images";
import { rehypePrefixFragmentLinks } from "./links";
import { rehypeMarkMentions } from "./mentions";

export type MarkdownRehypePlugins = NonNullable<
  MarkdownOptions["rehypePlugins"]
>;

export interface RehypePluginOptions {
  readonly renderHtml: boolean;
  /** Mark `@login` and `@org/slug` in text people wrote. */
  readonly renderMentions: boolean;
  /** The pull request the body belongs to; absent, attachments stay on GitHub. */
  readonly scope?: AttachmentScope | undefined;
}

const NO_PLUGINS: MarkdownRehypePlugins = [];

/** Order is the contract: every later step only sees what sanitize kept. */
export function buildRehypePlugins(
  options: RehypePluginOptions,
): MarkdownRehypePlugins {
  const mentions: MarkdownRehypePlugins = options.renderMentions
    ? [rehypeMarkMentions]
    : NO_PLUGINS;
  if (!options.renderHtml) {
    return mentions;
  }
  return [
    ...SANITIZE_REHYPE_PLUGINS,
    rehypeNormalizeImages,
    rehypePrefixFragmentLinks,
    rehypeRecordOriginalSources,
    [rehypeProxyAttachmentSources, options.scope],
    ...mentions,
  ];
}
