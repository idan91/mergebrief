// Curated feature entry: the externally consumed components only. Session
// state stays at `./session`, logic modules are imported directly, and
// internal review files never import this index (import/no-cycle).
export {
  AddressedComments,
  ReviewComments,
  addressedCommentRange,
  type AddressedCommentsProps,
  type ReviewCommentsProps,
} from "./components/AddressedComments";
export {
  AddressedDiffComment,
  type AddressedDiffCommentProps,
} from "./components/AddressedDiffComment";
export {
  CommentComposer,
  type CommentComposerProps,
} from "./components/CommentComposer";
export {
  CommentThread,
  type CommentThreadProps,
} from "./components/CommentThread";
export {
  DismissModal,
  type DismissModalProps,
} from "./components/DismissModal";
export {
  EvidenceModal,
  type EvidenceModalProps,
} from "./components/EvidenceModal";
export type { DismissTarget, EvidenceTarget } from "./utils/state";
export { SubmitModal, type SubmitModalProps } from "./components/SubmitModal";
