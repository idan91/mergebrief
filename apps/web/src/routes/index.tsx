import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { localBriefQueryOptions } from "../features/brief/queries";
import type { Brief, BriefChunk, Category, Concern } from "../features/brief/types";
import { buildBriefViewModel, groupRiskByAttribute, type BriefViewModel, type GroupView, type RiskFlag } from "../features/brief/viewModel";

type ViewMode = "story" | "concerns";
type LayoutMode = "stacked" | "split";
type CheckBucket = `carrier:${string}` | `support:${string}:${Concern}`;
type FlagStatus = "open" | "addressed" | "dismissed";

interface FlagState {
  status: FlagStatus;
  reason: string;
}

interface DismissTarget {
  flagIds: string[];
  label: string;
}

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(localBriefQueryOptions()),
  component: BriefApp,
  errorComponent: BriefError,
});

function BriefApp() {
  const brief = useSuspenseQuery(localBriefQueryOptions()).data;
  const model = useMemo(() => buildBriefViewModel(brief), [brief]);
  const initialDominants = useMemo(() => Object.fromEntries(model.groups.map((group) => [group.id, group.group.dominantCategory])), [model.groups]);
  const [viewMode, setViewMode] = useState<ViewMode>("story");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("stacked");
  const [collapseSupporting, setCollapseSupporting] = useState(true);
  const [openChunks, setOpenChunks] = useState<Set<string>>(() => new Set(model.groups.flatMap((group) => group.carrierChunks.map((chunk) => chunk.id))));
  const [reviewedChunks, setReviewedChunks] = useState<Set<string>>(() => new Set());
  const [checkedItems, setCheckedItems] = useState<Record<CheckBucket, Set<number>>>(() => ({}));
  const [dominants, setDominants] = useState<Record<string, Category>>(initialDominants);
  const [reclassifiedGroups, setReclassifiedGroups] = useState<Set<string>>(() => new Set());
  const [flagStates, setFlagStates] = useState<Record<string, FlagState>>(() => Object.fromEntries(model.flags.map((flag) => [flag.id, { status: "open", reason: "" }])));
  const [selectedRiskFlags, setSelectedRiskFlags] = useState<Set<string>>(() => new Set());
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<DismissTarget | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissWarned, setDismissWarned] = useState(false);
  const [toast, setToast] = useState("");

  const totals = useMemo(() => summarizeProgress(model, checkedItems, reviewedChunks, flagStates, dominants), [checkedItems, dominants, flagStates, model, reviewedChunks]);
  const totalWork = model.flags.length + brief.chunks.length;
  const progress = totalWork === 0 ? 0 : ((totals.reviewed + totals.flagsResolved) / totalWork) * 100;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (viewMode !== "story" || layoutMode !== "split") return;
    const updateActive = () => {
      const readingLine = 150;
      const current = brief.chunks.find((chunk) => {
        const element = document.getElementById(chunk.id);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top <= readingLine && rect.bottom > readingLine;
      });
      if (current) setActiveChunkId(current.id);
    };
    window.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
    return () => window.removeEventListener("scroll", updateActive);
  }, [brief.chunks, layoutMode, viewMode]);

  function toggleCheck(bucket: CheckBucket, index: number) {
    setCheckedItems((current) => {
      const next = { ...current };
      const bucketSet = new Set(next[bucket] ?? []);
      if (bucketSet.has(index)) bucketSet.delete(index);
      else bucketSet.add(index);
      next[bucket] = bucketSet;
      return next;
    });
  }

  function toggleChunk(chunkId: string) {
    setOpenChunks((current) => toggleSet(current, chunkId));
    setActiveChunkId(chunkId);
  }

  function markReviewed(chunkId: string) {
    setReviewedChunks((current) => toggleSet(current, chunkId));
    setOpenChunks((current) => {
      const next = new Set(current);
      next.delete(chunkId);
      return next;
    });
  }

  function jumpToChunk(chunkId: string) {
    setViewMode("story");
    setOpenChunks((current) => new Set(current).add(chunkId));
    setActiveChunkId(chunkId);
    window.setTimeout(() => document.getElementById(chunkId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function chooseDominant(groupId: string, category: Category) {
    setDominants((current) => ({ ...current, [groupId]: category }));
    setReclassifiedGroups((current) => new Set(current).add(groupId));
    setCheckedItems((current) => ({ ...current, [`carrier:${groupId}`]: new Set() }));
    setToast(`Dominant category set to ${category} — recorded on the receipt.`);
  }

  function setFlagStatus(flag: RiskFlag, status: FlagStatus, reason = "") {
    setFlagStatuses([flag.id], status, reason);
  }

  function setFlagStatuses(flagIds: string[], status: FlagStatus, reason = "") {
    if (flagIds.length === 0) return;
    setFlagStates((current) => {
      const next = { ...current };
      for (const flagId of flagIds) {
        next[flagId] = { status, reason };
      }
      return next;
    });
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      for (const flagId of flagIds) {
        next.delete(flagId);
      }
      return next;
    });
  }

  function toggleRiskFlag(flagId: string) {
    setSelectedRiskFlags((current) => toggleSet(current, flagId));
  }

  function toggleRiskGroup(flagIds: string[]) {
    setSelectedRiskFlags((current) => {
      const allSelected = flagIds.length > 0 && flagIds.every((flagId) => current.has(flagId));
      const next = new Set(current);
      for (const flagId of flagIds) {
        if (allSelected) next.delete(flagId);
        else next.add(flagId);
      }
      return next;
    });
  }

  function confirmDismiss() {
    if (!dismissTarget) return;
    const reason = dismissReason.trim();
    if (reason.length < 12 && !dismissWarned) {
      setDismissWarned(true);
      return;
    }
    setFlagStatuses(dismissTarget.flagIds, "dismissed", reason || "(no reason given)");
    const dismissedCount = dismissTarget.flagIds.length;
    setDismissTarget(null);
    setDismissReason("");
    setDismissWarned(false);
    setToast(dismissedCount === 1 ? "Dismissed. Reason recorded verbatim on the receipt." : `${dismissedCount} flags dismissed. Reason recorded verbatim on the receipt.`);
  }

  return (
    <>
      <Header brief={brief} model={model} totals={totals} progress={progress} locOpen={locOpen} setLocOpen={setLocOpen} openReceipt={() => setReceiptOpen(true)} />
      <main className={layoutMode === "split" && viewMode === "story" ? "main split-main" : "main"}>
        <section className="pr-summary reveal">
          <div className="eyebrow">Brief</div>
          <Markdown content={brief.summary} />
          <button className="description-toggle" type="button" onClick={() => setDescriptionOpen(!descriptionOpen)}>
            {descriptionOpen ? "Hide original PR description" : "Show original PR description"}
          </button>
          {descriptionOpen ? (
            <div className="pr-description">
              <div className="eyebrow">Original PR description</div>
              <Markdown content={brief.pr.description || "_No PR description provided._"} />
            </div>
          ) : null}
        </section>

        <Toolbar viewMode={viewMode} setViewMode={setViewMode} layoutMode={layoutMode} setLayoutMode={setLayoutMode} />

        {viewMode === "story" ? (
          <StoryView
            brief={brief}
            model={model}
            activeChunkId={activeChunkId}
            checkedItems={checkedItems}
            collapseSupporting={collapseSupporting}
            dominants={dominants}
            flagStates={flagStates}
            openChunks={openChunks}
            reclassifiedGroups={reclassifiedGroups}
            reviewedChunks={reviewedChunks}
            selectedRiskFlags={selectedRiskFlags}
            chooseDominant={chooseDominant}
            jumpToChunk={jumpToChunk}
            markReviewed={markReviewed}
            setCollapseSupporting={setCollapseSupporting}
            setDismissTarget={(target) => {
              setDismissTarget(target);
              setDismissReason("");
              setDismissWarned(false);
            }}
            setFlagStatus={setFlagStatus}
            setFlagStatuses={setFlagStatuses}
            setToast={setToast}
            toggleCheck={toggleCheck}
            toggleChunk={toggleChunk}
            toggleRiskFlag={toggleRiskFlag}
            toggleRiskGroup={toggleRiskGroup}
          />
        ) : (
          <ConcernView brief={brief} model={model} jumpToChunk={jumpToChunk} />
        )}
      </main>
      <Footer />
      <ReceiptDrawer
        brief={brief}
        model={model}
        checkedItems={checkedItems}
        dominants={dominants}
        flagStates={flagStates}
        open={receiptOpen}
        reclassifiedGroups={reclassifiedGroups}
        reviewedChunks={reviewedChunks}
        close={() => setReceiptOpen(false)}
        submit={() => {
          setReceiptOpen(false);
          setToast("Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.");
        }}
      />
      <DismissModal
        target={dismissTarget}
        reason={dismissReason}
        warned={dismissWarned}
        cancel={() => setDismissTarget(null)}
        confirm={confirmDismiss}
        setReason={setDismissReason}
      />
      <div className={toast ? "toast show" : "toast"}>{toast}</div>
    </>
  );
}

