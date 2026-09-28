import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { DEMOTED_HEADING_COMPONENTS } from "./consts";
import { buildRehypePlugins } from "./rehype";
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
   * shows. For text written on GitHub; the brief's own prose keeps `<T>`.
   */
  renderHtml?: boolean;
}

/** Generic GFM markdown renderer used across briefs, descriptions, and comments. */
export function Markdown({
  content,
  filePath,
  renderSuggestions = false,
  renderHtml = false,
}: MarkdownProps) {
  const rehypePlugins = buildRehypePlugins({ renderHtml });
  const suggestions = renderSuggestions ? parseSuggestionBlocks(content) : [];
  const markdown =
    suggestions.length > 0 ? stripSuggestionBlocks(content) : content;
  return (
    // dir="auto": RTL-first content right-aligns, matching the composer.
    <div className={styles["markdown"]} dir="auto">
      <ReactMarkdown
        components={DEMOTED_HEADING_COMPONENTS}
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
