import { Mention } from "../Mention";
import { findSourceMentions, splitMentionText } from "../mentions";

export interface MentionTextProps {
  /** Markdown source a person wrote, shown as written rather than rendered. */
  text: string;
}

/** Unrendered markdown with its mentions marked where the renderer would mark them. */
export function MentionText({ text }: MentionTextProps) {
  const parts = splitMentionText(text, findSourceMentions(text));
  const marked = parts.map((part) =>
    part.mention === undefined ? (
      part.text
    ) : (
      <Mention
        key={part.mention.start}
        kind={part.mention.kind}
        target={part.mention.target}
      >
        {part.text}
      </Mention>
    ),
  );
  return marked;
}
