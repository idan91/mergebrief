import { isAttachmentAssetId } from "contract";
import { useEffect, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";

import { InsideLinkScope, useVideoAssets } from "../context";
import { PASTED_ASSET_PROPERTY } from "../pasted-asset-lines";

export type PastedAssetAwareLinkProps = ComponentProps<"a"> & ExtraProps;

/**
 * The renderer's link; an image inside it stays the author's link and never
 * becomes a lightbox control. One the bare-line step marked asks the page whether
 * GitHub rendered its asset as a video, and renders as written meanwhile;
 * the step swaps it for a player once the answer confirms it.
 */
export function PastedAssetAwareLink({
  node,
  href,
  children,
  ...props
}: PastedAssetAwareLinkProps) {
  const marked = node?.properties[PASTED_ASSET_PROPERTY];
  const isMarked = typeof marked === "string" && isAttachmentAssetId(marked);
  const pastedAssetId = isMarked ? marked : undefined;
  const requestVideoAssets = useVideoAssets()?.requestVideoAssets;

  useEffect(() => {
    if (pastedAssetId !== undefined && requestVideoAssets !== undefined) {
      requestVideoAssets(pastedAssetId);
    }
  }, [pastedAssetId, requestVideoAssets]);

  if (pastedAssetId === undefined) {
    return (
      <a href={href} {...props}>
        <InsideLinkScope>{children}</InsideLinkScope>
      </a>
    );
  }
  return (
    <a href={href}>
      <InsideLinkScope>{children}</InsideLinkScope>
    </a>
  );
}
