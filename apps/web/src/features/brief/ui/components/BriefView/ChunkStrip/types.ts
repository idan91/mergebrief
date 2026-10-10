export interface ChunkMark {
  id: string;
  basename: string;
  /** The chunk's first changed line: first added, else first removed. */
  line: number | undefined;
  /** 1-based place in the group's reading order. */
  position: number;
}
