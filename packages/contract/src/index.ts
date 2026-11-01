// The curated wire surface. Everything here is what an API response carries
// or what a client sends: no handlers, no middleware, no database access, and
// no re-export of the API app.
export {
  ATTACHMENT_ASSET_ORIGIN,
  ATTACHMENT_ASSET_PATH_PREFIX,
  ATTACHMENT_BRANCH,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
  ATTACHMENT_MAX_BYTES,
  AttachmentMediaTypes,
  AttachmentParseErrorCodes,
  AttachmentSourceKinds,
  buildAttachmentBranchUrl,
  isAttachmentAssetId,
  parseAttachmentAssetId,
  parseAttachmentFileName,
  parseAttachmentSource,
  readAssetPathId,
  VIDEO_ASSETS_MISSING_PARAM,
  type AssetAttachmentSource,
  type AttachmentAssetId,
  type AttachmentBranchLocation,
  type AttachmentFile,
  type AttachmentMediaType,
  type AttachmentParseErrorCode,
  type AttachmentSource,
  type AttachmentSourceKind,
  type BranchAttachmentSource,
  type UploadAttachmentResponse,
  type VideoAssetsResponse,
} from "./attachments";
export {
  AttentionItemKinds,
  AttentionSubjectTypes,
  type AttentionItem,
  type AttentionItemKind,
  type AttentionLocation,
  type AttentionSubject,
  type AttentionSubjectType,
  type ClearedBy,
  type FileAttentionLocation,
  type LineAttentionLocation,
} from "./attention";
export { RequestBounds } from "./bounds";
export type {
  CatalogOperation,
  ReadCapabilitiesResponse,
} from "./capabilities";
export type {
  CollaboratorsResponse,
  CollaboratorView,
  ConversationAuthorView,
  ConversationCommentView,
  ConversationResponse,
  ConversationReviewView,
  ConversationThreadView,
  CreateInlineCommentBody,
  PostedCommentResponse,
  PrLevelCommentView,
  ReplyToCommentBody,
  ThreadResolutionResponse,
} from "./conversation";
export {
  ApiErrorCodes,
  ApiErrorEnglishByCode,
  ApiErrorStatusByCode,
  parseApiErrorBody,
  type ApiErrorBody,
  type ApiErrorCode,
} from "./errors";
export type { FileRangeView } from "./file-range";
export {
  InboxQueryBounds,
  InboxQueryKeys,
  type InboxCountsView,
  type InboxItem,
  type InboxQueryKey,
  type InboxRepositoryView,
  type InboxResponse,
  type InboxStackView,
  type Page,
  type ReachableInstallationView,
} from "./inbox";
export type { SpendLargeRuns, SpendView } from "./spend";
export {
  MentionBounds,
  MentionPatterns,
  MentionQueryKeys,
  type MentionQueryKey,
  type MentionSuggestionsResponse,
  type MentionTargetsResponse,
  type MentionTeamView,
  type MentionUserView,
} from "./mentions";
export {
  WaitReasons,
  type GenerateBriefBody,
  type GenerateBriefResponse,
  type GenerationClaimsResponse,
  type GenerationClaimsView,
  type GenerationPartsView,
  type GenerationSummaryView,
  type RunningTakeoverView,
  type ScheduledTakeoverView,
  type SpentTakeoverView,
  type TakeoverView,
  type WaitReason,
} from "./generation";
export {
  LocalBriefKinds,
  type LocalBriefKind,
  type LocalBriefSummary,
  type LocalBriefView,
  type LocalComparisonAvailability,
  type LocalLastReviewAvailability,
  type LocalPreviousBriefAvailability,
} from "./local-briefs";
export { buildOperationPath, type OperationParams } from "./operation-path";
export {
  ProductOperations,
  formatEndpoint,
  formatProductEndpoint,
  type ProductEndpoint,
  type RouteEndpoint,
} from "./operations";
export {
  OperationKinds,
  ProductActionIds,
  ProductQueryIds,
  type ActionClassification,
  type ActionHttpMethod,
  type OperationKind,
  type ProductActionId,
  type ProductActionRow,
  type ProductOperationId,
  type ProductOperationRow,
  type ProductOperationTable,
  type ProductQueryId,
  type ProductQueryRow,
} from "./operations/types";
export type { PullMetaView } from "./pull-meta";
export type { ListReposResponse, RepoView } from "./repos";
export type { SubmitReviewBody, SubmitReviewResponse } from "./review";
export type {
  AddressRiskBody,
  CarriedFromPayload,
  CreateDraftCommentBody,
  CreateDraftCommentResponse,
  DismissRiskBody,
  DispositionPayload,
  DraftAnchorWire,
  DraftCommentPayload,
  EvidencedFlagAnchorWire,
  EvidenceWire,
  FileDraftAnchorWire,
  FileDraftCommentPayload,
  FlagAnchorWire,
  LineDraftAnchorWire,
  LineDraftCommentPayload,
  ReanchorDraftCommentBody,
  ReclassificationPayload,
  ReclassifyGroupBody,
  ReopenRiskBody,
  RiskWriteResponse,
  SessionPayload,
  SetReviewOutcomeBody,
  SetReviewOutcomeResponse,
  UpdateDraftCommentBody,
} from "./session";
export {
  SIGN_IN_FAILURE_PARAM,
  SIGN_IN_RETURN_PARAM,
  SignInFailures,
  type SignInFailure,
} from "./sign-in";
export {
  PrStackMemberStates,
  type ForkPrStackView,
  type LinearPrStackView,
  type PrStackMemberState,
  type PrStackMemberView,
  type PrStackView,
  type PullStackView,
} from "./stack";
export {
  LastReviewUnavailableReasons,
  type AvailableLastReviewComparisonView,
  type LastReviewComparisonView,
  type LastReviewUnavailableReason,
  type PreviousBriefComparisonView,
  type RevisionComparisons,
  type RevisionView,
} from "./revisions";
export type {
  ApiTokenView,
  ListTokensResponse,
  MintTokenBody,
  MintTokenResponse,
  RevokeSessionsResponse,
  RevokeTokenResponse,
} from "./tokens";
export { WARM_SPAN_DIFF_HEADER } from "./span-diff";
export type { DismissVersionNoticeBody, VersionResponse } from "./version";
export type { AuthSessionResponse, ViewerView } from "./viewer";