function Header({
  brief,
  model,
  totals,
  progress,
  locOpen,
  setLocOpen,
  openReceipt,
}: {
  brief: Brief;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  locOpen: boolean;
  setLocOpen: (value: boolean) => void;
  openReceipt: () => void;
}) {
  return (
    <header>
      <div className="wordmark">
        Brief<span> / review</span>
      </div>
      <div className="prmeta">
        <div className="title">{brief.pr.title}</div>
        <div className="sub">
          <b>{brief.pr.repo}</b> ·{" "}
          <a className="ghlink" href={brief.pr.url} target="_blank" rel="noreferrer">
            #{brief.pr.number} ↗
          </a>{" "}
          · local brief @ {brief.pr.sha.slice(0, 7)}
        </div>
      </div>
      <div className="hdr-stats">
        <button className={locOpen ? "stat loc-badge open" : "stat loc-badge"} type="button" onClick={() => setLocOpen(!locOpen)}>
          <span className="statlabel">adjusted lines</span>
          <b>
            <span className="green">+{model.totalAdded}</span> <span className="faint">/</span> <span className="red">−{model.totalDeleted}</span>
          </b>
          <span className="loc-pop">
            <b>Adjusted ≈ git for this local brief.</b>
            <br />
            Move detection is not in the current categorizer output, so moved/generated exclusions are not claimed yet.
          </span>
        </button>
        <div className="stat">
          chunks<b>{totals.reviewed}/{totals.chunkTotal}</b>
        </div>
        <div className="stat">
          flags<b>{totals.flagsResolved}/{totals.flagTotal}</b>
        </div>
      </div>
      <button className="btn primary" type="button" onClick={openReceipt}>
        Receipt
      </button>
      <div className="progress-bar" style={{ width: `${progress}%` }} />
    </header>
  );
}

