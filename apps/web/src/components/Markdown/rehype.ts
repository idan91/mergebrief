import { SANITIZE_REHYPE_PLUGINS } from "brief-core/sanitized-markdown";
import type { AttachmentAssetId } from "contract";
import type { Options as MarkdownOptions } from "react-markdown";

import type { AttachmentScope } from "./context";
import { rehypeMarkMermaidFences } from "./diagram-fences";
import { rehypePrefixFragmentLinks } from "./links";
import {
  rehypeLinkUnservedVideos,
  rehypeNormalizeMedia,
  rehypeProxyAttachmentSources,
  rehypeRecordOriginalSources,
} from "./media";
import { rehypeMarkMentions } from "./mentions";
import { rehypePlayPastedAssetLines } from "./pasted-asset-lines";

export type MarkdownRehypePlugins = NonNullable<
  MarkdownOptions["rehypePlugins"]
>;

export interface RehypePluginOptions {
  readonly renderHtml: boolean;
  /** Mark `@login` and `@org/slug` in text people wrote. */
  readonly renderMentions: boolean;
  /** The pull request the body belongs to; absent, attachments stay on GitHub. */
  readonly scope?: AttachmentScope | undefined;
  /** The pasted assets GitHub rendered as a video; absent until the page asked. */
  readonly videoAssetIds?: ReadonlySet<AttachmentAssetId> | undefined;
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
  const pastedAssetLines = {
    scope: options.scope,
    videoAssetIds: options.videoAssetIds,
  };
  return [
    ...SANITIZE_REHYPE_PLUGINS,
    rehypeNormalizeMedia,
    rehypePrefixFragmentLinks,
    rehypeMarkMermaidFences,
    [rehypePlayPastedAssetLines, pastedAssetLines],
    [rehypeLinkUnservedVideos, options.scope],
    rehypeRecordOriginalSources,
    [rehypeProxyAttachmentSources, options.scope],
    ...mentions,
  ];
}
