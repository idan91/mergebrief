# Archive — superseded by the OSS-only direction (2026-06-30)

These documents reflect the **commercial / hosted-product strategy** that the project pursued
before the **OSS-only** decision ([ADR 0023](../adr/0023-oss-only-no-hosted-arm.md)). They are
kept for history and reasoning trail. **They are no longer active and must not drive work.**

The live sources of truth are:

- [`../vision.md`](../vision.md) — what the project is and refuses to be.
- [`../oss-roadmap.md`](../oss-roadmap.md) — prioritized next steps.
- [ADR 0023](../adr/0023-oss-only-no-hosted-arm.md) — the OSS-only decision.

## What's here and why it was retired

- **`commercial-strategy.md`** — the four strategy sections lifted out of `next-steps.md`:
  - **Moat Honesty** — earning a defensive moat (data exhaust, org-learned playbooks,
    switching costs). Dead: with no business there is no moat to build.
  - **Open-Core / BYOK Split** — the OSS-vs-hosted cut line. Dead: there is no hosted side.
    (BYOK survives as the OSS default — see ADR 0013/0017 — but the open-core *framing* is gone.)
  - **Headless Distribution** — API/SDK as a go-to-market/partnership lever. Dead as a
    distribution play. (A clean internal API for self-host/demo is still fine engineering.)
  - **PMF Validation Track** — Phases 1–3, interviews, reviewer recruiting, kill-on-signal.
    Dead: we build because the tool is useful to peers, not gated on a validation experiment.

- **`validation-todo.md`** — the former `docs/todo.md`, a checklist dominated by the Phase 1–3
  validation protocol. Retired with the validation track.

> The product/domain thinking under `docs/mvp/` (labeling schema, risk surface, playbook
> library, center-of-gravity) is **not** archived — it carries forward. Only the parts tied to
> the *validation experiment* and *commercial go-to-market* are dead; those files now carry a
> superseded-in-part banner pointing here.
