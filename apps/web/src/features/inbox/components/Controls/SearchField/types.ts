/** The field's text beside the URL's, and the writes on their way between them. */
export interface SearchFieldState {
  /** What the field shows; ahead of the URL while the reviewer types. */
  readonly text: string;
  /** The URL's search text when the state last took it in. */
  readonly seenUrlText: string;
  /** Texts on their way to the URL, oldest first: this field's writes, or the override it took. */
  readonly ownWrites: readonly string[];
  /** A write went out and its list is still loading. */
  readonly awaitsLanding: boolean;
  /** The override's count when the state last took one in. */
  readonly seenOverrideCount: number;
}
