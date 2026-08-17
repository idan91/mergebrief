# Mind-Map Session Store (Client Runtime of the Mind-Map Space)

> **Amended 2026-08-17 (BRIEF-197 → [ADR 0040](./0040-review-session-server-store.md)):**
> the store stops being the source of truth. Review state lives on the server
> in a **Review Session** row keyed `(installation, brief, reviewer)`; the
> store keeps an optimistic local copy, writes one operation per user action,
> and its `sessionStorage` persistence effect is **deleted** (existing browser
> sessions are dropped, not migrated). The deferred **region-anchored keying**
> of #4 is now live — a Disposition anchors by `(file, attribute, region)` and
> takes its SHA from the session's Brief, so no row repeats one. **Mind-Map
> Space** is retired as a term; `MindMap*` renames to `ReviewSession*`.

The web app's per-(reviewer × brief) review state — flag **Dispositions**, draft **Comments**, reviewed **Chunks**, reclassifications, playbook progress, outcome — is consolidated into one client-side **session store**: the runtime embodiment of the **Mind-Map Space**. A flag's **Disposition** collapses from three parallel maps into a single discriminated union. The store keys Dispositions by **brief-local flag id** for now; **region-anchored** keying (ADR 0007) is explicitly **deferred** until push→regenerate and the persistence layer (ADR 0008) exist. This is a decision about *where review state lives and how a Disposition is identified*, not a UI restyle.

## Context

The review screen grew a god-component (`BriefApp`, ~610 lines) holding the entire review session as 25+ loose `useState` calls plus ~17 ad-hoc callbacks, with a second overlapping home — a `demoState` context snapshotting most of it to `sessionStorage`. The real behaviour lives in the *couplings*: marking a **Chunk** reviewed touches two sets; choosing a **Dominant Category** resets playbook checks; recording a **Disposition** touches three maps at once (`flagStates` + `riskEvidence` + `dismissReason`). None of it has an **interface** — it can only be exercised by mounting the whole screen, so the **Engagement Layer**'s rules are effectively untested.

This state *is* the **Mind-Map Space** as CONTEXT.md defines it: "the private (per reviewer × PR) workspace where the reviewer thinks, drafts, dismisses flags, and refines comments." So this is not a new concept to name — it is giving an existing glossary term a real client runtime.

Two facts force the region-anchoring question. First, CONTEXT.md and ADR 0007 state a **Disposition** must be "anchored to the flagged code region (file, attribute, region@SHA), never to a brief-local id," so it survives regeneration and feeds **Carry-over status** (New / Reopened / Settled / Dropped). Second, today's `flagStates` is keyed by brief-local flag id — which only breaks when a **Brief regenerates under the reviewer** (eager-on-push, ADR 0006/0020). In the current local-first build a reviewer loads one static **Brief**; no regeneration event exists, so brief-local ids never break in practice. Region-anchoring without the carry-over and persistence machinery (ADR 0008) would be a half-measure.

## Considered Options

