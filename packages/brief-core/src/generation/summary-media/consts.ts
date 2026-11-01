/** A scheme address (`https://…`, `data:…`, `javascript:…`) or a `www.` host, through the next whitespace. */
export const ADDRESS_PATTERN =
  /[a-z][a-z\d+.-]*:\/\/\S*|\bwww\.\S+|\b(?:data|javascript|vbscript|mailto|blob):\S*/giu;

export const WHITESPACE_RUN = /\s+/gu;
export const CONTROL_CHARS = /\p{Cc}/gu;

/** A caption or heading line for the model: past this, the description itself carries the rest. */
export const MEDIA_TEXT_MAX_CHARS = 160;

/** The warning check name the trims report under. */
export const SUMMARY_MEDIA_CHECK = "summary media";
