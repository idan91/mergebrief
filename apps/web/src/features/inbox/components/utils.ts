import { MAIN_CONTENT_ID } from "@web/utils/main-content";

/** Focus to the main landmark on the next frame, once the block that held it is gone. */
export function focusMainContent(): void {
  window.requestAnimationFrame(() =>
    document.getElementById(MAIN_CONTENT_ID)?.focus(),
  );
}