- **State home.** *Keep 25 `useState`s in the component* vs *external store* vs *reducer + context*. **External store, zustand (chosen)** — the screen has a heavy diff table, and Candidate B's goal is to let children read the session directly; zustand's selector subscriptions kill both the 28–30-prop drill and the re-render-everything problem in one move, and its actions are plain functions (headless-testable = the **interface is the test surface**). Reducer + context is the zero-dep fallback but re-renders every consumer on any change. The store is created **in a React provider scoped per-brief**, never a module singleton — keeping it SSR-safe (the app renders `ssr: true`), per-brief isolated, and trivially testable, mirroring the existing per-request `queryClient`.
- **State scope.** *Move all 25 fields into the store* vs *sort them*. **Sort (chosen)** — only session/domain state (≈8 fields: Dispositions, evidence, dominants, reclassified groups, reviewed chunks, playbook checks, draft comments, outcome) belongs in the shared store. Transient UI state (modal-open flags, toast, drag-selection, active composer anchor, chunk expansion, bulk selection) stays **local `useState`**, colocated. View preferences (revision toggle, view/layout mode) move to a `useLocalPreference` adapter. Putting modal booleans in a global store is the opposite over-centralization mistake.
- **Disposition representation.** *Three parallel maps* (status / evidence / reason, as today) vs *one discriminated union*. **Union (chosen)** — `{ kind: 'addressed', evidence } | { kind: 'dismissed', reason } | { kind: 'open' }`. One map, not three; makes illegal states ("dismissed with evidence but no reason") unrepresentable; and it is exactly the value the **Receipt** consumes (ADR 0002, this repo's Receipt builder).
- **Disposition keying.** *Region anchor now* (`region@SHA`, per ADR 0007) vs *brief-local flag id now, region-anchoring deferred*. **Brief-local id, deferred (chosen)** — region-anchoring is only critical once briefs regenerate under the reviewer, which needs the push→regenerate trigger and the persistence layer (ADR 0008), neither of which exists in the local build. Crucially, the store's `disposeFlag(flagIds, disposition)` interface *hides* the key, so swapping id→region later is a localized, caller-free change.
- **Persistence.** *Keep `demoState` beside the store* vs *fold it in*. **Fold in (chosen)** — two state homes synced by effects is the bug-prone pattern being removed. The store is the single source of truth; persistence to `sessionStorage` becomes one effect watching the store, and the persisted value *is* the frozen snapshot the **Receipt** / static **Review Summary** read.

## Decision

1. **A per-brief session store is the client runtime of the Mind-Map Space.** It holds session/domain state only; transient UI state stays local; view preferences move to `useLocalPreference`.
2. **Mechanism: zustand, created in a per-brief React provider** (never a module singleton). Actions are intent-named and headless-testable: `reviewChunk`, `disposeFlag(flagIds[], disposition)` (bulk-first), `reclassifyGroup` (resets that group's checks inside the action), `checkPlaybookItem`, `saveComment / updateComment / deleteComment`, `setOutcome`.
3. **A Disposition is one discriminated union** per flag — `addressed (with evidence) | dismissed (with reason) | open` — replacing the three parallel maps.
4. **Dispositions are keyed by brief-local flag id for now.** Region-anchored keying (ADR 0007, `region@SHA`) is **deferred**; the store interface hides the key so the future swap is caller-free.
5. **`demoState` folds into the store.** The store is the single source of truth; `sessionStorage` persistence is one effect over it, and that persisted snapshot is the frozen input to the **Receipt** builder and the static **Review Summary**.
6. **The store is mode-agnostic.** Reviewer-vs-author differ only in consumer copy, not in stored data.

## Why This Way

Consolidating the session into one store with intent-named actions turns the screen's hardest, currently-untestable behaviour — the coupled review-session invariants — into a small interface that is exercised headlessly, which is the whole point of the refactor: *the interface is the test surface*. zustand specifically (over reducer + context) is chosen for a concrete architectural reason, not preference — selector subscriptions are what let Candidate B's components read the session without a 30-prop drill and without re-rendering the diff table on every keystroke. The Disposition union makes the **Receipt**'s core input honest by construction. And deferring region-anchoring is the disciplined call: it is genuinely critical, but only once regeneration and persistence exist, and doing it half-way now would be rework — so we record the intent rather than fake the capability, exactly as the overlay deferral was handled in ADR 0021.

## Consequences

- **First state-management dependency** (zustand) enters the web app; the tree was previously dep-light (React Query + TanStack only).
- **`BriefApp` dissolves**: ~25 `useState`s sort into ≈8 store fields + local UI state + `useLocalPreference`; ~17 callbacks become ~8 store actions. This is the precondition that makes Candidate B's component split an interface-shrink rather than a prop-bag reshuffle.
- **`demoState.tsx` is removed**; its snapshot becomes a single persistence effect over the store, keyed per brief.
- **Deferred — region-anchored Dispositions.** We intend to address this. Trigger: when push→regenerate (ADR 0006/0020) and the persistence layer (ADR 0008) land, re-key Dispositions from brief-local id to `region@SHA` so they survive regeneration and feed **Carry-over status** (ADR 0007). The change is localized behind `disposeFlag`; a `TODO(adr-0022)` marker sits at the keying boundary.
- **No glossary change**: this implements the existing **Mind-Map Space** term; no new CONTEXT.md vocabulary is introduced.
- **Receipt alignment**: the Disposition union and the frozen snapshot are the inputs the Receipt builder (separate change) consumes, keeping the **Receipt** (ADR 0002) testable as content rather than rendered string.
