import { createContext, useContext, useMemo, type ReactNode } from "react";

/** The pull request a rendered body belongs to; the attachment proxy is keyed by it. */
export interface AttachmentScope {
  readonly repoId: string;
  readonly prNumber: number;
  /** The App is installed on the repo, so an upload has a token to push with. */
  readonly installed: boolean;
}

export interface AttachmentScopeProviderProps {
  repoId: string;
  prNumber: number;
  installed: boolean;
  children: ReactNode;
}

const AttachmentScopeContext = createContext<AttachmentScope | undefined>(
  undefined,
);

/** Mounted once by the pull-request route; outside it, sources stay on GitHub. */
export function AttachmentScopeProvider({
  repoId,
  prNumber,
  installed,
  children,
}: AttachmentScopeProviderProps) {
  // Memo'd so memo'd subtrees keep their value identity across route renders.
  const scope = useMemo(
    () => ({ repoId, prNumber, installed }),
    [repoId, prNumber, installed],
  );
  return (
    <AttachmentScopeContext.Provider value={scope}>
      {children}
    </AttachmentScopeContext.Provider>
  );
}

export function useAttachmentScope(): AttachmentScope | undefined {
  return useContext(AttachmentScopeContext);
}
