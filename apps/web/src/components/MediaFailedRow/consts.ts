import type { TranslationKey } from "i18n";

import { IconNames, type IconName } from "@web/components/Icon/types";
import { MediaFailedRowKinds, type MediaFailedRowKind } from "./types";

export const FAILED_WORDING_KEYS: Readonly<
  Record<MediaFailedRowKind, TranslationKey>
> = {
  [MediaFailedRowKinds.IMAGE]: "shell.media.imageFailed",
  [MediaFailedRowKinds.VIDEO]: "shell.media.videoFailed",
};

export const FAILED_ICON_NAMES: Readonly<Record<MediaFailedRowKind, IconName>> =
  {
    [MediaFailedRowKinds.IMAGE]: IconNames.IMAGE,
    [MediaFailedRowKinds.VIDEO]: IconNames.FILM_STRIP,
  };
