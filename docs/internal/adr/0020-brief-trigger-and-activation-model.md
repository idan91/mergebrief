# 0020: Brief Trigger, Entry, and the Draft-First Activation Model

Status: superseded in part by 0032

The word **"Activation"** conflated three independent things across the docs; this ADR splits it into **Trigger** (what fires a Brief compute), **Entry** (how a human reaches a computed Brief), and **Draft-first** (a per-repo opt-in that gates Entry). It fixes the single Trigger model — **eager-on-push, debounced; no lazy "compute-on-first-click" gate** — and reframes draft-first as a gate on *reviewer notification*, never on compute. Resolves the contradiction between ADR 0006 (eager-on-push generation) and the lazy-click "Activation" in the product-backend epic / the old CONTEXT.md glossary. Closes the reshape TODO item "new ADR — draft-first activation."

## Context

"Activation" was critical in three docs that meant different things by it:

- **CONTEXT.md** (old): "the state transition when a human first clicks the deep-link… (or, under draft-first, when the draft opens). Before activation: no compute fires." — a lazy cost gate.
- **The product-backend epic**, workstream 2: "Activation = first deep-link click." — same lazy gate.
- **ADR 0016 #3:** "Activation = one branded comment, delete+repost per debounced generation." — the *entry surface*, not a trigger.
- **ADR 0006 #3:** "Brief generation is debounced (~60s trailing) on push." — eager-on-push, no click required.
- **center-of-gravity.md:** draft-first "reverses the lazy cost gate (compute-on-click → compute-on-every-draft)."

So three concepts wore one word, and two of them (lazy-click vs eager-on-push) directly contradicted. The contradiction blocks M1: the activation/trigger gate cannot be built until the trigger model is singular. The original lazy-click gate existed to bound model spend; under **BYOK-default** (ADR 0013/0016) the adopter pays their own model costs, so that rationale is much weaker, and a cold first-click defeats the pre-warm value story (ADR 0006) — the brief is supposed to already be warm when the reviewer arrives.

## Considered Options

- **Trigger model.** Lazy (first deep-link click activates; nothing computes before) · Eager-on-push debounced (**chosen**) · Mode-dependent (lazy by default, eager under draft-first). Mode-dependent doubles the surface to build and reason about; lazy fights the pre-warm value and was justified by a cost gate that BYOK weakens.
- **A `trigger: on-first-view` YAML knob** for metered self-hosters who want zero spend on unreviewed PRs. **Rejected for M1** — speculative; revisit only if first-run feedback asks for it.
- **Author Entry during the draft window** — a draft-PR comment addressed to the author · web-app-only entry (**chosen**) — a comment on a draft PR is noise on a thread nobody is reviewing and risks pinging watchers before ready.

## Decision

