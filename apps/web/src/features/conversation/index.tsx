// Curated feature entry (ADR 0037): the two externally consumed entry
// components. Internal conversation files import their targets directly,
// never this index (import/no-cycle).
export {
  ConversationSection,
  type ConversationPlan,
  type ConversationSectionProps,
  type ThreadComposerWiring,
  type ThreadRevisionJump,
  ThreadRowView,
  type ThreadRowViewProps,
} from "./components/ConversationSection/ConversationSection";
export {
  InlineThreads,
  type InlineThreadsProps,
} from "./components/InlineThreads/InlineThreads";
