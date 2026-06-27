import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  buildSuggestionDiffRows,
  parseSuggestionBlocks,
  stripSuggestionBlocks,
  type CommentAnchor,
} from "../../comments";

export interface MarkdownPreviewProps {
  anchor: CommentAnchor;
  body: string;
}

export function MarkdownPreview({ anchor, body }: MarkdownPreviewProps) {
  const suggestions = parseSuggestionBlocks(body);
  const markdown = stripSuggestionBlocks(body);
  return (
    <div className="comment-preview">
      {markdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : (
        <p className="preview-empty">Nothing to preview.</p>
      )}
      {suggestions.map((suggestion) => (
        <div className="suggestion-card" key={suggestion.index}>
          <div className="suggestion-title">Suggested change</div>
          <table
            className="diff suggestion-diff"
            aria-label="Suggested change diff"
          >
            <colgroup>
              <col className="suggestion-line-col" />
              <col className="suggestion-line-col" />
              <col />
            </colgroup>
            <tbody>
              {buildSuggestionDiffRows(anchor, suggestion.body).map(
                (row, index) => (
                  <tr className={row.kind} key={`${row.kind}-${index}`}>
                    <td className="ln">{row.oldLine ?? ""}</td>
                    <td className="ln">{row.newLine ?? ""}</td>
                    <td className="code">
                      <span className="sign">
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
