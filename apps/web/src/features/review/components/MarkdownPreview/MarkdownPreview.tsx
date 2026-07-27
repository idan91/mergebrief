import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  buildSuggestionDiffRows,
  parseSuggestionBlocks,
  stripSuggestionBlocks,
  type CommentAnchor,
} from "../../utils/comments";
import styles from "./MarkdownPreview.module.scss";

export interface MarkdownPreviewProps {
  anchor: CommentAnchor;
  body: string;
}

export function MarkdownPreview({ anchor, body }: MarkdownPreviewProps) {
  const suggestions = parseSuggestionBlocks(body);
  const markdown = stripSuggestionBlocks(body);
  return (
    <div className={styles["preview"]}>
      {markdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : (
        <p className={styles["empty"]}>Nothing to preview.</p>
      )}
      {suggestions.map((suggestion) => (
        <div className={styles["suggestionCard"]} key={suggestion.index}>
          <div className={styles["suggestionTitle"]}>Suggested change</div>
          <table
            className={styles["suggestionDiff"]}
            aria-label="Suggested change diff"
          >
            <colgroup>
              <col className={styles["lineCol"]} />
              <col className={styles["lineCol"]} />
              <col />
            </colgroup>
            <tbody>
              {buildSuggestionDiffRows(anchor, suggestion.body).map(
                (row, index) => (
                  <tr
                    className={styles["line"]}
                    data-line-kind={row.kind}
                    key={`${row.kind}-${index}`}
                  >
                    <td className={styles["lineNumber"]}>
                      {row.oldLine ?? ""}
                    </td>
                    <td className={styles["lineNumber"]}>
                      {row.newLine ?? ""}
                    </td>
                    <td className={styles["code"]}>
                      <span className={styles["sign"]}>
                        {row.kind === "add" ? "+" : "−"}
                      </span>
                      {row.content}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <button disabled type="button">
            Apply suggestion unavailable in mockup
          </button>
        </div>
      ))}
    </div>
  );
}
