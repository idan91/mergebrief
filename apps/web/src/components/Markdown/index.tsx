import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  MARKDOWN_COMPONENTS,
  MENTION_AWARE_COMPONENTS,
  NO_DISALLOWED_ELEMENTS,
  PROSE_DISALLOWED_ELEMENTS,
} from "./consts";
import { useMarkdownRehypePlugins } from "./useMarkdownRehypePlugins";
import { SuggestionCard } from "./SuggestionCard";
import {
  buildSuggestionAdditionRows,
  parseSuggestionBlocks,
  stripSuggestionBlocks,
} from "./utils";
import styles from "./Markdown.module.scss";

export interface MarkdownProps {
  content: string;
  /** The file any suggestion block belongs to; its language follows it. */
  filePath?: string | undefined;
  /**
   * Render ```suggestion fences as Suggested-change cards. Addition rows
   * only: the fence holds just the replacement text; the old side needs the
   * diff context an anchored consumer supplies via MarkdownPreview.
   */
  renderSuggestions?: boolean;
  /**
   * Parse raw HTML as GitHub renders it, so a pasted screenshot's `<img>`
   * shows. For text written on GitHub; the brief's own prose keeps `<T>`
   * and renders no image at all.
   */
  renderHtml?: boolean;
  /** Mark `@login` and `@org/slug`: for text people wrote, never the brief's own prose. */
  renderMentions?: boolean;
}

/** Generic GFM markdown renderer used across briefs, descriptions, and comments. */
export function Markdown({
  content,
  filePath,
  renderSuggestions = false,
  renderHtml = false,
  renderMentions = false,
}: MarkdownProps) {
  const rehypePlugins = useMarkdownRehypePlugins(renderHtml, renderMentions);
  const components = renderMentions
    ? MENTION_AWARE_COMPONENTS
    : MARKDOWN_COMPONENTS;
  const suggestions = renderSuggestions ? parseSuggestionBlocks(content) : [];
  const markdown =
    suggestions.length > 0 ? stripSuggestionBlocks(content) : content;
  const disallowedElements = renderHtml
    ? NO_DISALLOWED_ELEMENTS
    : PROSE_DISALLOWED_ELEMENTS;
  return (
    // dir="auto": RTL-first content right-aligns, matching the composer.
    <div className={styles["markdown"]} dir="auto">
      <ReactMarkdown
        components={components}
        disallowedElements={disallowedElements}
        rehypePlugins={rehypePlugins}
        remarkPlugins={[remarkGfm]}
      >
        {markdown}
      </ReactMarkdown>
      {suggestions.map((suggestion) => (
        <SuggestionCard
          filePath={filePath}
          key={suggestion.index}
          rows={buildSuggestionAdditionRows(suggestion.body)}
        />
      ))}
    </div>
  );
}
