# Mockup UX Behaviors

> Companion doc for `mockup/index.html` — the interactive wizard-of-Oz mockup of the Brief review surface, built on the hand-labeled medusajs/medusa #15605 PR. Every interactive behavior in the mockup is listed here, including the product rule it demonstrates where one exists (cross-references into `docs/`). No AI runs on the page; all data is the hand-labeled brief.

## Header (persistent top bar)

| Behavior | Detail |
|---|---|
| PR context | Title, repo, PR number, activation recency ("activated 12 min ago" — reflects the Activation model, `initial-scope.md`). |
| GitHub link | The PR number (`#15605 ↗`) links to the original PR on GitHub, new tab. |
| Adjusted LoC badge | Shows **adjusted** +/− counts (green/red). Click → popover explaining adjusted vs git LoC: moved and generated lines are mechanically excluded; on this PR nothing was excluded so adjusted = git. (`CONTEXT.md` → LoC.) |
| Live counters | `playbook n/13` · `chunks n/8` · `flags n/4` — update on every interaction. |
| Progress bar | 1px bar under the header; fills proportionally to (playbook items + chunks read + flags resolved) / total. |
| Receipt button | Opens the receipt drawer (see below). The single primary (white) action in the header. |

## PR timeline navigator

| Behavior | Detail |
|---|---|
| Timeline point | A point represents one indexed full **Brief** at a distinct PR head. It is never a flat mixture of Brief and Delta artifacts. |
| Direct selection | The header provides Previous/Next buttons and a native revision picker, which reaches every revision. A wider screen also shows up to nine ordered visual steps around the current point, plus first/last shortcuts and ellipses; each is a normal button, not a drag-only control. |
| Current selection | The selected point announces its Brief index, short SHA, and available context. Selecting it updates the URL, loads the corresponding Brief, and moves focus to the Brief heading with a polite status announcement. |
| Full / Delta lens | A separate toggle controls whether the selected point shows the full Brief or a valid Delta Brief. The Delta label names its baseline, e.g. `Delta Brief · since your checkpoint _2`. |
| Delta availability | Every valid Delta maps to the full Brief at the same head. Points with a valid Delta are marked in the visual timeline and may switch lenses in place. If the selected Delta is unavailable, pending, fails, or falls back because its span is too large, the full Brief remains visible with an honest explanation. |
| Historical review state | Historical timeline points are read-only. Local draft comments and review state are silently retained in session storage while the reviewer looks elsewhere; `Clear local drafts` removes them, and they expire when the browser session ends. |
| Responsive and accessibility | WCAG 2.2 AA: labelled buttons, native picker, 44px targets, Tab/Enter/Space support, optional Left/Right convenience between steps, visible focus, and no swipe-only selection. On small screens, retain Previous/Next plus the picker and hide the visual stepper if needed. |

## Toolbar (below the PR summary)

| Behavior | Detail |
|---|---|
| View toggle — **Story / Concerns** | Two pivots over the same 8 chunks. Story = by change-group (group card + chunk list). Concerns = by artifact (implementation / test / doc buckets with LoC bars and per-file jump links; generated/spec/config shown as an excluded 0-line bucket). (`CONTEXT.md` → Story view, Concern view.) |
| Layout toggle — **Stacked / Side by side** | Stacked: details card on top, changes below (default). Side by side: changes left, details rail right at `max(600px, 25%)` width; the rail is sticky and independently scrollable so playbook + flags stay visible while scrolling the diff. Below 1180px viewport the split collapses back to stacked. Story view only. Switching layouts preserves any active-chunk highlight. |
| **Collapse supporting** switch | On by default: supporting chunks (test/doc) render collapsed, core chunks expanded — the attention-routing default. Off: everything expands. Per-chunk manual folding always overrides. |

## Group card (Story view)

