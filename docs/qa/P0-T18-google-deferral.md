# P0-T18 Google billing deferral — 2026-10-20

## TICKET / OWNER / READY

- Existing: P0-T18 / [TRIMR-27](https://tetrias-tech.atlassian.net/browse/TRIMR-27), Tony,
  **In Progress**. This report covers the approved scope split, not completion of Stripe setup.
- Follow-up: P0-T20 / [TRIMR-29](https://tetrias-tech.atlassian.net/browse/TRIMR-29), Tony,
  **To Do**, High priority, parent TRIMR-1 (the existing Phase 0 epic).
- P0-T18 prerequisites P0-D05 / TRIMR-6 and P0-T03 / TRIMR-12 read as Done. P0-T20 depends
  only on P0-T03, not unfinished Stripe checks. Graph validation finds no open TBCs or missing
  KB IDs. This run does not start the deferred provider work.

## UNDERSTOOD

Andrew asked to defer customer Google billing details to a future ticket and explicitly
approved amending the backlog and creating that follow-up in Jira. Preserve the unbilled
`quicktrimr-dev` project and all approved cost/security requirements; do not declare deferred
provider checks passed or waive unfinished Stripe acceptance criteria.

## DONE

- Recorded `RULE-OPS-GOOGLE-DEV-DEFERRAL` in the KB before changing tickets. Made the narrow
  phase-sequencing exception explicit: unrelated work still needs its own readiness gate.
- Renamed P0-T18 to **Provision Stripe test mode and Connect**. Kept its Stripe criteria and
  an evidence-based unbilled-project handoff; transferred Google billing, services, four
  restricted keys, quota/budget settings and positive/negative provider tests to P0-T20.
- Created TRIMR-29 and immediately wrote its key back to the backlog. No duplicate found in
  the pre-create project-scoped Jira search.
- Replaced the Google prerequisite with P0-T20 for P1-T05 and P4-T05; added it directly to
  P2-T07. P6-T09/P6-T11 retain P0-T18 and add P0-T20. Those later-phase issues do not yet
  exist in Jira; their source-of-truth dependency headers are ready for later projection.
- Updated P0-T03's impact/handoff references, without changing its environment contract.
  Corrected P1-T05's contradictory client-key Places criterion to existing ADR-008.
- Updated only TRIMR-12 and TRIMR-27 in Jira. Added verified TRIMR-12 **blocks** TRIMR-29,
  and relates-to links from TRIMR-12/TRIMR-27. P0-T18 does not block P0-T20 or vice versa.
- Reused the repository's pure ticket renderer/fingerprint functions for scoped projection;
  saved/read back `quicktrimr-backlog-sync` fingerprints for those three issues only.
- No Google billing/provider changes, payment entry, terms acceptance, Stripe money calls,
  credential changes, commit, push, PR or Done transition occurred during this split.

## EVIDENCE

- Jira creation returned issue ID `10188`, key `TRIMR-29`.
- Read-back: TRIMR-29 has Tony Hanna, To Do, High, parent TRIMR-1, the backlog ID and existing
  project handoff in its description. Link `10290` is an inward **is blocked by TRIMR-12**
  from TRIMR-29's perspective. Related links `10291` and `10292` connect TRIMR-27/TRIMR-12.
- TRIMR-27 read-back has its new Stripe-only title/labels and remains In Progress.
- Phase 0 create preview: exactly one missing issue (P0-T20) before creation; all 27 existing
  issue keys skipped. No later phase was created.
- Phase 0 update preview found 16 changed historical projections plus unrelated link backfill.
  It was read-only and **not applied**. Targeted writes avoided unrelated issue changes.
- Original project-identity screenshot and observed no-billing state remain in
  [the original Google evidence](evidence/P0-T18-google-development.json) and
  [provider report](P0-T18.md). This split did not reconfigure or re-verify provider state.

## TESTS

- Five new specification regressions cover ownership/independent prerequisites, direct Google
  consumer gates, preserved Stripe criteria, retained cost/restriction evidence and server-only
  Places. These are document/graph guards, not provider integration tests.
- `node --test scripts/decisions.test.mjs`: **84 passed**, 0 failed/skipped.
- `pnpm test` at the split handoff: **293 passed** (100 workspace + 193 root Node), 0 failed/skipped.
  Subsequent publication preparation adds one screenshot-exclusion regression: **294 passed**
  (100 workspace + 194 root Node), with the same quality checks passing. See P0-T18's
  publication-audit addendum for the two excluded test-phone-field captures and corrected captions.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:client-env`,
  `git diff --check`: **PASS**.
- `node scripts/jira/generate-indexes.mjs --check`: **108 tickets, 173 defined KB IDs,
  0 open TBCs, OK**. Generated sections 8/9 remain byte-identical to HEAD; not regenerated.
- Exact-value, non-disclosing scans of the current ignored Stripe and Jira credentials:
  **0 matches** in tracked/non-ignored files. No screenshot/OCR scan or old-key revocation
  audit is claimed.

## DRIFT

Case D: recorded the explicit user-approved deferral upstream, then ticket scope, consumer
headers and Jira. Case A: removed the old client-key autocomplete instruction because ADR-008
already requires Edge Functions for Places. No business rule, budget value, quota, payout rule
or environment variable was invented. Existing resolved TBC register rows remain; resolved
setup blockers were cleared from P0-T18's header so Jira no longer labels them unresolved.

Traceability reviewed from generated sections plus current headers: P0-T18/P0-T20 implement
the new deferral; P1-T05/P2-T07/P4-T05 and P6-T09/P6-T11 receive the sequencing changes.
P0-T03's trust contract remains correct; P2-T04 remains a PostGIS-only query. Stripe consumers
P1-T07/P1-T09/P3-T01/P3-T03/P3-T11 retain the same money/security prerequisites. The
`RULE-PAY-12` edit only removes stale wording that Google policy was still undecided; financial
responsibilities are unchanged. Staging/live setup is not approved by the development policy.

## DECISIONS NEEDED

None for this split. Customer billing entry/terms are deliberately future work in P0-T20.
Unsupported quota metrics, billing-currency mismatch or unsupported Stripe controls must still
be surfaced when encountered, not silently substituted.

## AUDIT

Scope: the deferral rule, amended/new ticket, affected headers, five new test guards, scoped
Jira projection and updated evidence. Reviewed against QUICKTRIMR_AUDIT_PROMPT.md A–F.
No new money, RLS, location, API, app UI or scheduler code was introduced.

1. **[MAJOR] E. Existing bulk Jira sync reverses dependency-link direction.**
   Where: `scripts/jira/create-tickets.mjs:683` and `:890`.
   The script submits the dependent as `inwardIssue` and prerequisite as `outwardIssue` for
   Blocks, expressing the dependent blocking its prerequisite. Existing TRIMR-27's outward
   Blocks link to TRIMR-12 corroborates this old projection mismatch. The authoritative backlog
   is correct. **Triaged outside the approved split:** no bulk write was run; the new follow-up
   link was created with the correct direction and verified by read-back. A separate tooling
   fix should swap only Blocks endpoints, add direction regressions and reconcile exact stale
   links under explicit scope. Do not use bulk link backfill for this follow-up meanwhile.
   Effort: S for code/test; existing-link reconciliation requires a bounded review.

VERDICT: **1 adjacent pre-existing Major, triaged; 0 new findings in the split.** The audit is
advisory and made no fixes. This does not override the original provider report's historical
security findings or unfinished Stripe evidence.

## NOT DONE

- P0-T18 is **not Done**: durable Instant-payout prevention, secure bank correction and genuine
  auth-success/capture-failure proof remain required.
- P0-T20 is **not Done or implemented**: customer billing, API enablement, keys, real
  positive/negative usage tests, applied quotas and budget/recipient proof remain deferred.
- Later-phase Jira issues/links are intentionally not created. Generated indexes await the
  reviewed main-branch automation. The adjacent bulk Jira link-direction bug is unchanged.
- At this split handoff, repository changes remained uncommitted on TRIMR-27. Andrew subsequently
  requested publication as a PR; it remains a partial provider-setup slice, not ticket completion.
