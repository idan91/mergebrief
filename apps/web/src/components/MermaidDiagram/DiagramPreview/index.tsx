import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { OpenerBadge } from "@web/components/OpenerBadge";
import { DiagramFrame } from "../DiagramFrame";
import type { DiagramPreviewOptions, RenderedDiagram } from "../types";
import { readFrameMaxWidth } from "../utils";
import styles from "./DiagramPreview.module.scss";

export interface DiagramPreviewProps {
  diagram: RenderedDiagram;
  /** The diagram's type, read out as the frame's and the control's name. */
  title: string;
  preview: DiagramPreviewOptions;
}

/**
 * The diagram no taller than the preview's height, centred, under a
 * see-through control that opens it larger: the sandboxed frame takes no
 * clicks of its own.
 */
export function DiagramPreview({
  diagram,
  title,
  preview,
}: DiagramPreviewProps) {
  const { t } = useTranslation();
  const bounds = { maxBlockSize: preview.maxHeight };
  const hostStyle: CSSProperties = {
    inlineSize: `${readFrameMaxWidth(diagram, preview.maxHeight)}px`,
  };
  const openLabel = t("shell.media.openDiagram", { type: title });

  return (
    <div className={styles["preview"]} style={hostStyle}>
      <DiagramFrame bounds={bounds} diagram={diagram} title={title} />
      {/* oxlint-disable-next-line house/no-raw-button -- a see-through control laid over a frame that takes no clicks; a frame cannot sit inside a button, so ImageOpener cannot wrap it */}
      <button
        aria-haspopup="dialog"
        aria-label={openLabel}
        className={styles["opener"]}
        type="button"
        onClick={(event) => {
          preview.onOpen(event.currentTarget);
        }}
      >
        <OpenerBadge />
      </button>
    </div>
  );
}