| Behavior | Detail |
|---|---|
| Group summary | One descriptive sentence — *what*, never *why* (`CONTEXT.md` → Summary). LoC + core/supporting counts in the corner, non-prominent. |
| Categorization + **uncertain** | Dominant category chip (`new-feature`) with an amber `uncertain` chip: the categorizer is split between new-feature and bugfix (this PR's real labeling tension). A panel asks the reviewer to pick. (`initial-scope.md` → AI failure modes: low confidence surfaces explicitly, never hidden.) |
| One-click reclassify | Picking a category: chip updates, **playbook swaps** to the chosen category's items (core checks reset), a note appears ("set by you · playbook swapped · recorded on receipt"), and the receipt records the reclassification. (`CONTEXT.md` → example dialogue.) |
| Playbook checklist | Core items verbatim from `docs/mvp/playbooks.md` for the dominant category. Click to check/uncheck; checked items grey out; counts update header + receipt. |
| Supporting checks | `test` (5) and `doc` (3) concern checks in collapsible sections — collapsed by default, mirroring supporting-chunk de-emphasis. |
| Risk surface rail | 4 flags using real attributes from `docs/mvp/risk-surface.md` (`widely-imported`, `cross-service` ×2, `no-tests`). Factual descriptions only — attributes, never verdicts (ADR 0002). Location links jump + expand the chunk. |
| Flag — **Addressed** | Marks the flag addressed (green); receipt will pair it with the reviewer's comment. |
| Flag — **Dismiss…** | Opens a modal requiring a reason. A thin reason (<12 chars) triggers a one-time amber warning — **warn once, never block; the reviewer authorizes** (`initial-scope.md` §6). The reason lands on the receipt verbatim. |

## Chunks (Story view)

| Behavior | Detail |
|---|---|
| Ordering | Core chunks first, then supporting. |
| Chunk header | Sticky below the app header while its diff scrolls. Shows: fold arrow, path (dimmed) + filename, risk attribute (amber), concern dot + name (+ `· core` for core chunks), colored adjusted LoC, Mark reviewed button. |
| Fold + **click-activation** | Click header to expand/collapse. Collapsed core chunks show "collapsed"; collapsed supporting chunks show "supporting chunk — collapsed" (role-aware note). Clicking a header also makes that chunk the **active** one: subtle outline on the chunk card + its playbook section heading highlights. Works in both layouts; in stacked, the click-set highlight persists until the next click. A short (~0.8s) suppression window stops reflow-triggered scroll events from immediately overriding the click in split view. |
| Mark reviewed | Toggles per-chunk read state; card border lightens, counter + progress update. (`initial-scope.md` → state persistence: per-chunk read state.) |
| Diff rendering | Real PR diff, hunk headers, dual line numbers, soft green/red row tints. Repeated identical hunks abbreviated with an italic note ("3 more identical fixture-URL replacements"). |
| **Scroll-spy** (side-by-side only) | While scrolling, the chunk under the reading line (~150px from top) becomes active: subtle outline on the chunk + the matching playbook section heading highlights (implementation → category playbook, test → test checks, doc → doc checks). The details rail auto-scrolls **its own content only** (never the window) just enough to keep the highlighted heading visible. Scroll drives the highlight only in split view; cleared when leaving Story view. |

## Concerns view

| Behavior | Detail |
|---|---|
| Buckets | implementation `+37/−7` · test `+34/−10` · doc `+6/−0`, each with a proportional bar and per-file list. |
| Jump links | Clicking a file switches to Story view, expands that chunk, scrolls to it. |
| Excluded bucket | `generated · spec · config — 0 lines` shown muted, demonstrating the default exclusion from the attention split. |

## Receipt drawer

| Behavior | Detail |
|---|---|
| Open/close | Header button opens a bottom sheet over a scrim; "Keep reviewing", scrim click, or submit closes it. |
| Live content | Regenerated on open: playbook counts, supporting check counts, chunks read, flags (addressed / dismissed-with-verbatim-reason / still open), reclassification note if any, and a fixed "not checked: business intent · runtime behavior · …" disclosure. |
| Framing | Tagged **"not an approval"**; sub-line explains it is frozen at submit and linked from a one-line signature on the reviewer's normal GitHub review (ADR 0002, `CONTEXT.md` → Receipt, Signature line, Review Summary). |
| Submit | Shows a toast explaining the real flow: review posts natively to GitHub under the reviewer's name with the signature line. No actual submission. |

## Global

| Behavior | Detail |
|---|---|
| Toasts | Bottom-center, ~4s, used for: flag addressed, dismissal recorded, category set, submit explainer. |
| Load animation | Staggered fade-up of the main sections on first paint. |
| No-AI note | Footer states the page is a hand-labeled mockup with no AI running — keeps interview framing honest. |

## Interview usage notes

- This is **section-7 material** in the interview script (`docs/interviews/script.md`): hand over the mouse, stay silent for the first minute, watch what they touch first (group card vs flags vs concern toggle vs diff).
- The **uncertain → reclassify** moment is the strongest probe: do they engage with the judgment or skip past it?
- **Layout choice** (stacked vs side-by-side) and **collapse-supporting** usage are worth logging on the capture sheet — both are attention-routing signals.
- Caution from the synthesis: this mockup is richer than the markdown briefs used in the Phase 1 gate. Reactions here are signal on *brief + UI*, not the brief alone; the pre-registered Treatment-vs-B′ comparison stays markdown-based.
