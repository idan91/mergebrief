import { MediaKinds } from "brief-core/media";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconRotations } from "@web/components/Icon/types";
import { IconButton, IconButtonSizes } from "@web/components/IconButton";
import { Modal } from "@web/components/Modal";
import type { MediaGallery } from "../types";
import { readEntryLabel } from "../utils";
import { LightboxHeader } from "./LightboxHeader";
import { LightboxItem } from "./LightboxItem";
import { useLightboxKeys } from "./useLightboxKeys";
import styles from "./MediaLightbox.module.scss";

export interface MediaLightboxProps {
  gallery: MediaGallery;
}

/**
 * One strip item at a time over the page, stepping through the whole strip
 * and wrapping at either end. Escape closes it, and focus goes back to the
 * control that opened it.
 */
export function MediaLightbox({ gallery }: MediaLightboxProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const { entries, openIndex, opener, stepMedia, closeMedia } = gallery;
  const entry = openIndex === undefined ? undefined : entries[openIndex];
  const open = entry !== undefined;
  useLightboxKeys(open, stepMedia);

  const count = entries.length;
  const position = (openIndex ?? 0) + 1;
  const label = entry === undefined ? "" : readEntryLabel(t, entry);
  const status = open
    ? t("brief.media.status", { caption: label, position, count })
    : "";
  const steps = count > 1;
  const githubLink =
    entry === undefined || entry.kind === MediaKinds.DIAGRAM
      ? undefined
      : entry.githubLink;

  return (
    <Modal
      boxClassName={styles["lightbox"]}
      close={closeMedia}
      labelledBy={headingId}
      open={open}
      opener={opener}
    >
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {status}
      </span>
      {entry === undefined ? null : (
        <>
          <LightboxHeader
            count={count}
            githubLink={githubLink}
            headingId={headingId}
            label={label}
            position={position}
            onClose={closeMedia}
          />
          <div className={styles["stage"]}>
            {steps ? (
              <IconButton
                className={styles["arrow"]}
                data-side="start"
                label={t("brief.media.previous")}
                size={IconButtonSizes.LG}
                onClick={() => {
                  stepMedia(-1);
                }}
              >
                <Icon
                  name={IconNames.CARET_DOWN}
                  rotation={IconRotations.QUARTER}
                />
              </IconButton>
            ) : null}
            <LightboxItem entry={entry} key={entry.key} />
            {steps ? (
              <IconButton
                className={styles["arrow"]}
                data-side="end"
                label={t("brief.media.next")}
                size={IconButtonSizes.LG}
                onClick={() => {
                  stepMedia(1);
                }}
              >
                <Icon
                  name={IconNames.CARET_DOWN}
                  rotation={IconRotations.THREE_QUARTERS}
                />
              </IconButton>
            ) : null}
          </div>
        </>
      )}
    </Modal>
  );
}