1. **Retire "Activation" as a single term.** Split into **Trigger**, **Entry**, and **Draft-first** (glossary updated in CONTEXT.md).
2. **Trigger = eager-on-push, debounced (~60s, leading edge: the first push fixes the run time and later pushes only swap the head; `packages/persistence/src/stores/ingest.ts`).** A Brief computes on **PR-open (first push) and every subsequent push/synchronize**, including while the PR is a draft. There is **no lazy "compute-on-first-click" gate**, and no `on-first-view` knob in M1.
3. **Spend is bounded below the trigger, not by withholding compute** — by the debounce window, the instance `drafts` policy and the daily generation cap (`spend.maxGenerationsPerDay`, `apps/worker/src/task/generate/logic/spend-gate.ts`), and skipping trivial / instantly-closed PRs. The **Triage** cascade this record first named here (ADR 0010) was never built. BYOK-default means the adopter pays their own model costs.
4. **Entry = the branded PR comment** carrying a deep-link (ADR 0016: delete+repost per debounced generation, one ping per settled head). The deep-link **click is navigation, never a compute trigger.** The reviewer-facing Entry posts **only when the PR is in non-draft / ready state** (amended, see Amendments) — correct GitHub etiquette (don't notify reviewers about a draft), cheap, and reviewer-agnostic.
5. **Draft-first does not change the Trigger** (amended, see Amendments). Because compute is always eager-on-push, draft-first cannot be a different trigger — the Brief already computes while the PR sits in draft (that *is* the author's warm self-review window). Draft-first is a **per-repo opt-in (repo YAML; org default + per-repo override; off by default)** that **holds the reviewer-facing Entry until the author marks `ready_for_review`**. During draft, the author reaches the Brief via the **web app** (no draft-PR comment).
6. **Fail-open via native draft only** (never a custom lock). If generation fails on a draft-first PR, it is a normal GitHub draft the author fully controls and can mark ready themselves; an AI outage must never trap a PR.

## M1 scope

- **In M1:** the uniform Trigger (#2/#3) + reviewer Entry (#4), including the cheap rule that the reviewer comment posts only on ready (not on native drafts). This is reviewer-agnostic "warm artifacts" per the product-backend epic's M1.
- **Deferred** (gated on the step-5 author-side grilling pass): the rich **author self-review window** — the author's brief Entry UI and the author **engagement surface** (commenting *within* the brief's change-group/chunk structure, which GitHub-native comments lack). The `ready_for_review` Entry-suppression mechanic is small and may ride along, but the author UX it serves is held loosely and unbuilt until grilled (reshape; ADR 0009).
- **Deferred to v2:** the author's private **Mind-Map Space** (self/agent notes pre-ready).

## Why This Way

One trigger model is far simpler to build and reason about than a mode switch, and it makes the pre-warm value real: by the time a reviewer (or author) opens the brief, it is already computed. Decoupling Entry from Trigger is what lets draft-first shrink from "a second trigger model" to "a notification gate" — which is both cheaper and more honest about what it actually does. The cost worry that originally justified the lazy gate is handled where it belongs (debounce + the spend knobs + BYOK), not by making the first human wait.

## Consequences

- The product-backend epic's workstream 2 ("Activation = first deep-link click") is **superseded**: the trigger is eager-on-push; the click is pure Entry.
- ADR 0006 (#3 eager-on-push) and ADR 0016 (#3 branded comment) are **ratified and clarified**, not changed: 0006 defines the Trigger, 0016 defines the Entry surface.
- CONTEXT.md: "Activation" retired; **Trigger / Entry / Draft-first** added; Brief definition and Relationships updated; flagged-ambiguity recorded.
- Every PR incurs at least one debounced Brief compute from open onward — acceptable under BYOK + the spend knobs; the `on-first-view` knob is the documented escape hatch if first-run feedback demands it.
- Draft-first's author-facing half stays out of M1; the activation model is decided in full while M1 builds the reviewer half.

## Amendments

### 2026-07-16: Repo YAML is dead; draft-first is absorbed

Per [ADR 0032](0032-repo-local-config-surface.md) (repo-config grill), two corrections. (1) The "repo YAML" #5 references was killed as a *runtime-config* substrate by the instance-level generator config (ADR 0006/0013 amendments, 2026-07-12) and never amended here; repo-local files now exist again under ADR 0032's different contract (`.mergebrief/`, default-branch trust, fail-open). (2) **Draft-first as a distinct per-repo opt-in is retired as absorbed**: #4's universal rule ("Entry posts only on ready") *is* the Entry-holding semantics #5 described, there was no residual difference, and the author-side residual shipped as the own-draft view and mark-ready CTA. #4 was verified unbuilt at grill time (no draft gate in `generate.ts`); it is now implemented as the default of **`entryCommentOnDrafts: false`** in `.mergebrief/settings.yaml` (ADR 0032 #13): the entry comment stays off draft PRs and posts on `ready_for_review`; repos that review drafts opt in with `true`. The "org default + per-repo override" layering in #5 is dead (no org config layer exists).

### 2026-07-17: Draft generation policy, below the trigger

#2/#3 amended with operator spend knobs, both **below the trigger** (the trigger model itself is unchanged): instance config gains a **`drafts` block**: `generate: on|off` (default on; off = draft events are state-only and the FIRST brief arrives on `ready_for_review`) and optional `debounceSeconds` (a long trailing window for draft **re**generations only; damping applies once a prior brief SUCCEEDED, so a draft's first brief keeps the normal window; unset = no damping, the default after the ticket's damp-by-default intent was reversed on UX grounds). `ready_for_review` now always enqueues on a short constant (~10s) flip window; a just-readied PR should be fresh when the reviewer arrives; supersession abort (ADR 0006 #6) covers pushes landing after it. Mechanically: `mergebrief.config.yaml` is read by **two processes**, the worker's full loader (which validates the whole file) and the api's boot wiring via a **narrow loader** (`loadInstancePolicy`: the `drafts` key only, no adapter validation, no provider keys; `packages/generators/src/config/instancePolicy.ts`, `apps/api/src/boot/index.ts`), because the policy enforces at the ENQUEUE path (api), not at drain. The `on-first-view` knob stays rejected/documented-only.

### 2026-10-20: The Entry comment posts on drafts by default

The 2026-07-16 default flipped on 2026-09-15 (ADR 0032 as amended): `entryCommentOnDrafts` defaults to `true` (`packages/repo-config/src/schemas.ts`), so the Entry posts on draft PRs unless the repo opts out with `false`, and an explicit `false` sweeps a lingering comment (`apps/worker/src/task/generate/logic/entry-comment-gate.ts`). In practice every PR opens as a draft and the Entry is the reader's way into the brief. #4's "only when ready" rule is the opt-out posture, not the default; url-box jobs never post.

### 2026-10-24: An untrusted author's PR waits for a collaborator

#2 amended: the Trigger stays eager-on-push for every PR whose author is on the repository's team (the reviewer trust rule) and for a bot the repository lists in `trustedBots`. Any other author's PR computes nothing on push: its head waits as `awaiting-trigger`, the Entry says a brief is available on demand, and a collaborator with push access starts the first brief from MergeBrief. That click is the approval and holds for the PR, so every later push computes eagerly again. The deep-link click itself is still navigation, never a trigger (#4).

