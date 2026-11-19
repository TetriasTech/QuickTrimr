# Phase 2 Jira publication

Andrew requested creation of all Phase 2 tickets and assignment of every ticket to him on 2026-11-20 (Australia/Sydney).

Created **15 tickets**, assigned to **Andrew Gindi**, under [TRIMR-43 — QuickTrimr Phase 2: Available Now, Discovery & Booking Requests](https://tetrias-tech.atlassian.net/browse/TRIMR-43). The epic is also assigned to Andrew. All 15 tickets are **To Do**; creation does not start them or waive readiness/dependency gates.

| Backlog ID | Jira | Title |
| --- | --- | --- |
| P2-T01 | [TRIMR-44](https://tetrias-tech.atlassian.net/browse/TRIMR-44) | Available Now session model and queries |
| P2-T02 | [TRIMR-45](https://tetrias-tech.atlassian.net/browse/TRIMR-45) | Barber Available Now toggle |
| P2-T03 | [TRIMR-46](https://tetrias-tech.atlassian.net/browse/TRIMR-46) | Available Now auto-disable rules |
| P2-T04 | [TRIMR-47](https://tetrias-tech.atlassian.net/browse/TRIMR-47) | Nearby barber search |
| P2-T05 | [TRIMR-48](https://tetrias-tech.atlassian.net/browse/TRIMR-48) | Client discovery filters |
| P2-T06 | [TRIMR-49](https://tetrias-tech.atlassian.net/browse/TRIMR-49) | Barber results list |
| P2-T07 | [TRIMR-50](https://tetrias-tech.atlassian.net/browse/TRIMR-50) | Client map view |
| P2-T08 | [TRIMR-51](https://tetrias-tech.atlassian.net/browse/TRIMR-51) | Create booking request |
| P2-T09 | [TRIMR-52](https://tetrias-tech.atlassian.net/browse/TRIMR-52) | Client booking request submission |
| P2-T10 | [TRIMR-53](https://tetrias-tech.atlassian.net/browse/TRIMR-53) | Barber request inbox query |
| P2-T11 | [TRIMR-54](https://tetrias-tech.atlassian.net/browse/TRIMR-54) | Barber request inbox UI |
| P2-T12 | [TRIMR-55](https://tetrias-tech.atlassian.net/browse/TRIMR-55) | Accept booking request |
| P2-T13 | [TRIMR-56](https://tetrias-tech.atlassian.net/browse/TRIMR-56) | Decline booking request |
| P2-T14 | [TRIMR-57](https://tetrias-tech.atlassian.net/browse/TRIMR-57) | Barber accept and decline UI |
| P2-T15 | [TRIMR-58](https://tetrias-tech.atlassian.net/browse/TRIMR-58) | Booking request expiry |

## Source and ownership

- Recorded Andrew's instruction upstream as `RULE-DEV-PHASE2-OWNERSHIP` before publishing. Default Phase 3–7 ownership remains unchanged; the existing Phase 1 handover remains in force.
- Changed P2-T12 and P2-T15 from Tony to Andrew. The other 13 Phase 2 headers already named Andrew. Mirrored the Phase 2 exception in AGENTS.md and the backlog ownership summaries.
- Used `scripts/jira/create-tickets.mjs` and the existing shared service account, with its pinned `TRIMR` project guard. No application code or Jira publisher code changed.
- Checked the existing project issues before creation: no Phase 2 tickets/epic existed. Verified Andrew was active and assignable in the QuickTrimr project. The publisher writes each returned `jiraKey` immediately, so retrying skips already-created tickets.
- Preserved every Phase 2 scope, priority, type, acceptance criterion, dependency and impact reference. Generated backlog sections 8/9 are left unchanged for the reviewed post-merge automation under `RULE-DEV-CI`.

## Verification

[Verification snapshot](phase-2-jira/verification.json) and [publisher output](phase-2-jira/created.txt).

| Check | Result |
| --- | --- |
| Preflight dry run | 15 planned issues; all mapped to the verified Andrew account. |
| Publisher create | 15 created under TRIMR-43; 91 resolvable link operations reported; every returned key written back. |
| Connected Jira read-back | Exactly 16 Phase 2 issues including the epic; all assigned to Andrew; every child has parent TRIMR-43. |
| Saved issue content | All titles, issue types, priorities and owner/phase labels match the backlog. All **148 acceptance criteria** present in Jira's saved descriptions. |
| Prerequisites | Every dependency has a Jira key; all **63 prerequisite links** verified in the correct “is blocked by” direction. |
| Impact references | All **28 resolvable impact references** have a “relates to” link. Future uncreated phases remain referenced in the description/backlog. |
| `node scripts/jira/create-tickets.mjs --update --phase 2 --dry-run` | 0 issue updates, 15 unchanged; 0 links to add out of 91 resolvable. No writes. [Output](phase-2-jira/sync-check.txt). |
| `node scripts/jira/generate-indexes.mjs --check` | PASS — 108 tickets, 198 defined KB IDs, no unresolved TBC. |
| `node --test scripts/decisions.test.mjs` | PASS — 87 tests. [Output](phase-2-jira/decision-checks.txt). |
| Source comparison | Non-Phase-2 headers and all ticket bodies unchanged. Generated sections unchanged. |

Assignment, parent, description and link assertions used actual saved Jira responses; credentials and raw authenticated responses were not saved. No issue was marked In Progress or Done, and no earlier phase's ownership or status was changed. Merge the repository sync PR to preserve the new key mappings on main before future ticket pickups.
