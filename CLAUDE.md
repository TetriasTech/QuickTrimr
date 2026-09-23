# QuickTrimr

Two-sided barber marketplace. Real money, real home addresses, and a named stranger arriving at
someone's door at a stated time. Built by two engineers, Tony and Andrew, at Tetrias Tech.

**The product does not exist yet.** This repo currently holds the specification and the tooling
that keeps it honest. Phase 0 has not started.

## The core files

| File | Role |
|---|---|
| `QUICKTRIMR_KNOWLEDGE_BASE.md` | **Upstream source of truth.** Product rules, architecture decisions, open decisions. |
| `QUICKTRIMR_BACKLOG_README.md` | The 107 tickets implementing it. Source of truth for tickets; Jira is a projection. |
| `QUICKTRIMR_TICKET_PROMPT.md` | The prompt for handing a ticket to an agent. |
| `QUICKTRIMR_AUDIT_PROMPT.md` | The prompt for auditing code, architecture, and decisions. Source of truth for `/audit`. |
| `scripts/jira/generate-indexes.mjs` | Generates the traceability + reverse dependency indexes, and validates the ticket graph. |

## Rules for working here

**To pick up a ticket, run `/ticket <id>`** — takes either a backlog id (`/ticket P2-T12`) or a
Jira key (`/ticket TRIMR-21`), since people work off the Jira board. Resolve a Jira key by matching
`jiraKey:` in the backlog. That loads `QUICKTRIMR_TICKET_PROMPT.md`, which carries the readiness gate,
drift protocol, testing mandate and report format. Without the command, read that file and follow
it anyway.

Do not work from a ticket pasted into chat, and do not work from Jira — read the ticket from the
backlog, so there is one copy and it cannot drift. If asked to do something a ticket does not
say, the ticket is wrong: fix the ticket first.

**To audit code, run `/audit`** (Codex: `$audit-quicktrimr-code`). It holds code, architecture, and
technical decisions to the brightest-engineer bar and to the non-negotiables below — RLS, client
identity, address and location exposure, integer-cent money from snapshots, capture and payout
idempotency, no client-side timers, config-not-literals, PostGIS server-side, Google server keys out
of the bundle, domain purity, truthful copy — plus wasted API/DB calls, dead code, and missed reuse.
Run it manually, and run it automatically as part of ticket work: after a ticket slice is delivered
and after any code change, before the Definition of Done (`QUICKTRIMR_TICKET_PROMPT.md §7`). It is
advisory — it reports ranked findings, never edits code, and never resolves a `TBC-*` or a decision
for you. Source of truth: `QUICKTRIMR_AUDIT_PROMPT.md`.

**Decision tickets are not build tickets.** `P0-D01`–`P0-D06` and `P0-D08` are `issueType:
Decision` in the backlog; `P0-D07` is a `Spike`. Their deliverable is a knowledge base edit, and
the decision is Tony's or Andrew's, not yours: research, frame the options, recommend, then stop
and ask. Never pick the commission percentage, the refund split, the reliability thresholds, or
the launch service categories yourself.

Classify from the backlog, not Jira — Jira shows all of them as `Task` with a `decision` label,
because the project has no Decision or Spike type. See `QUICKTRIMR_TICKET_PROMPT.md` §1.

**The knowledge base is upstream.** Conflict priority, highest first: KB → backlog → proposal →
your assumptions. Your assumptions lose to everything.

**Never code-first on a decision.** If a decision gets made, it goes into the KB with a stable ID,
then the ticket, then `§8 Traceability` gets checked for affected tickets, then code. Code that
encodes an undocumented decision is a decision nobody made.

**If a rule doesn't exist, it is not decided.** Do not guess a value, a bound, an enum, a
percentage, or a rounding rule. Raise a `TBC-*` in `KB §14` and stop. Quietly picking a plausible
value is the most damaging thing available here — nobody reviews a plausible value, and it is
found when it is expensive.

**Stable IDs, not section numbers.** Cite `ADR-006`, `RULE-AVAIL-05`, `CFG-COMMISSION-PCT`. Never
"see section 9". IDs are permanent; never renumber, never reuse, never delete a `TBC-*`.

**Sections 8 and 9 of the backlog are generated.** Never hand-edit them. They regenerate on `main`
via CI — do not regenerate on a branch, it only creates conflicts.

