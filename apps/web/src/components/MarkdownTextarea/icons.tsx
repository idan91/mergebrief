// Each glyph is its own .svg under ./icons/, imported as a component via
// vite-plugin-svgr so currentColor inherits. All decorative — every toolbar
// button carries its own aria-label.
import BoldIcon from "./icons/bold.svg?react";
import BulletedListIcon from "./icons/bulleted-list.svg?react";
import CodeIcon from "./icons/code.svg?react";
import ItalicIcon from "./icons/italic.svg?react";
import LinkIcon from "./icons/link.svg?react";
import NumberedListIcon from "./icons/numbered-list.svg?react";
import QuoteIcon from "./icons/quote.svg?react";
import SuggestionIcon from "./icons/suggestion.svg?react";
import TaskListIcon from "./icons/task-list.svg?react";

export const TOOLBAR_ICONS = {
  bold: <BoldIcon aria-hidden="true" />,
  italic: <ItalicIcon aria-hidden="true" />,
  code: <CodeIcon aria-hidden="true" />,
  quote: <QuoteIcon aria-hidden="true" />,
  bulletedList: <BulletedListIcon aria-hidden="true" />,
  numberedList: <NumberedListIcon aria-hidden="true" />,
  taskList: <TaskListIcon aria-hidden="true" />,
  link: <LinkIcon aria-hidden="true" />,
  suggestion: <SuggestionIcon aria-hidden="true" />,
} as const;

export type ToolbarIconKey = keyof typeof TOOLBAR_ICONS;
