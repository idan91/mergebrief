// Curated feature entry: the externally consumed components only. Session
// state stays at `./session`, logic modules are imported directly, and
// internal review files never import this index (import/no-cycle).
export {
  AddressedComments,
  ReviewComments,
  addressedCommentRange,
  type AddressedCommentsProps,
  type ReviewCommentsProps,
} from "./components/AddressedComments/AddressedComments";
export {
  AddressedDiffComment,
  type AddressedDiffCommentProps,
} from "./components/AddressedDiffComment/AddressedDiffComment";
export {
  CommentComposer,
  type CommentComposerProps,
} from "./components/CommentComposer/CommentComposer";
export {
  CommentThread,
  type CommentThreadProps,
} from "./components/CommentThread/CommentThread";
export {
  DismissModal,
  type DismissModalProps,
} from "./components/DismissModal/DismissModal";
export {
  EvidenceModal,
  type EvidenceModalProps,
} from "./components/EvidenceModal/EvidenceModal";
export type { DismissTarget, EvidenceTarget } from "./utils/state";
export {
  SubmitModal,
  type SubmitModalProps,
} from "./components/SubmitModal/SubmitModal";
export {
  SummaryPreview,
  type SummaryPreviewProps,
} from "./components/SummaryPreview/SummaryPreview";
