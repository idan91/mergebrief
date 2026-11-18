/** The pull request opens in a new tab that cannot reach back into the app. */
export function openOnGithub(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
