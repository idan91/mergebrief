/**
 * The heading exists whether or not the section is expanded, so focus and
 * scroll land on it a frame later, after the expand has rendered.
 */
export function focusConversationHeading(): void {
  window.requestAnimationFrame(() => {
    const heading = document.getElementById("conversation-heading");
    if (!(heading instanceof HTMLElement)) {
      return;
    }
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  });
}
