# Product

## Register

product

## Users

Individual engineers and small teams who want a self-hosted code-review comprehension tool they can run with their own infrastructure and model key. They are reviewing PRs in the normal engineering flow, often under the pressure of AI-authored diff volume, and need to regain a reliable mental model before writing human review comments.

## Product Purpose

Brief / review turns a flat pull-request file list into a Brief: categorized Change-groups, summaries, playbooks, Risk Surface attributes, revision changes, and a Receipt. Success means the reviewer understands what changed, where attention belongs, and what they verified, without the tool pretending to approve, reject, or author comments for them.

## Brand Personality

Clear, principled, and practical. The product should feel like an expert reviewer organizing the room: opinionated about trust boundaries, quiet about itself, and precise with domain language.

## Anti-references

Do not look like an AI bug-bot, verdict engine, severity dashboard, or noisy SaaS reviewer that floods a PR with speculative findings. Avoid AI-authored review text, approval-like badges, hidden telemetry cues, generic summary dashboards, and black-box analysis theatre.

## Design Principles

- Facts before verdicts: Risk Surface attributes and receipts must stay factual, scoped, and reviewable.
- Human authorship stays visible: the tool structures thinking, but the reviewer writes and decides.
- Taxonomy is the interface: Change-group, Category, Concern, Role, and Receipt language should be stable and legible across screens.
- Route attention without anchoring: emphasize what needs a closer look without implying severity or certainty.
- Self-host trust: the product should feel inspectable, local-first, and respectful of code and keys staying under user control.

## Accessibility & Inclusion

Target WCAG 2.2 AA for product UI. Preserve keyboard operation for review workflows, visible focus states, reduced-motion behavior, sufficient contrast for dense code-review surfaces, and layouts that remain usable at high zoom.
