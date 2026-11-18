import { useMemo, type ReactNode } from "react";

import { MentionTargetsScope } from "@web/components/Markdown/context";
import { useMentionTargetLookup } from "./useMentionTargetLookup";

export interface MentionTargetsProviderProps {
  repoId: string;
  /** The signed-in viewer, whose own mentions are highlighted. */
  viewerLogin?: string | undefined;
  children: ReactNode;
}

/** Resolves the mentions rendered under it against GitHub, batched per page. */
export function MentionTargetsProvider({
  repoId,
  viewerLogin,
  children,
}: MentionTargetsProviderProps) {
  const lookup = useMentionTargetLookup(repoId);
  const value = useMemo(
    () => ({ ...lookup, viewerLogin }),
    [lookup, viewerLogin],
  );
  return <MentionTargetsScope value={value}>{children}</MentionTargetsScope>;
}
