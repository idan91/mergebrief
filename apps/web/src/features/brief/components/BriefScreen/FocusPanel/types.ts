export interface FilePathDirectory {
  /** The path up to and including this directory; unique within one path. */
  key: string;
  text: string;
}

export interface FilePathParts {
  directories: FilePathDirectory[];
  basename: string;
}
