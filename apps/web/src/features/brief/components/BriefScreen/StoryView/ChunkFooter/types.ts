export interface ChunkStep {
  chunkId: string;
  /** The target sits in another group, so the control names the group. */
  crossesGroup: boolean;
}

export interface ChunkSteps {
  previous?: ChunkStep;
  next?: ChunkStep;
}
