import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SuggestionCard } from "./SuggestionCard/SuggestionCard";
import {
  buildSuggestionAdditionRows,
  parseSuggestionBlocks,
  stripSuggestionBlocks,
} from "./utils";
import styles from "./Markdown.module.scss";

export interface MarkdownProps {
  content: string;
  /**
   * Render ```suggestion fences as Suggested-change cards. Addition rows
   * only: the fence holds just the replacement text; the old side needs the
   * diff context an anchored consumer supplies via MarkdownPreview.
   */
  renderSuggestions?: boolean;
}

/** Generic GFM markdown renderer used across briefs, descriptions, and comments. */
export function Markdown({
  content,
  renderSuggestions = false,
}: MarkdownProps) {
  const suggestions = renderSuggestions ? parseSuggestionBlocks(content) : [];
  const markdown =
    suggestions.length > 0 ? stripSuggestionBlocks(content) : content;
  return (
    // dir="auto": RTL-first content right-aligns, matching the composer.
    <div className={styles["markdown"]} dir="auto">
      {/* Authored markdown must not inject page-level headings into the
          document outline (every page owns its single h1), so h1/h2 demote
          to h3/h4. */}
      <ReactMarkdown
        components={{ h1: "h3", h2: "h4" }}
        remarkPlugins={[remarkGfm]}
      >
        {markdown}
      </ReactMarkdown>
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.index}
          rows={buildSuggestionAdditionRows(suggestion.body)}
        />
      ))}
    </div>
  );
}
