import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Generic GFM markdown renderer used across briefs, descriptions, and comments. */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
