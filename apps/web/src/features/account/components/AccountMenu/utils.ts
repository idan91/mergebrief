/** The release notes open in a new tab; no URL, no tab. */
export function openReleaseNotes(url: string | undefined): void {
  if (url === undefined) {
    return;
  }
  window.open(url, "_blank", "noreferrer");
}
