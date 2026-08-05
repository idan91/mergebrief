// Curated feature entry (ADR 0037): the externally consumed entry
// components. Internal conversation files import their targets directly,
// never this index (import/no-cycle).
export {
  ConversationSection,
  type ConversationPlan,
  type ConversationSectionProps,
} from "./components/ConversationSection/ConversationSection";
export {
  ConversationFilterBar,
  type ConversationFilterBarProps,
} from "./components/ConversationFilterBar/ConversationFilterBar";
export {
  ThreadRowView,
  type ThreadRowViewProps,
} from "./components/ThreadRowView/ThreadRowView";
export type {
  ConversationResolutionPlan,
  ThreadComposerWiring,
  ThreadRevisionJump,
} from "./wiring";
export {
  InlineThreads,
  type InlineThreadsProps,
} from "./components/InlineThreads/InlineThreads";
