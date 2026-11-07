import { useEffect } from "react";

export function useEscapeToClose(open: boolean, close: () => void): void {
  // Escape must dismiss a hover-opened callout too, and focus may be anywhere,
  // so listen at the document while open, capture phase, and consume the key
  // so it never reaches page-level handling.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // `close` is recreated per render; re-registering per render while open
    // is harmless and keeps the handler's closure fresh.
  });
}
