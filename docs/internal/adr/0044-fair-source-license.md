# 0044: Fair source license (FSL-1.1-Apache-2.0)

Status: accepted
Date: 2026-10-03

Amends ADR 0023.

The repository and the npm package ship under FSL-1.1-ALv2: anyone may
self-host, modify and fork it, nobody may sell it as a competing product,
and each release becomes Apache-2.0 two years after it ships.

## Context

- No hosted or commercial arm exists or is planned (ADR 0023). The one
  outcome to refuse is a funded product wrapping this code as a competing
  commercial offering.
- The adopters are organizations self-hosting inside their own walls.
  Enterprise legal departments ban AGPL even for unmodified self-host, so a
  copyleft license costs exactly the people the project is for.

## Considered options

- **Apache-2.0.** Hands a competing product the code on day one.
- **AGPL-3.0.** Blocks a closed hosted fork, but the adopter pays for it in
  legal review or an outright ban.
- **FSL-1.1-Apache-2.0 (chosen).** Free use, self-host, modification and
  forking; only a competing commercial use is refused, and only for two
  years per release.

## Decision

- FSL-1.1-ALv2 covers the whole repository and the `mergebrief` npm package.
- Self-host, modify and fork freely. Offering it, or a substitute built on
  it, as a competing commercial product or service is not permitted.
- Each release converts to Apache-2.0 two years after it ships.
- Contributions come under the DCO; there is no CLA. Relicensing stays
  possible while the author holds all copyright.

## Consequences

- This is not OSI open source. Where a license claim is made the project
  says "source-available" or "fair source"; elsewhere it says
  "self-hostable". ADR 0023's "OSS-only" wording is amended; its
  no-hosted-arm decision stands.
- `LICENSE` sits at the repository root and in `apps/cli`, both manifests
  carry the SPDX id, and the README has a license section.
- The license does not touch ADR 0017's IP-clearance gate: written clearance
  still precedes public work.
