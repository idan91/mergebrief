/** The page's main region: the skip link's target and where a lost focus lands. */
export const MAIN_CONTENT_ID = "main-content";

/** Focus sits on nothing a reader can act from: the body, or an element the last page took with it. */
export function isFocusLost(active: Element | null): boolean {
  const held =
    active instanceof HTMLElement &&
    active !== active.ownerDocument.body &&
    active.isConnected;
  return !held;
}
