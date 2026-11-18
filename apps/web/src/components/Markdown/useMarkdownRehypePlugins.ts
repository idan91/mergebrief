import { useAttachmentScope, useVideoAssets } from "./context";
import { buildRehypePlugins, type MarkdownRehypePlugins } from "./rehype";

/** The chain a renderer runs, with the mounted attachment scope and confirmed videos folded in. */
export function useMarkdownRehypePlugins(
  renderHtml: boolean,
  renderMentions: boolean,
): MarkdownRehypePlugins {
  const scope = useAttachmentScope();
  const videoAssetIds = useVideoAssets()?.videoAssetIds;
  return buildRehypePlugins({
    renderHtml,
    renderMentions,
    scope,
    videoAssetIds,
  });
}
