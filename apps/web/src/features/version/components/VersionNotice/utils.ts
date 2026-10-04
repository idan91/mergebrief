const MAIN_CONTENT_ID = "main-content";

/** The band leaves on dismiss; focus lands on the content it sat above. */
export function focusMainContent(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
}
