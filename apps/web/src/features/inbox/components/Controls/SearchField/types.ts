/** The field's text beside the URL's, and the writes on their way between them. */
export interface SearchFieldState {
  /** What the field shows; ahead of the URL while the reviewer types. */
  readonly text: string;
  /** The URL's search text when the state last took it in. */
  readonly seenUrlText: string;
  /** Texts this field wrote that the URL has not shown yet, oldest first. */
  readonly ownWrites: readonly string[];
  /** A write went out and its list is still loading. */
  readonly awaitsLanding: boolean;
}
