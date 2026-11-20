# P2-T04 / TRIMR-47 — readiness record

Owner: Andrew. Issue type: Task. Ready: **yes**.

The Jira key resolves exactly to P2-T04 in the authoritative backlog. The ticket
skill/prompt, KB instructions, complete ticket and cited rules, dependency
contracts/sync notes, affected consumers and Ready/Done gates were loaded before
implementation. The base includes merged PR #59.

## Scope understood

Deliver bounded PostGIS search for Available Now's current session location and
Scheduled's configured service area, filtered by category, current Connect gates
and shared reliability eligibility. Return only the existing public projection,
category price, approved distance band and shared SAL point. Exact barber points,
exact distances, private fields and offence history remain server-side. Filter,
list, map, booking UI and ETA belong to their recorded later tickets.

## Gates

Jira dependency status checks on 2026-11-20:

| Dependency | Jira | Status |
| --- | --- | --- |
| P0-D01 | TRIMR-2 | Done |
| P0-D04 | TRIMR-5 | Done |
| P0-D06 | TRIMR-7 | Done |
| P1-T09 | TRIMR-39 | Done |
| P1-T11 | TRIMR-41 | Done |
| P2-T01 | TRIMR-44 | Done |

One named owner, existing API examples, twelve individually checkable acceptance
criteria and implemented cited rules are present. No unresolved TBC blocks this
slice. The graph check passes with 214 defined IDs and zero open TBCs.

## Decision and drift

Implementation initially stopped because the product search bounds and complete
pagination policy were undecided. `TBC-DISCOVERY-SEARCH-POLICY` was raised under
ticket-prompt Case C. Andrew approved Option A on 2026-11-20:

- Radius 1–50 km inclusive; fractions allowed.
- Integer pages 1–50, omitted-limit default 20.
- Restricted last; distance ascending, price ascending, rating descending
  (unrated last), rating count descending and barber ID ascending.
- Live eligibility rechecks; stable pagination for unchanged data, refresh after
  live ranking/availability changes.

Case D was followed before code: write `RULE-DISCOVERY-06` and the three discovery
config IDs upstream, resolve the TBC in place, update P2-T04 and affected consumer
contracts, then rerun readiness/graph validation. Existing `RULE-DISCOVERY-05`
requires cursor opacity; no precision rule or snapshot lifetime was invented.

Affected consumers P2-T05/P2-T06/P2-T07/P2-T09 now cite this approved policy. The
existing generated traceability table was checked; generated sections 8/9 were
left untouched for main's reviewed automation PR.

Readiness is not acceptance evidence. Delivery, verification, audit and limits
are recorded in [P2-T04.md](P2-T04.md).
