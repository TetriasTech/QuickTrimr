# P2-T08 / TRIMR-51 audit

Scope: the complete slice against `b44061e` (merged main): migration, private RLS
snapshot table, request transaction and locks, pure policies/SQL parity,
shared validation, Edge controller, live fixtures and acceptance evidence.
Applied `QUICKTRIMR_AUDIT_PROMPT.md` A–F. Generated sections were excluded.

**Major — E/F, lock-order inversion (fixed).** The initial transaction took a
Connect account child lock after its barber profile lock. The existing
`finish_stripe_connect_refresh` takes its account lock before publishing profile
verification. That pair could deadlock, rolling back a valid request or refresh.
The request now reads committed Connect facts without acquiring the account lock;
it retains profile serialization and the shared eligibility checks. No Stripe or
other network call occurs inside the transaction. Five real parallel local API
refresh/request races pass: request returns 200 or the expected 409, refresh
returns 200, and a request after committed eligibility loss returns 409.
The correction is in `20261122020000_create_booking_request.sql`, at the Connect
gate immediately after loading the barber.

**Minor — F, stale proof artifact (fixed).** A failed verifier could leave an older
`api.json` showing PASS. The script now marks evidence RUNNING before local setup
and INCOMPLETE during cleanup. Only successful normal completion writes PASS.
No account, address, note, credential or provider payload is included in that file.

Final review checked:

- A: verified JWT/stored role, server-only RPC, per-verb API denial, private
  immutable snapshots, narrow raw response, integer cents/rounding/config,
  source-session identity, no payment or provider call, no new disclosure window.
- B: one mutation RPC after shared auth; primary-key/unique target lookups;
  indexed bounded EXISTS checks; PostGIS on one selected target; no supply scan,
  Google call, polling or repeated provider lookup.
- C/D: new runtime entrypoint/config/export wired; existing request/response
  schemas, auth, JSON response, saved-address shape, reliability helper and
  append-only trigger reused. SQL mirrors pure rules for atomicity and are
  field-by-field parity-tested, including DST and uneven cents.
- E/F: all 15 acceptance criteria, real concurrent same-target and cross-target
  submissions, concurrent refresh, source replacement, exact deadlines, rollback
  and current-state denial, preserved historical snapshots and fixture cleanup.
  No submission UI, booking creation, payment wiring or expiry worker added.

VERDICT: two findings — zero Critical, one Major fixed, one Minor fixed.
Final A–F review: no unresolved findings. Human review and merge remain required.
