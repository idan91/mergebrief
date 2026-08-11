import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SuggestionCard } from "@web/components/Markdown/SuggestionCard/SuggestionCard";
import {
  parseSuggestionBlocks,
  stripSuggestionBlocks,
} from "@web/components/Markdown/utils";
import {
  buildSuggestionDiffRows,
  type CommentAnchor,
} from "../../utils/comments";
import styles from "./MarkdownPreview.module.scss";

export interface MarkdownPreviewProps {
  anchor: CommentAnchor;
  body: string;
}

/**
 * The ANCHORED preview: drafts know the diff lines they sit on, so the
 * shared SuggestionCard gets full del+add rows with line numbers — the
 * anchor-less path (pulled comments) lives in the shared Markdown renderer.
 */
export function MarkdownPreview({ anchor, body }: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const suggestions = parseSuggestionBlocks(body);
  const markdown = stripSuggestionBlocks(body);
  return (
    // dir="auto": RTL-first content right-aligns, matching the composer.
    <div className={styles["preview"]} dir="auto">
      {markdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : (
        <p className={styles["empty"]}>{t("review.comment.previewEmpty")}</p>
      )}
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.index}
          rows={buildSuggestionDiffRows(anchor, suggestion.body)}
        />
      ))}
    </div>
  );
}