function Toolbar({
  viewMode,
  setViewMode,
  layoutMode,
  setLayoutMode,
}: {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
}) {
  return (
    <div className="toolbar reveal">
      <div className="viewbar">
        <button className={viewMode === "story" ? "active" : ""} type="button" onClick={() => setViewMode("story")}>
          Story
        </button>
        <button className={viewMode === "concerns" ? "active" : ""} type="button" onClick={() => setViewMode("concerns")}>
          Concerns
        </button>
      </div>
      <div className="viewbar layoutbar">
        <button className={layoutMode === "stacked" ? "active" : ""} type="button" onClick={() => setLayoutMode("stacked")}>
          Stacked
        </button>
        <button className={layoutMode === "split" ? "active" : ""} type="button" onClick={() => setLayoutMode("split")}>
          Side by side
        </button>
      </div>
    </div>
  );
}

function StoryView(props: {
  brief: Brief;
  model: BriefViewModel;
  activeChunkId: string | null;
  checkedItems: Record<CheckBucket, Set<number>>;
  collapseSupporting: boolean;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  openChunks: Set<string>;
  reclassifiedGroups: Set<string>;
  reviewedChunks: Set<string>;
  selectedRiskFlags: Set<string>;
  chooseDominant: (groupId: string, category: Category) => void;
  jumpToChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  setCollapseSupporting: (value: boolean) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setFlagStatus: (flag: RiskFlag, status: FlagStatus, reason?: string) => void;
  setFlagStatuses: (flagIds: string[], status: FlagStatus, reason?: string) => void;
  setToast: (message: string) => void;
  toggleCheck: (bucket: CheckBucket, index: number) => void;
  toggleChunk: (chunkId: string) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
}) {
  return (
    <div className="story-view">
      <div className="chunks-label reveal">
        <span>{props.brief.chunks.length} chunks · grouped by intent</span>
        <span className="rule" />
        <label className="switch">
          <input checked={props.collapseSupporting} suppressHydrationWarning type="checkbox" onChange={(event) => props.setCollapseSupporting(event.target.checked)} />
          <span className="track" />
          Collapse supporting
        </label>
      </div>
      {props.model.groups.map((group) => (
        <section className="story-group reveal" key={group.id}>
          <div className="group-chunks">
            {group.chunks.map((chunk) => (
              <ChunkCard
                key={chunk.id}
                active={props.activeChunkId === chunk.id}
                chunk={chunk}
                forceCollapsed={props.collapseSupporting && chunk.role === "supporting" && !props.openChunks.has(chunk.id)}
                open={props.openChunks.has(chunk.id)}
                reviewed={props.reviewedChunks.has(chunk.id)}
                markReviewed={props.markReviewed}
                toggleChunk={props.toggleChunk}
              />
            ))}
          </div>
          <GroupCard {...props} group={group} />
        </section>
      ))}
    </div>
  );
}

