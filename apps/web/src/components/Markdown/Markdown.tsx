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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
