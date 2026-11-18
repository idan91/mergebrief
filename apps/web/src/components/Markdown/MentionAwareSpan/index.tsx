import type { ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { Mention } from "../Mention";
import { isMentionKind } from "../mentions";

export type MentionAwareSpanProps = ComponentProps<"span"> & ExtraProps;

/** The renderer's span: one the mention step marked becomes a Mention. */
export function MentionAwareSpan({ node, ...props }: MentionAwareSpanProps) {
  const target = node?.properties["dataMention"];
  const kind = node?.properties["dataMentionKind"];
  const isMarkedMention = typeof target === "string" && isMentionKind(kind);

  if (isMarkedMention) {
    return (
      <Mention kind={kind} target={target}>
        {props.children}
      </Mention>
    );
  }

  return <span {...props} />;
}
