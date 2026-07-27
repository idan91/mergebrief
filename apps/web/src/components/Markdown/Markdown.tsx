import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Markdown.module.scss";

export interface MarkdownProps {
  content: string;
}

/** Generic GFM markdown renderer used across briefs, descriptions, and comments. */
export function Markdown({ content }: MarkdownProps) {
  return (
    <div className={styles["markdown"]}>
      {/* Model/user-authored markdown must not inject page-level headings
          into the document outline (every page owns its single h1): h1/h2
          demote to h3/h4 — exactly the levels this component's stylesheet
          designs for. */}
      <ReactMarkdown
        components={{ h1: "h3", h2: "h4" }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
