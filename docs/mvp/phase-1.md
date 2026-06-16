# Phase 1 — Dogfood the Real Tool (Reviewer-Behavior Validation)

> **Rewritten 2026-06 — supersedes the Wizard-of-Oz Treatment-vs-B′ design (retained in git history).** The original plan isolated the **playbook** layer (Treatment = grouping + taxonomy + playbooks + risk-surface vs Baseline B′ = grouping only). Both of its premises are now gone: the 2026-06 reshape **demoted the playbook** (no layer left to isolate), and the **categorizer is built and gold-checked** (no need to hand-label an artifact the tool can generate). This plan validates the *new* center of gravity — **does story + risk-surface + delta change reviewer behavior** — by dogfooding the real tool, with the **delta re-review** as the primary test and **peer usage** as the kill criterion.

## What this tests

- **Unknown C (reviewer behavior):** does the brief — especially the **Delta Brief** on re-review — change how reviewers engage versus their status-quo GitHub review?
- **Kill criterion (useful-tool-first):** do peers *keep reaching for it* on real PRs once it's available? Voluntary repeat usage is the signal — not a polite debrief, not willingness-to-pay.

The baseline is the reviewer's **current GitHub review**, not a stripped rendering. We are past "beats raw diff is plausible"; the question is whether the real artifact moves real behavior enough that people choose it unprompted.

## Primary test — the delta re-review (promoted from side-probe to headline)

The lead value is the re-review reload (center-of-gravity, 3/3 vivid in interviews), so it is the primary behavioral test, not a footnote:

1. Pick a real PR with genuine follow-up-commit history (SHA1 → … → SHA2).
2. Reviewer reviews at SHA1 with the brief, submits (this sets their Checkpoint).
3. The author's real follow-up commits land. Reviewer returns and re-reviews at SHA2 **with the Delta Brief**.
4. **Observe:** do they engage the **Reopened** items / changed groups / orphaned comments — or skim-approve on the back of their prior review?

This is the existential question for the wedge: does the delta defeat the re-review rubber-stamp? If it does not move *this*, the headline value is wrong, regardless of how the first-review brief performs.

## Secondary signals — first-review full brief

On first review (full brief vs status-quo GitHub):
- **Navigation** — do they use the story/change-groups to choose where to focus, or scroll the diff linearly?
- **Risk attention** — do risk-surface-flagged chunks draw more scrutiny?
- **Acceptability** — "would you want this on every PR?"

## Method — dogfood, don't Wizard-of-Oz

- **Run the real categorizer** on real PRs (tool generates brief + delta; ~$0.46/PR). No hand-labeling.
- **Reviewers:** 3–5 senior / staff / tech-lead engineers. Rationale unchanged — hardest to move (refined instincts, less naive rubber-stamping), closest to the buyer persona, and the exact rubber-stamp pool (seniors approving small follow-ups / AI-authored chunks) the product targets. Junior cohort deferred to Phase 1.5 (the skill-atrophy angle).
- **Observation:** async screen recording (~10 min/PR, silent — no think-aloud, avoids observation-effect) + a 15-min debrief (watch at 2× first, probe 3–5 moments: "what made you slow down," "did you notice X," "worth it on every PR"). The debrief doubles as a discovery interview — append the PMF questions *after* the task, never before (anchoring).
- **Honesty disciplines (kept — they are cheap):** neutral framing ("a format we're trying"), don't reveal what you're rooting for, weight observed behavior over self-report. The kill criterion — voluntary repeat usage — is the hardest-to-fake signal of all.

## Working PR set

Real PRs to run the tool on. The **delta test requires PRs with real follow-up-commit history** (a SHA1→SHA2 with substantive follow-ups), so bias selection toward PRs that actually had review-then-fix cycles.

- **Primary calibration PR — medusa #15605** (`validate http(s) scheme on fulfillment label URLs`, 8 files, +77/−17). Already gold-checked against `briefs/medusa-15605.md`. Clean dominant `new-feature` with a security-hardening framing tension — a good first dogfood.
- **Backup — drizzle-orm #5331** (introspection refactor + progress callbacks; +254/−146). Bundles `logic-refactor` + `new-feature`; heavier; schema-aware so risk-surface flags fire.

Find more candidates (clean dominant categories, ~4–12 files, +80–400):

```bash
gh pr list --repo <owner>/<repo> --state merged --limit 50 \
  --json number,title,additions,deletions,changedFiles \
  --jq '.[] | select(.changedFiles >= 4 and .changedFiles <= 12 and .additions >= 80 and .additions <= 400) |
        "#\(.number) | files:\(.changedFiles) | +\(.additions)/-\(.deletions) | \(.title)"'
```

Good source repos (varied change types): `vercel/next.js`, `drizzle-team/drizzle-orm`, `shadcn-ui/ui`, `vercel/turbo`, `tanstack/query`, `prisma/prisma`, `microsoft/TypeScript`.

## Interim dogfood surface

The full web app does not exist yet. Reviewers see real briefs via the React app (`apps/web`) wired to generated `out/*.brief.json` + `*.diffs.json`, or — for the delta test — a brief at SHA1 and a Delta Brief at SHA2. This is the cheapest way to get the *real artifact* in front of seniors before the GitHub-App/web-app product is built.

## What changed from the old plan

- **Dropped:** Treatment/B′ conditions, the B′ stripped rendering, ~8h pre-registered hand-labeling, blind cross-condition scoring. All existed only to isolate the now-demoted playbook.
- **Changed:** baseline = status-quo GitHub review (not B′); artifact = real tool output (not hand-labels); the **delta re-review is the primary test** (was "Track 3, a side probe"); the gate is **peer usage + visible behavior movement** (not a pre-registered detection delta).
- **Kept:** senior-only cohort + rationale, async-record + debrief, neutral framing, the "every PR?" guardrail, PR sourcing.

## Open questions

- **Go/no-go floor.** Directional, not clinical — but set a minimum before concluding: e.g., the delta test on ≥3 real follow-up PRs with ≥3 seniors, plus at least one peer who reaches for it again unprompted.
- **Recovery move if it fails.** Delta doesn't move re-review behavior → is the headline wrong, or is the *delta rendering* wrong (fixable) vs the *concept* wrong (fatal)? Separate those before killing.