## Non-negotiables

These are from the KB. They are not style preferences.

- Every table has RLS. A table without it is a bug. Verify denial at the API, never the UI.
- Never trust a client for identity, role, status, amount, or permission. The user id comes from
  the verified JWT, never the body.
- Money is integer cents. Amounts come from the booking's snapshot, never the request.
- Every external money call is idempotent on a deterministic, server-derived key. Capture happens
  once; a duplicate call charges once.
- A failed capture never leaves a booking confirmed with no money — it stays
  `accepted_pending_payment`.
- Never hold a database lock across a Stripe call.
- Statuses are backend-controlled and written to `booking_status_history`. A frontend never sets one.
- **No client-side timers for anything that matters.** A backgrounded phone must not stop a request
  expiring or an earning releasing.
- Business rules live in `packages/domain`, pure, no I/O. Refund maths, commission split, expiry
  arithmetic and reliability transitions all belong there.
- Config values (`KB §13`) are read from config. A literal `5`, `12`, `20`, `60` or `2` in a
  feature is a defect.
- Location filtering is PostGIS in the database. Google Routes and Places are called server-side
  only; the server key never reaches the mobile bundle.
- A barber sees a client's address and contact details only for an accepted, **active** booking.
- Never log a secret, a card number, or a full Stripe payload.
- `RULE-COPY-01` — do not imply live tracking, do not call a hold a charge, and do not describe a
  QuickTrimr balance as money in a bank account.

## Ownership

Vertical (`ADR-012`). One named owner per ticket, delivering migration → RLS → function → UI →
tests. **Tony** owns money and trust: Stripe, capture, refunds, earnings, payouts, cancellations,
disputes, reliability, the workflow engine, schema and RLS, admin, access control, audit logs.
**Andrew** owns the marketplace: auth, profiles, addresses, onboarding, catalogue and pricing,
Available Now, discovery, requests, accept/decline, booking and job views, ETA, completion,
reviews, notifications, analytics, mobile shell, Wix.

There is no "Shared" owner and no separate integration ticket — integration is inside the ticket.

## Commands

```bash
node scripts/jira/generate-indexes.mjs --check   # validate the ticket graph
node scripts/jira/generate-indexes.mjs           # regenerate §8/§9 (main only)

# Jira — needs: set -a && source scripts/jira/.env && set +a
node scripts/jira/create-tickets.mjs --whoami                    # accountIds, AC field, issue types
node scripts/jira/create-tickets.mjs --phase 1 --dry-run         # render, no API calls
node scripts/jira/create-tickets.mjs --phase 1                   # create a phase, one phase at a time
node scripts/jira/create-tickets.mjs --update --phase 0 --dry-run # diff backlog against Jira
node scripts/jira/create-tickets.mjs --update --phase 0          # re-push changed tickets, backfill links
```

`--check` catches dangling references, dependency cycles, later-phase dependencies, owners that
aren't exactly Tony or Andrew, and rules cited before the decision that writes them exists.

**Jira project key is `TRIMR`; its display name is QuickTrimr.** Issue keys look like `TRIMR-14`;
the original Phase 0 set is `TRIMR-1` (epic) through `TRIMR-27`. `create-tickets.mjs` pins that key in code and refuses to run against anything else —
myClean is `MC` on the same Atlassian site and both repos export identical variable names, so a
stale `source` would otherwise file QuickTrimr tickets onto the myClean board. Never edit the constant
to make a refusal go away.

`--update` only touches tickets whose backlog entry actually changed, tracked by a fingerprint
stored on each issue. If someone deliberately changed an owner in Jira, fix the backlog to match
before running it — otherwise you will push their decision back out.

## Current state

Phase 0 is 27 tickets: 19 foundation, 8 decisions. **The 8 decision tickets gate 63 of the other
99 tickets** — an agent handed `P3-T07` before `P0-D03` closes will correctly refuse, because it
cannot know the refund split. That is intended behaviour, not broken tooling.

`P0-D02` (commission and Stripe fee absorption) is the highest-stakes decision: it is snapshotted
onto every booking, and every earning, refund and payout derives from it.

`P0-D07` (the workflow engine) is the widest: six tickets across four phases cannot be built until
something runs delayed work reliably, and the previous backlog never assigned that to anyone.
