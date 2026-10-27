/** Invisible to a reader, read by a model: zero-width, bidi, variation selectors, Unicode tags. */
export const HIDDEN_CHARS =
  /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;
