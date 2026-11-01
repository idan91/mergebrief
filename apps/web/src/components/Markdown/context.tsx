import { createContext, useContext, useMemo, type ReactNode } from "react";

/** The pull request a rendered body belongs to; the attachment proxy is keyed by it. */
export interface AttachmentScope {
  readonly repoId: string;
  readonly prNumber: number;
  /** The App is installed on the repo, so an upload has a token to push with. */
  readonly installed: boolean;
  /** `owner/name`; absent, no committed file is proxied, since none can be told to be the repo's own. */
  readonly repoSlug?: string | undefined;
}

export interface AttachmentScopeProviderProps {
  repoId: string;
  prNumber: number;
  installed: boolean;
  repoSlug?: string | undefined;
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
  repoSlug,
  children,
}: AttachmentScopeProviderProps) {
  // Memo'd so memo'd subtrees keep their value identity across route renders.
  const scope = useMemo(
    () => ({ repoId, prNumber, installed, repoSlug }),
    [repoId, prNumber, installed, repoSlug],
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

/** What a rendered mention needs to resolve itself against GitHub. */
export interface MentionTargets {
  /** The signed-in viewer; absent until the session names them. */
  readonly viewerLogin?: string | undefined;
  /** GitHub showed the viewer this `login` or `org/slug`, matched without case. */
  readonly isTargetShown: (target: string) => boolean;
  /** Asks GitHub about a target not yet known; a known one is a no-op. */
  readonly requestTarget: (target: string) => void;
}

export interface MentionTargetsScopeProps {
  value: MentionTargets;
  children: ReactNode;
}

const MentionTargetsContext = createContext<MentionTargets | undefined>(
  undefined,
);

/** Fed by the feature that knows the repo; outside it, every mention stays plain text. */
export function MentionTargetsScope({
  value,
  children,
}: MentionTargetsScopeProps) {
  return (
    <MentionTargetsContext.Provider value={value}>
      {children}
    </MentionTargetsContext.Provider>
  );
}

export function useMentionTargets(): MentionTargets | undefined {
  return useContext(MentionTargetsContext);
}
