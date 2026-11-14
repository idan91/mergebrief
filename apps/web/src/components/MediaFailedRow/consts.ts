import type { TranslationKey } from "i18n";

import { IconNames, type IconName } from "@web/components/Icon/types";
import { MediaFailedRowKinds, type MediaFailedRowKind } from "./types";

export const FAILED_WORDING_KEYS: Readonly<
  Record<MediaFailedRowKind, TranslationKey>
> = {
  [MediaFailedRowKinds.IMAGE]: "shell.media.imageFailed",
  [MediaFailedRowKinds.VIDEO]: "shell.media.videoFailed",
};

/** About two lines of the row at the reading column's width. */
export const OUTSIDE_ALT_MAX_CHARS = 120;
/** How far back the cut may move to end on a whole word. */
export const OUTSIDE_ALT_WORD_SLACK = 20;
export const ELLIPSIS = "…";

export const FAILED_ICON_NAMES: Readonly<Record<MediaFailedRowKind, IconName>> =
  {
    [MediaFailedRowKinds.IMAGE]: IconNames.IMAGE,
    [MediaFailedRowKinds.VIDEO]: IconNames.FILM_STRIP,
  };
