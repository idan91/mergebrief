/** Matches `@media (hover: none)`: touch screens, with or without a hardware keyboard. */
export const HOVERLESS_QUERY = "(hover: none)";

/** The release notes open in a new tab; no URL, no tab. */
export function openReleaseNotes(url: string | undefined): void {
  if (url === undefined) {
    return;
  }
  window.open(url, "_blank", "noreferrer");
}

export function subscribeHoverless(onChange: () => void): () => void {
  const list = window.matchMedia(HOVERLESS_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export function readHoverless(): boolean {
  return window.matchMedia(HOVERLESS_QUERY).matches;
}

/** The menu content mounts only on open, so the server answer never reaches hydrated markup. */
export function readServerHoverless(): boolean {
  return false;
}
