import type { MediaKey } from "brief-core/media";
import type { AttachmentAssetId } from "contract";
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

/** Which pasted assets GitHub rendered as a video, read only once a bare asset line asks. */
export interface VideoAssets {
  /** The asset ids GitHub plays as a video; absent until the read answers. */
  readonly videoAssetIds?: ReadonlySet<AttachmentAssetId> | undefined;
  /** A bare asset line asks with its id; the read starts on the first ask. */
  readonly requestVideoAssets: (assetId: AttachmentAssetId) => void;
}

export interface VideoAssetsScopeProps {
  value: VideoAssets;
  children: ReactNode;
}

const VideoAssetsContext = createContext<VideoAssets | undefined>(undefined);

/** Fed by the feature that knows the pull request; outside it, a bare asset line stays a link. */
export function VideoAssetsScope({ value, children }: VideoAssetsScopeProps) {
  return (
    <VideoAssetsContext.Provider value={value}>
      {children}
    </VideoAssetsContext.Provider>
  );
}

export function useVideoAssets(): VideoAssets | undefined {
  return useContext(VideoAssetsContext);
}

/** Opens the lightbox at one of the description's Media items. */
export interface MediaLightboxHandle {
  /** The strip holds an item under `key`. */
  readonly hasMedia: (key: MediaKey) => boolean;
  /** Opens the lightbox at `key`; focus returns to `opener` on close. */
  readonly openMedia: (key: MediaKey, opener: HTMLElement) => void;
}

export interface MediaLightboxScopeProps {
  value: MediaLightboxHandle;
  children: ReactNode;
}

const MediaLightboxContext = createContext<MediaLightboxHandle | undefined>(
  undefined,
);

/** Fed by the brief around its Original description; outside it, an image only shows. */
export function MediaLightboxScope({
  value,
  children,
}: MediaLightboxScopeProps) {
  return (
    <MediaLightboxContext.Provider value={value}>
      {children}
    </MediaLightboxContext.Provider>
  );
}

export function useMediaLightbox(): MediaLightboxHandle | undefined {
  return useContext(MediaLightboxContext);
}

export interface InsideLinkScopeProps {
  children: ReactNode;
}

const InsideLinkContext = createContext(false);

/** Wraps a link's content: an image inside it stays the author's link, never a lightbox control. */
export function InsideLinkScope({ children }: InsideLinkScopeProps) {
  return (
    <InsideLinkContext.Provider value>{children}</InsideLinkContext.Provider>
  );
}

/** The content renders inside the author's link. */
export function useInsideLink(): boolean {
  return useContext(InsideLinkContext);
}
