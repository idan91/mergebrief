# Web App + GitHub App Bridge, Not a Browser Extension

The reviewer-side product is a standalone web app authenticated via GitHub OAuth, paired with a GitHub App that posts a deep-link button on each PR. We considered a browser extension that overlays github.com (intuitively the "UI layer on top" of GH) and explicitly rejected it.

## Considered Options

- **Browser extension** overlaying github.com. Wins on zero-context-switch — reviewer never leaves GH. Loses on every other axis: UI ceiling constrained by GH's DOM; breaks every time GH ships a UI change; cross-browser distribution drag (Chrome Web Store review, Firefox/Safari ports); scary install permission ("read all data on github.com"); per-seat monetization is hard on extensions; auth/token management is messy.
- **GitHub App with PR comments only** (the CodeRabbit/Greptile path). Cheap, but the product becomes "another reviewer bot" — exactly the lane we are leaving. No custom UI ceiling.
- **IDE extension** (VS Code review mode). Powerful for deep reads but the audience is tiny — most reviewers use the GH web UI.
- **Web app + GH App bridge** (chosen). GH App posts one PR comment with a deep-link button; reviewer clicks into the web app; web app posts the final review back to GH via API.

## Why This Way

The product depends on UX that does not fit in GH's gutters: inline section-aware brief, persistent agent chat panel, private mind-map workspace, structured-seed comment authoring, scoped tool verification receipt. An extension would force-fit this UX into someone else's DOM forever. The web-app surface gives full control, stable cross-browser delivery, clean OAuth/billing, and lets the GH bridge handle exactly two jobs (discovery + final submit) — the rest of the friction is one-time-per-review (deep-link click), not constant.

Precedent supports the choice: Graphite, Reviewable.io, and Gerrit all pull reviewers out of github.com and succeed because the review experience is better than native.

## Consequences

- Reviewers context-switch out of github.com once per review (deep-link click). One-time-per-review friction is acceptable; constant friction is not.
- The bridge requires a clean OAuth + GH API path for posting reviews on the reviewer's behalf — the on-submit step must be reliable.
- The web app must rebuild a usable diff viewer. Mature OSS exists; build cost is finite and stable.
- If GH adds compelling first-party comprehension features, we can't piggyback on their UI to compete — the web app must remain visibly better than native review.
