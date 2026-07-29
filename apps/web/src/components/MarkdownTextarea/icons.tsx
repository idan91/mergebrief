import type { ReactNode } from "react";

/* 14×14 stroke icons matching CopyButton's set (1.4 stroke, currentColor).
   All decorative — every toolbar button carries its own aria-label. */
function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 14 14"
      width="16"
    >
      {children}
    </svg>
  );
}

export const TOOLBAR_ICONS = {
  bold: (
    <ToolbarIcon>
      <path d="M4 2.5h3.5a2.25 2.25 0 0 1 0 4.5H4zM4 7h4a2.25 2.25 0 0 1 0 4.5H4z" />
    </ToolbarIcon>
  ),
  italic: (
    <ToolbarIcon>
      <path d="M6.5 2.5h5M2.5 11.5h5M9 2.5l-4 9" />
    </ToolbarIcon>
  ),
  code: (
    <ToolbarIcon>
      <path d="M4.5 4 2 7l2.5 3M9.5 4 12 7l-2.5 3" />
    </ToolbarIcon>
  ),
  quote: (
    <ToolbarIcon>
      <path d="M2.5 2.5v9M6 4h5.5M6 7h5.5M6 10h4" />
    </ToolbarIcon>
  ),
  bulletedList: (
    <ToolbarIcon>
      <path d="M6 3h6M6 7h6M6 11h6" />
      <circle cx="2.8" cy="3" fill="currentColor" r="0.9" stroke="none" />
      <circle cx="2.8" cy="7" fill="currentColor" r="0.9" stroke="none" />
      <circle cx="2.8" cy="11" fill="currentColor" r="0.9" stroke="none" />
    </ToolbarIcon>
  ),
  numberedList: (
    <ToolbarIcon>
      <path d="M6.5 3.5h5.5M6.5 7h5.5M6.5 10.5h5.5" />
      <path d="M1.8 2.8 3 2v3M1.8 8.3c0-1.3 2.2-1.2 2.2-.1 0 .9-2.2 1.3-2.2 2.3h2.4" />
    </ToolbarIcon>
  ),
  taskList: (
    <ToolbarIcon>
      <rect height="6" rx="1" width="6" x="1.5" y="4" />
      <path d="m3 7 1.3 1.3L6.3 5.9M9.5 7h3" />
    </ToolbarIcon>
  ),
  link: (
    <ToolbarIcon>
      <path d="M5.5 8.5l3-3" />
      <path d="M4.2 6.8 2.9 8.1a2.2 2.2 0 0 0 3.1 3.1l1.3-1.3M6.8 4.2l1.3-1.3a2.2 2.2 0 0 1 3.1 3.1L9.9 7.3" />
    </ToolbarIcon>
  ),
  suggestion: (
    <ToolbarIcon>
      <path d="M2.5 4h4M4.5 2v4M7.5 10.5h4" />
    </ToolbarIcon>
  ),
} as const;

export type ToolbarIconKey = keyof typeof TOOLBAR_ICONS;
