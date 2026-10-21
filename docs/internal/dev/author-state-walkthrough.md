# BRIEF-43 author-state affordances — explicit walkthrough

One continuous end-to-end pass over the merged BRIEF-43 stack (#101 → #102 →
#103 → #104 → #106), exercising the own-draft self-review surface: the
state-derived affordances (ADR 0031), the mark-ready handoff, the soft gate,
and per-comment post-now. Run it top to bottom; each step names the exact
URL/action, what you must see, and where to look when it doesn't.

The whole point of this feature is **behavior follows visible state**, never a
mode toggle — so most checks are "does the affordance appear/disappear exactly
when the state says it should." The word "mode" must appear nowhere in the UI.

Estimated time: ~25–35 min including one generation wait. Needs live auth; no
extra spend beyond the one Brief generation.

---

## 0. Prerequisites

- The deployed stack running per [`brief-19-smoke.md`](post-merge-smoke.md)
  §1–2 (compose up, ngrok tunnel, dev App webhook + callback URLs set). The
  worker must be running — this feature only lights up on a **draft PR with a
  generated Brief**.
- A **test repository** where the dev App is installed.
- **Two GitHub accounts** the App can see the repo through:
  - `AUTHOR` — opens the draft PR (this is you, logged into the web app).
  - `OTHER` — any second account with read access, for the non-author checks.
    A second browser profile / private window logged in as `OTHER` is enough.
- Draft-generation must be ON (the default; `drafts: on` in
  `mergebrief.config.yaml` if you set it explicitly). If drafts are off the
  whole surface stays dark by design (the draft-generation-policy knob), not a
  bug.

## 1. Open a draft PR and let it brief

As `AUTHOR`, in `TESTREPO`:

```sh
git checkout -b brief-43-manual
echo "// scratch" >> some-file.ts
git commit -am "wip: brief-43 manual test"
git push -u origin brief-43-manual
gh pr create --draft --title "BRIEF-43 manual test" --fill
```

- [ ] Webhook 200 → one debounced generate job → Brief renders (pending →
      generating → rendered) without a manual reload.
- [ ] In the DB, the PR row carries the new columns:
      ```sh
      docker compose exec postgres psql -U code_review -d code_review \
        -c "select pr_number, draft, author_login from pull_request order by created_at desc limit 3;"
      ```
      `draft = t`, `author_login = <AUTHOR login>`. (These are populated by the
      webhook — PR #101. If `author_login` is null the payload had `user: null`;
      only real deleted-author events do that.)

## 2. Own-draft state renders (PR #103)

Open the Brief as `AUTHOR` (deep-link or via the picker).

- [ ] **Header chip** reads exactly **"Self-review — your draft"** — not
      "Author mode", not "Author", not any "mode" wording. The chip is
      **non-dismissible** (no close affordance).
- [ ] Chip tooltip (hover or focus the info button): "You're viewing your own
      draft PR. Review submission and the receipt unlock once it's marked ready
      for review." Press `Escape` while hovering → tooltip dismisses without
      moving the pointer; it re-arms once both hover and focus leave.
- [ ] **Submit / receipt machinery is gone** — no "Submit review" button, no
      receipt drawer trigger, no Summary-preview menu item, and no dangling
      keyboard shortcut that opens any of them. Nothing references submit.
- [ ] **Risk flags are read-only** — the flag list, descriptions, and
      jump-to-chunk all render, but there are **no** Address/Dismiss controls
      (single or bulk) and no disposition popover.
- [ ] **Chunk read-tracking still works** (mark chunks viewed; the header
      progress reflects chunks only, not flags — it can reach 100%). The flags
      stat renders as a plain count ("flags 5"), not "0/5".
- [ ] **Terminal slot holds "Mark ready for review"** where Submit used to be.

## 3. Non-author sees the plain reviewer view (PR #101/#103)

In the `OTHER` browser, open the **same** PR's Brief.

- [ ] No chip, no mark-ready CTA — exactly the normal reviewer view. Flag
      dispositions, submit, and receipt are all present and normal.
- [ ] Confirm the server derives this (never the client): the meta response is
      per-viewer.
      ```sh
      # As OTHER (grab the cookie from the browser devtools) or just trust the UI:
      # the same PR returns viewerIsAuthor:false for OTHER, true for AUTHOR.
      ```
      The response carries the PR author's login as `authorLogin`, never the
      viewer's: authorship reaches the FE only as `viewerIsAuthor`.

## 4. Soft gate (PR #104)

Back as `AUTHOR`. The gate only fronts the CTA when the **current head's**
Brief carries risk flags.

- [ ] **Flags present:** click "Mark ready for review" → a modal (PreSubmitModal
      shape) lists **all** current-head risk flags. If you have staged draft
      comments, a "You have N unposted draft comments." line with a "Jump to
      your drafts" link appears (jumping never posts). "Mark ready anyway" is one
      click and records nothing; "Keep self-reviewing" closes it. Flag rows
      jump to their chunk.
- [ ] **Zero flags:** on a PR whose current-head Brief has no flags, the CTA
      **skips the modal entirely** and acts directly — nothing gate-shaped is in
      the DOM.
- [ ] **Historical revision:** if the PR has ≥2 briefed revisions, navigate to
      an older one via the timeline. The chip **stays** (it's still your draft),
      but the mark-ready CTA is disabled with an announced "switch to the latest
      revision" reason and **no gate mounts**. Switch back to the head → CTA
      live again.
- [ ] **Accessibility:** the modal traps focus, respects reduced-motion, and
      closes on `Escape` (first `Escape` spends the chip tooltip's claim if it
      was open, second closes the modal).

## 5. Mark-ready round-trip (PR #102)

With the modal open (or directly if zero flags), click through to mark ready.

- [ ] The mutation fires against GitHub with **your** token → the PR flips to
      non-draft on GitHub (check the PR page: the "Draft" label is gone).
- [ ] The Brief transitions to the **plain reviewer view** — chip, read-only
      flags, and the CTA vanish; submit/receipt reappear. The transition
      happens when the refreshed `PrView` lands (no flicker, no optimistic
      clear).
- [ ] An audit line was written:
      ```sh
      docker compose exec postgres psql -U code_review -d code_review \
        -c "select action, target_type from audit_log order by id desc limit 3;"
      ```
      expect `mark-ready` (the later `ready_for_review` webhook lands as an
      idempotent no-op — the row was already flipped in-request).
- [ ] **Convert back to draft** on GitHub (`gh pr ready --undo <N>`) → within a
      poll tick the own-draft affordances **return** (the `converted_to_draft`
      webhook is state-only: it must NOT trigger a regeneration — no Entry-
      comment repost ping, no new generate job).
- [ ] **Already-ready race:** if you mark ready and the `ready_for_review`
      webhook races the in-request flip, the surface converges to reviewer view
      cleanly (no error toast, no stuck spinner).

## 6. Per-comment post-now (PR #106)

Back in own-draft state (convert to draft again if you marked ready). Draft an
inline comment on a chunk as `AUTHOR`.

- [ ] The draft comment card shows a **"Post"** action (own-draft only, current
      head only). Reviewer state and historical revisions never show it — this
      is the ADR 0004 private-until-submit line: the reviewer composer is
      **unchanged**.
- [ ] Click **Post** → the comment posts to GitHub with your token, `commit_id`
      pinned to the current head. On GitHub it renders as a review comment
      authored by you.
- [ ] Back in the Brief, the draft **flips to a posted thread** with the
      **"yours"** tag (identity-derived, BRIEF-25 path). The draft is cleared;
      the soft gate's "unposted draft comments" count drops by one.
- [ ] **Post is blocked** (with a visible reason, no silent no-op) while: the
      inline editor holds unsaved text ("save your edit first"); a post is
      already in flight (double-post guard); a review submit is pending (reverse
      race). Edit/Delete on the card also disable while a post is in flight.
- [ ] **Failure copy is indeterminate:** kill the network mid-post (devtools
      offline) → the toast says the comment "may or may not have posted — check
      GitHub", the draft is kept, and the button re-enables. It never says
      "nothing happened" (that would invite a double-post).
- [ ] **Stale anchor:** if you post against a head that has since moved, the
      route returns 409 and the UI tells you to reload — a plain retry of the
      same payload is not offered.

## 7. Reviewer flow is untouched (ADR 0004 regression guard)

As `OTHER` (a genuine reviewer) on any non-draft PR, or as `AUTHOR` after
mark-ready:

- [ ] The composer is **private-until-submit** exactly as before — no "Post"
      affordance anywhere, comments stay local until "Submit review", the
      receipt/verdict flow is unchanged. If a "Post" button appears in reviewer
      state, that is a hard regression — stop and file it.

---

## What "pass" means

Every affordance appears and disappears strictly with the visible state
(`draft && you-are-the-author && current-head`), the reviewer flow is
byte-identical to pre-BRIEF-43, no "mode" wording exists anywhere, and no
post-now path can double-post a comment or re-ship an already-posted one on
Submit. Any defect becomes its own fix-forward PR (`main` convention).
