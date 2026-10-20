import { useAttachmentScope } from "./context";
import { buildRehypePlugins, type MarkdownRehypePlugins } from "./rehype";

/** The chain a renderer runs, with the mounted attachment scope folded in. */
export function useMarkdownRehypePlugins(
  renderHtml: boolean,
  renderMentions: boolean,
): MarkdownRehypePlugins {
  const scope = useAttachmentScope();
  return buildRehypePlugins({ renderHtml, renderMentions, scope });
}
