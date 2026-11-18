import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DisplaySize } from "../../types";
import { useLightboxZoomFacade } from "./useLightboxZoomFacade";
import styles from "./LightboxZoom.module.scss";

export interface LightboxZoomProps {
  /** The item's own size: an image's natural pixels as CSS pixels, a diagram's viewBox; absent until known. */
  naturalSize?: DisplaySize | undefined;
  /** The item, drawn to fill the box this sizes. */
  children: ReactNode;
}

/**
 * The open item fitted to the stage. An item whose own size outgrows the
 * stage zooms to that size on a click, anchored at the clicked point; while
 * zoomed it pans by drag, wheel, touch or the arrow keys, and a click
 * returns it to fit. An item that fits offers nothing.
 */
export function LightboxZoom({ naturalSize, children }: LightboxZoomProps) {
  const { t } = useTranslation();
  const zoom = useLightboxZoomFacade(naturalSize);

  const zoomState = zoom.zoomed ? "actual" : "fit";
  const itemStyle =
    zoom.itemSize === undefined
      ? undefined
      : { inlineSize: zoom.itemSize.width, blockSize: zoom.itemSize.height };
  const sized = itemStyle !== undefined;
  const toggleLabel = zoom.zoomed
    ? t("brief.media.fitToScreen")
    : t("brief.media.showActualSize");
  return (
    <div
      className={styles["viewport"]}
      data-dragging={zoom.dragging}
      data-zoom={zoomState}
      ref={zoom.viewportRef}
      onPointerCancel={zoom.onPointerUp}
      onPointerDown={zoom.onPointerDown}
      onPointerMove={zoom.onPointerMove}
      onPointerUp={zoom.onPointerUp}
    >
      <div className={styles["content"]}>
        <div
          className={styles["item"]}
          data-sized={sized}
          data-testid="lightbox-zoom-item"
          ref={zoom.itemRef}
          style={itemStyle}
        >
          {children}
          {zoom.zoomable ? (
            // oxlint-disable-next-line house/no-raw-button -- a see-through control laid over the item; no shared primitive draws nothing
            <button
              aria-label={toggleLabel}
              className={styles["toggle"]}
              type="button"
              onClick={zoom.onToggleClick}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
