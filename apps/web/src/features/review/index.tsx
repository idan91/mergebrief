// Curated feature entry (ADR 0037): the externally consumed entry
// components. Session state stays at `./session`, logic modules (submit,
// comments, receipt, …) are imported directly. Internal review files import
// their targets directly, never this index (import/no-cycle).
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
  PreSubmitModal,
  type PreSubmitModalProps,
} from "./components/PreSubmitModal/PreSubmitModal";
export {
  SubmitModal,
  type SubmitModalProps,
} from "./components/SubmitModal/SubmitModal";
export {
  SummaryPreview,
  type SummaryPreviewProps,
} from "./components/SummaryPreview/SummaryPreview";
