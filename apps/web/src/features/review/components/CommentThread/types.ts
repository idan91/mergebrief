export const ThreadModeKinds = {
  VIEW: "view",
  EDITING: "editing",
  CONFIRMING_DELETE: "confirming-delete",
} as const;

export interface ViewingThreadMode {
  kind: typeof ThreadModeKinds.VIEW;
}

export interface EditingThreadMode {
  kind: typeof ThreadModeKinds.EDITING;
  /** The edit's write is in flight; the editor closes only once it lands. */
  saving: boolean;
}

export interface ConfirmingDeleteThreadMode {
  kind: typeof ThreadModeKinds.CONFIRMING_DELETE;
}

export type ThreadMode =
  | ViewingThreadMode
  | EditingThreadMode
  | ConfirmingDeleteThreadMode;
