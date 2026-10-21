# Architecture decision records

Numbered, append-only records of the decisions behind MergeBrief. Each carries a status line; amendments sit in its `## Amendments` section.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-web-app-not-browser-extension.md) | Web App + GitHub App Bridge, Not a Browser Extension | accepted |
| [0002](0002-receipt-not-ai-approval.md) | Tool Issues a Receipt, Not an AI Approval | amended (see Amendments) |
| [0003](0003-category-scoped-bug-hunt-not-general.md) | Category-Scoped Checks Only, No General Bug Hunt | superseded in part by 0035 |
| [0004](0004-private-mind-map-not-public-thread.md) | Private Mind-Map Space, Not a Public PR Thread | amended (see Amendments) |
| [0005](0005-intent-on-change-group-two-view-projection.md) | Intent Lives on the Change-Group; Brief Is a Two-View Projection | amended (see Amendments) |
| [0006](0006-delta-brief-generation-and-state-model.md) | Delta Brief: Per-Reviewer Generation, Caching, and State Model | superseded in part by 0024, 0040 |
| [0007](0007-delta-comment-anchoring-and-flag-carry-over.md) | Delta Brief: Comment Anchoring and Flag Carry-Over | superseded in part by 0040 |
| [0008](0008-brief-delta-persistence-and-fetching.md) | Brief & Delta: Persistence Model and Fetching | superseded in part by 0040 |
| [0009](0009-author-side-self-review-v1.md) | Author-Side Self-Review (v1, Secondary Surface) | superseded in part by 0020 |
| [0010](0010-tiered-generation-triage.md) | Tiered Generation: a Cheap Triage Decides Experience and Spend | deprecated |
| [0011](0011-delta-comments-addressed-and-per-chunk-summary.md) | Delta: Comments-Addressed + Per-Chunk Summary | superseded in part by 0012, 0027 |
| [0012](0012-brief-index-commit-range-and-comments-on-brief.md) | Brief Index, Commit Range, and Comments on the Full Brief | superseded in part by 0027 |
| [0013](0013-provider-agnostic-generation-and-byok.md) | Provider-Agnostic Generation, BYOK, and Generation Origin | amended (see Amendments) |
| [0014](0014-external-context-and-ai-review-boundary.md) | External Context and the AI-Review Boundary | superseded in part by 0033 |
| [0015](0015-self-hosted-runtime-postgres-single-dependency.md) | Self-Hosted Runtime: One Long-Lived Worker + Postgres as the Single Stateful Dependency | amended (see Amendments) |
| [0016](0016-github-app-auth-and-trust-tenancy-boundary.md) | GitHub App, Reviewer Auth, and the Trust/Tenancy Boundary | superseded in part by 0034, 0040, 0042, 0043 |
| [0017](0017-oss-self-host-first-distribution.md) | OSS Self-Host-First Distribution (Open-Core) | superseded in part by 0023 |
| [0018](0018-m1-postgres-schema.md) | M1 Postgres Schema | superseded in part by 0040, 0043 |
| [0019](0019-brief-timeline-navigation.md) | Brief Timeline Navigation | superseded in part by 0024, 0040 |
| [0020](0020-brief-trigger-and-activation-model.md) | Brief Trigger, Entry, and the Draft-First Activation Model | superseded in part by 0032 |
| [0021](0021-revision-changes-overlay-on-full-brief.md) | Revision-Changes Overlay on the Full Brief | superseded in part by 0024 |
| [0022](0022-mind-map-session-store.md) | Mind-Map Session Store (Client Runtime of the Mind-Map Space) | superseded in part by 0035, 0040 |
| [0023](0023-oss-only-no-hosted-arm.md) | OSS-Only: No Hosted or Commercial Arm | superseded in part by 0035, 0044 |
| [0024](0024-generated-revision-narrative.md) | Comparison Baselines and Generated Revision Narratives | accepted |
| [0025](0025-reading-order-on-change-groups.md) | Reading Order on Change-Groups | accepted |
| [0026](0026-ai-authorship-risk-attributes.md) | AI-Authorship Risk Attributes: Model-Observed, Positioning-Only | amended (see Amendments) |
| [0027](0027-pr-conversation-live-display.md) | PR Conversation Display in the Product Runtime: Live Fetch over GraphQL | amended (see Amendments) |
| [0028](0028-mergebrief-cli-thin-client-seam.md) | MergeBrief CLI: Thin-Client Seam over the Public HTTP API | superseded in part by 0045 |
| [0029](0029-cli-output-contract.md) | CLI Output Contract: Passthrough, Additive-Only, Exit-Code Invariant | amended (see Amendments) |
| [0030](0030-harness-cli-generator-adapters.md) | Harness-CLI Generator Adapters (Local-Only) | amended (see Amendments) |
| [0031](0031-single-brief-view-author-affordances.md) | Single Brief View: Author Surface as State-Derived Affordances | amended (see Amendments) |
| [0032](0032-repo-local-config-surface.md) | Repo-Local Configuration Surface (`.mergebrief/`) | amended (see Amendments) |
| [0033](0033-contextsource-contract-providers-parked.md) | ContextSource Contract Locked; All Providers Parked to v2 | amended (see Amendments) |
| [0034](0034-observability-v1-logging-health.md) | Observability v1: structured logging, health surface, adopter hooks | superseded in part by 0046 |
| [0035](0035-playbook-layer-parked-rubric-identity.md) | Playbook Layer Parked to v2; Rubric Identity Locked | accepted |
| [0036](0036-repo-governance-maintainer-final-say.md) | Repo Governance: Maintainer Final Say, With Receipts | accepted |
| [0037](0037-fe-placement-and-token-conventions.md) | FE placement and token conventions (apps/web) | amended (see Amendments) |
| [0038](0038-constraint-mesh-test-quality-gates.md) | Constraint mesh: automated test & quality gate policy | amended (see Amendments) |
| [0039](0039-product-operation-catalog.md) | Product Operation catalog, route registration, CI drift gates | amended (see Amendments) |
| [0040](0040-review-session-server-store.md) | Review Session: server-backed store, carry-over, and credential scope | amended (see Amendments) |
| [0041](0041-api-layering-handler-controller.md) | apps/api layering: handler, controller, thrown-error family | amended (see Amendments) |
| [0042](0042-workspace-member-kinds.md) | Workspace member kinds: apps, packages, tools | amended (see Amendments) |
| [0043](0043-no-credential-holds-a-current-installation.md) | No credential holds a current installation | accepted |
| [0044](0044-fair-source-license.md) | Fair source license (FSL-1.1-Apache-2.0) | accepted |
| [0045](0045-one-version-number-and-expand-and-contract.md) | One version number, and expand and contract on every release | amended (see Amendments) |
| [0046](0046-opentelemetry-tracing.md) | OpenTelemetry tracing, off by default | amended (see Amendments) |
| [0047](0047-url-pull-requests-belong-to-their-reviewer.md) | A URL pull request belongs to the reviewer who pasted it | accepted |