function GroupCard({
  group,
  checkedItems,
  dominants,
  flagStates,
  model,
  reclassifiedGroups,
  selectedRiskFlags,
  chooseDominant,
  jumpToChunk,
  setDismissTarget,
  setFlagStatus,
  setFlagStatuses,
  setToast,
  toggleCheck,
  toggleRiskFlag,
  toggleRiskGroup,
}: {
  group: GroupView;
  checkedItems: Record<CheckBucket, Set<number>>;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  model: BriefViewModel;
  reclassifiedGroups: Set<string>;
  selectedRiskFlags: Set<string>;
  chooseDominant: (groupId: string, category: Category) => void;
  jumpToChunk: (chunkId: string) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setFlagStatus: (flag: RiskFlag, status: FlagStatus, reason?: string) => void;
  setFlagStatuses: (flagIds: string[], status: FlagStatus, reason?: string) => void;
  setToast: (message: string) => void;
  toggleCheck: (bucket: CheckBucket, index: number) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
}) {
  const dominant = dominants[group.id] ?? group.group.dominantCategory;
  const groupFlags = model.flags.filter((flag) => flag.groupId === group.id);
  const isReclassified = reclassifiedGroups.has(group.id);

  return (
    <article className="group-card reveal">
      <div className="group-head">
        <div className="group-eyebrow">
          <span className="gnum">Change-group {group.index + 1} of {model.groups.length}</span>
          <span className="gloc">
            <span className="green">+{group.added}</span> / <span className="red">−{group.deleted}</span> · {group.carrierChunks.length} carrier · {group.supportingChunks.length} supporting
          </span>
        </div>
        <h2 className="group-title">{group.group.title}</h2>
        <p className="group-summary">{group.group.summary}</p>
        <div className="cat-row">
          <span className="chip dominant"><em>dominant</em> {dominant}</span>
          {group.group.secondaryCategories.map((category) => (
            <span className="chip" key={category}>secondary {category}</span>
          ))}
          {group.group.uncertain && !isReclassified ? <span className="chip uncertain">uncertain</span> : null}
          {isReclassified ? <span className="reclass-note">set by you · recorded on receipt</span> : null}
        </div>
        {group.group.uncertain && !isReclassified ? (
          <div className="uncertain-panel">
            <span className="q">
              The categorizer is split on this group’s intent: <b>{group.group.uncertainBetween.join(" vs ")}</b>. Your call; the receipt records the override.
            </span>
            <span className="pick">
              {group.group.uncertainBetween.map((category) => (
                <button className="pickbtn" key={category} type="button" onClick={() => chooseDominant(group.id, category)}>
                  {category}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      <div className="group-body">
        <div className="flags">
          <div className="label">Risk surface — {groupFlags.length} flags <span className="count">attributes, not verdicts</span></div>
          {groupFlags.length === 0 ? <p className="empty">No risk-surface attributes on this group.</p> : null}
          {groupRiskByAttribute(groupFlags).map((riskGroup) => {
            const openRiskFlagIds = riskGroup.flags.filter((flag) => (flagStates[flag.id]?.status ?? "open") === "open").map((flag) => flag.id);
            const selectedCount = openRiskFlagIds.filter((flagId) => selectedRiskFlags.has(flagId)).length;
            const allSelected = openRiskFlagIds.length > 0 && selectedCount === openRiskFlagIds.length;
            const hasSelection = selectedCount > 0;
            return (
              <div className="risk-group" key={riskGroup.attr}>
                <div className="risk-group-head">
                  <label className="risk-check">
                    <input checked={allSelected} disabled={openRiskFlagIds.length === 0} suppressHydrationWarning type="checkbox" onChange={() => toggleRiskGroup(openRiskFlagIds)} />
                    <span className="risk-group-title">{riskGroup.attr}</span>
                  </label>
                  <div className="risk-bulk-actions">
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      type="button"
                      onClick={() => {
                        setFlagStatuses(openRiskFlagIds.filter((flagId) => selectedRiskFlags.has(flagId)), "addressed");
                        setToast(`${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} marked addressed — pair with review comments before submit.`);
                      }}
                    >
                      Address selected
                    </button>
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      type="button"
                      onClick={() => {
                        setDismissTarget({
                          flagIds: openRiskFlagIds.filter((flagId) => selectedRiskFlags.has(flagId)),
                          label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                        });
                      }}
                    >
                      Dismiss selected…
                    </button>
                  </div>
                </div>
                <div className="risk-files">
                  {riskGroup.flags.map((flag) => {
                    const state = flagStates[flag.id] ?? { status: "open", reason: "" };
                    const isResolved = state.status !== "open";
                    return (
                      <div className={`flag ${isResolved ? `resolved ${state.status}` : ""}`} key={flag.id}>
                        <div className="frow">
                          <input
                            aria-label={`Select ${flag.attr} flag for ${flag.file}`}
                            checked={!isResolved && selectedRiskFlags.has(flag.id)}
                            className="flag-check"
                            disabled={isResolved}
                            suppressHydrationWarning
                            type="checkbox"
                            onChange={() => toggleRiskFlag(flag.id)}
                          />
                          <button className="floc full-path" type="button" onClick={() => jumpToChunk(flag.chunkId)}>{flag.file}</button>
                          {isResolved ? <span className="fstate compact">{state.status}</span> : null}
                        </div>
                        {!isResolved ? (
                          <>
                            <div className="fdesc">{flag.description}</div>
                            <div className="factions">
                              <button className="fbtn" type="button" onClick={() => {
                                setFlagStatus(flag, "addressed");
                                setToast("Flag marked addressed — pair it with a comment before submit.");
                              }}>Addressed</button>
                              <button className="fbtn" type="button" onClick={() => setDismissTarget({ flagIds: [flag.id], label: `${flag.attr} @ ${flag.file}` })}>Dismiss…</button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function ChunkCard({
  chunk,
  active,
  open,
  reviewed,
  forceCollapsed,
  toggleChunk,
  markReviewed,
}: {
  chunk: BriefChunk;
  active: boolean;
  open: boolean;
  reviewed: boolean;
  forceCollapsed: boolean;
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
}) {
  const expanded = open && !forceCollapsed;
  return (
    <article className={`chunk ${expanded ? "open" : ""} ${reviewed ? "reviewed" : ""} ${active ? "current" : ""}`} id={chunk.id}>
      <button className="chunk-head" type="button" onClick={() => toggleChunk(chunk.id)}>
        <span className="tw">▶</span>
        <span className="cfile">{chunk.file}</span>
        <span className="cchips">
          {chunk.riskSurface.map((risk) => <span className="cc risk" key={risk}>{risk}</span>)}
          <span className={`cc concern-${chunk.concern}`}><span className="dot" />{chunk.concern}{chunk.role === "carrier" ? " · carrier" : ""}</span>
          <span className="cc loc"><span className="a">+{chunk.loc.added}</span> <span className="d">−{chunk.loc.deleted}</span></span>
        </span>
      </button>
      <div className="chunk-actions">
        <button className="markbtn" type="button" onClick={() => markReviewed(chunk.id)}>{reviewed ? "Reviewed ✓" : "Mark reviewed"}</button>
      </div>
      {!expanded ? <div className="collapse-note">{chunk.role === "supporting" ? "supporting chunk — collapsed" : "collapsed"}</div> : null}
      {expanded ? (
        <div className="chunk-body">
          <DiffTable chunk={chunk} />
        </div>
      ) : null}
    </article>
  );
}

function DiffTable({ chunk }: { chunk: BriefChunk }) {
  if (!chunk.diff || chunk.diff.length === 0) {
    return (
      <div className="metadata-diff">
        <span>diff unavailable</span>
        <p>The brief loaded, but no matching raw diff was available for this chunk. The durable fix is to emit chunk-level hunk rows from the categorizer.</p>
      </div>
    );
  }

  return (
    <table className="diff">
      <tbody>
        {chunk.diff.map((line, index) => {
          if (line.kind === "hunk" || line.kind === "note") {
            return (
              <tr className={line.kind} key={`${line.kind}-${index}`}>
                <td colSpan={3}>{line.content}</td>
              </tr>
            );
          }
          const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
          return (
            <tr className={line.kind} key={`${line.kind}-${index}`}>
              <td className="ln">{line.oldLine ?? ""}</td>
              <td className="ln">{line.newLine ?? ""}</td>
              <td className="code"><span className="sign">{sign}</span>{line.content}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConcernView({ brief, model, jumpToChunk }: { brief: Brief; model: BriefViewModel; jumpToChunk: (chunkId: string) => void }) {
  const totalTouched = Math.max(1, model.totalAdded + model.totalDeleted);
  return (
    <section className="concern-view">
      <div className="concern-intro reveal">
        <div className="eyebrow">Attention split</div>
        <p>The same {brief.chunks.length} chunks, pivoted by artifact instead of intent.</p>
      </div>
      {brief.concernView.map((rollup) => {
        const chunks = model.concernChunks.get(rollup.concern) ?? [];
        const pct = ((rollup.added + rollup.deleted) / totalTouched) * 100;
        return (
          <article className="concern-bucket reveal" key={rollup.concern}>
            <div className="cb-head">
              <span className="cb-name"><span className="dot" />{rollup.concern}</span>
              <span className="cb-loc"><span className="a">+{rollup.added}</span> <span className="d">−{rollup.deleted}</span></span>
              <span className="cb-count">{chunks.length} chunk{chunks.length === 1 ? "" : "s"}</span>
            </div>
            <div className="cb-bar"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
            <div className="cb-files">
              {chunks.map((chunk) => (
                <button key={chunk.id} type="button" onClick={() => jumpToChunk(chunk.id)}>
                  {chunk.file} <span className="floc2">· <span className="a">+{chunk.loc.added}</span> <span className="d">−{chunk.loc.deleted}</span></span>
                </button>
              ))}
            </div>
          </article>
        );
      })}
      <div className="concern-bucket muted reveal">
        <div className="cb-head"><span className="cb-name muted-name">empty concerns</span><span className="cb-count">generated · spec · config may be absent from this local brief</span></div>
      </div>
    </section>
  );
}

function ReceiptDrawer(props: {
  brief: Brief;
  model: BriefViewModel;
  checkedItems: Record<CheckBucket, Set<number>>;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  open: boolean;
  reclassifiedGroups: Set<string>;
  reviewedChunks: Set<string>;
  close: () => void;
  submit: () => void;
}) {
  const totals = summarizeProgress(props.model, props.checkedItems, props.reviewedChunks, props.flagStates, props.dominants);
  const dismissed = props.model.flags.filter((flag) => props.flagStates[flag.id]?.status === "dismissed");
  const addressed = props.model.flags.filter((flag) => props.flagStates[flag.id]?.status === "addressed");
  const open = props.model.flags.filter((flag) => (props.flagStates[flag.id]?.status ?? "open") === "open");

  return (
    <>
      <button aria-label="Close receipt" className={props.open ? "scrim show" : "scrim"} type="button" onClick={props.close} />
      <aside className={props.open ? "receipt show" : "receipt"}>
        <div className="receipt-inner">
          <div className="receipt-title"><h2>Verification receipt</h2><span className="tag">not an approval</span></div>
          <div className="receipt-sub">Frozen at submit · linked from a one-line signature on your normal GitHub review · the review itself stays yours</div>
          <pre className="receipt-body">{`Reviewed by @you (human) · ${props.brief.pr.repo} #${props.brief.pr.number} @ ${props.brief.pr.sha.slice(0, 7)}
Tool verification receipt — mechanical claims only

  ${totals.reviewed >= totals.chunkTotal ? "✓" : "•"} chunks read: ${totals.reviewed}/${totals.chunkTotal}
  ${addressed.length + dismissed.length >= props.model.flags.length ? "✓" : "•"} risk surface: ${addressed.length} addressed · ${dismissed.length} dismissed · ${open.length} open
${dismissed.map((flag) => `      dismissed: ${flag.attr} @ ${shortFile(flag.file)} — "${props.flagStates[flag.id]?.reason ?? ""}"`).join("\n")}
${open.map((flag) => `      open: ${flag.attr} @ ${shortFile(flag.file)} — not addressed, not dismissed`).join("\n")}
${props.reclassifiedGroups.size > 0 ? `\n  ${props.reclassifiedGroups.size} group reclassified by reviewer` : ""}

  not checked: business intent · runtime behavior · performance under load · integration with downstream systems`}</pre>
          <div className="receipt-actions">
            <button className="btn primary" type="button" onClick={props.submit}>Submit review to GitHub</button>
            <button className="btn" type="button" onClick={props.close}>Keep reviewing</button>
            <span className="receipt-note">Scoped to mechanical claims. The approve / request-changes verdict is yours alone.</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function DismissModal({
  target,
  reason,
  warned,
  cancel,
  confirm,
  setReason,
}: {
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
  cancel: () => void;
  confirm: () => void;
  setReason: (reason: string) => void;
}) {
  return (
    <div className={target ? "modal show" : "modal"}>
      <div className="modal-box">
        <h3>Dismiss flag</h3>
        <div className="mattr">{target?.label}</div>
        <textarea suppressHydrationWarning value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this flag not actionable here? Your reason lands on the receipt, verbatim." />
        <div className={warned ? "modal-warn show" : "modal-warn"}>Thin reason on a flag — it will appear on the receipt exactly as written. Dismiss anyway?</div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={cancel}>Cancel</button>
          <button className="btn primary" type="button" onClick={confirm}>{warned ? "Dismiss anyway" : "Dismiss with reason"}</button>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return <footer>Live TanStack Start rewrite · local brief fetched from tools/categorizer/out. No AI-authored review prose ships from this surface.</footer>;
}

function Markdown({ content }: { content: string }) {
  return <div className="markdown">{parseMarkdown(content).map((block) => block)}</div>;
}

function parseMarkdown(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item) => <li key={item}>{renderInline(item)}</li>)}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(<h4 key={`h4-${blocks.length}`}>{renderInline(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`h3-${blocks.length}`}>{renderInline(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushParagraph();
      list.push(trimmed.slice(2));
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={`${token}-${match.index}`}>{token.slice(1, -1)}</code>);
    else nodes.push(<strong key={`${token}-${match.index}`}>{token.slice(2, -2)}</strong>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function BriefError({ error }: { error: Error }) {
  return (
    <main className="main">
      <section className="error-state">
        <h1>Brief failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}

interface ProgressTotals {
  playbookChecked: number;
  playbookTotal: number;
  reviewed: number;
  chunkTotal: number;
  flagsResolved: number;
  flagTotal: number;
}

function summarizeProgress(model: BriefViewModel, checkedItems: Record<CheckBucket, Set<number>>, reviewedChunks: Set<string>, flagStates: Record<string, FlagState>, dominants: Record<string, Category>): ProgressTotals {
  void checkedItems;
  void dominants;
  const flagsResolved = Object.values(flagStates).filter((flag) => flag.status !== "open").length;

  return {
    playbookChecked: 0,
    playbookTotal: 0,
    reviewed: reviewedChunks.size,
    chunkTotal: model.groups.reduce((total, group) => total + group.chunks.length, 0),
    flagsResolved,
    flagTotal: model.flags.length,
  };
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
