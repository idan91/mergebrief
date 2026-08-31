# BRIEF-180 — `<Trans>` for sentences that wrap inline markup

One PR. Branches off `feature/BRIEF-175/generation-failure-wire` (#302),
because `packages/i18n` does not exist on `main` until the BRIEF-175 stack
merges; `rebase --onto main` once it does.

## Goal

Four rendered sentences wrap an inline element. Each is stored as two catalog
keys composed in JSX, so the element's position is fixed by English word
order. A translator cannot move it. After this change each sentence is ONE
catalog entry with the element as a positional slot.

## Scope — the four sites

| Site | Today | After |
| --- | --- | --- |
| `TokenSettings.tsx:43` | `introLead` + `<code>{CLI_BINARY}</code>` + `introTail` | `tokens.intro`, one slot |
| `TokenSettings.tsx:125` | `disclaimerLead` + `<code>{CHMOD_COMMAND}</code>` + `disclaimerTail` + `<strong>{org}</strong>` + `.` | `tokens.disclaimer`, two slots |
| `routes/index.tsx:114` | `cliHintLead` + `<code>{CLI_COMMAND}</code>` + `cliHintTail` | `shell.cliHint`, one slot |
| `routes/settings.tsx:40` | `<a>{signInWithGithub}</a>` + `toManageTokens` | `shell.signInPrompt`, one slot |

The fourth is element-FIRST rather than a mid-clause split, so it was the open
scope question. It is in: `"to manage API tokens."` is as unmovable as a
mid-clause tail, and leaving one of four behind makes the convention
unstateable. `shell.signInWithGithub` disappears into the slot — it has no
other call site.

Not in scope: the other `Lead`/`Suffix` keys (`addressedLead`,
`revisionSummaryUnavailableLead`, `replyFailedSuffix`, …). Those are whole
sentences sitting beside other sentences, not fragments of one. No test or
story references any of the eight keys being replaced.

## The rule this establishes

**A sentence containing an inline element is one catalog entry.** Fragments
that end mid-clause, or begin with punctuation, are the defect this removes.
A standalone sentence adjacent to another sentence is not a fragment and stays
its own key.

## Authoring style — positional `components`, never children

```tsx
<Trans components={[<code key="cli" />]} i18nKey="tokens.intro" values={{ cli: CLI_BINARY }} />
```

NOT the children form (`<Trans i18nKey="…">Tokens let the <code>…</code>…</Trans>`).
Two reasons, both load-bearing:

- The children form duplicates the English copy into JSX, so the catalog stops
  being the single source of copy and the `no-literal-string` gate needs a
  `jsx-components` exemption. `eslint-plugin-i18next@6.1.5` does **not** exempt
  `Trans` by default — verified in the installed rule source, contrary to what
  the ticket assumed.
- Positional `<0>` keeps element NAMES out of catalog values entirely. That is
  what lets the gate below stay strict: a catalog value can never name an
  element, only reference a slot the call site supplies.

Identifiers stay call-site consts interpolated as `{{param}}` (`CLI_BINARY`,
`CHMOD_COMMAND`, `CLI_COMMAND`), consistent with the BRIEF-175 decision that
identifiers are not copy.

## The catalog gate — `packages/i18n/test/helpers.ts:110`

Today:

```ts
if (/[<>]/.test(template)) {
  issues.push({ key, problem: "markup is not allowed in catalog values" });
}
```

A blanket angle-bracket ban, load-bearing because the app runs
`escapeValue: false` — i18next does not escape catalog values, React does.
`<Trans>` cannot exist under it.

Replace with: **strip well-formed positional tags, then apply the existing ban
to what remains.** Balanced `<0>…</0>` and self-closing `<0/>` come out; every
other angle bracket still fails. `<script>` fails, a stray `<` fails, an
orphan `</0>` fails, a nested tag fails (nesting is not supported and should
not silently pass).

Two gates ride along, both mirroring checks the package already performs on
`{{param}}`:

- **Contiguity** — indices used in a value must be `0..n-1` with no gaps. A
  value referencing `<2>` when the call site passes two components renders the
  tag literally; this catches it mechanically.
- **Cross-locale tag drift** — a translation must use the same index set as
  `en`, exactly as `{{param}}` sets are already compared. A translation that
  drops `<0>` silently loses a link, which is the failure this ticket exists
  to prevent.

## Git

`git-eng` is mandatory for every git operation. Branch
`feature/BRIEF-180/trans-inline-markup` off #302's tip. HTTPS + `gh` helper.
Idan merges; the implementation never merges.

Three chunked commits, `reviewer` on the branch diff before each:

1. `feat(i18n): allow positional Trans slots in catalog values` — the gate
   rewrite plus its tests.
2. `refactor(i18n): fold wrapped-markup sentences into single entries` — the
   catalog: four entries replace eight.
3. `refactor(web): render wrapped-markup sentences with Trans` — the four call
   sites.

Findings at confidence ≥ 80: fix, re-stage, re-run until clean.

## Skills

- `typescript-eng` — throughout.
- `web-accessibility` — the four sites render a link and inline
  `<code>`/`<strong>`. A wrong `components` mapping drops the element and
  leaves bare text where a control was, which is an a11y regression, not a
  cosmetic one. Verify the `<a>` in `settings.tsx` still renders as a link.

## Size, model, invocation

Estimate ~200 changed LOC: gate + tests ~100, catalog ~10, call sites ~40,
component test additions ~50. Well under the 500 ideal — one PR.

Opus 5, high effort, sequential in the main thread. The one design decision
(structural gate over per-key allowlist) is already locked with Idan, so what
remains is execution: a backreference regex with exact edge-case behaviour and
four mechanical rewrites. No part is independent enough to fan out.

## Steps

1. Rewrite the markup gate in `packages/i18n/test/helpers.ts`; add contiguity
   and cross-locale tag-drift checks.
2. Cover the gate: `<0>…</0>` and `<0/>` pass; `<script>`, stray `<`, orphan
   `</0>`, nested tags, and index gaps each fail with their own message.
3. Collapse the eight catalog keys into four entries carrying positional tags
   and `{{param}}` interpolation. Delete `shell.signInWithGithub`.
4. Rewrite the four call sites to `<Trans>` with `components` + `values`.
5. Assert per site that the wrapped element still renders as its own node —
   the link is a link, the command sits in a `<code>` — and that the sentence
   reads identically in English.
6. `pnpm -C packages/i18n test`, `pnpm -C apps/web test`, `apps/web` build,
   repo-root `pnpm lint`. `apps/web` consumes the `i18n` contract, so its suite
   runs locally regardless of CI selection.

## Out of scope

No eval spend — nothing here touches the generation surface.
