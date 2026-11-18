export interface PathSegment {
  /** The path up to and including this segment; unique within one path. */
  key: string;
  text: string;
}
