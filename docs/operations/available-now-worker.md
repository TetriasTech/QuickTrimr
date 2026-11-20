# Available Now worker — P2-T03

The approved hosted test target, monitor identity, recipient and development
settings are pinned in the KB's `CFG-AVAIL-WORKER-*` rows. Operator commands refuse
an unexpected linked project, organization or unhealthy target. This feature's
branch-deployment exception applies only to that isolated test project. Production
rollout is a separate authorization; these measurements are not a production SLA.

After application migrations, install the versioned extension/permission/schedule
setup in `supabase/operations/available-now-worker.sql`:

```bash
node scripts/availability/worker-operator.mjs hosted install
node scripts/availability/worker-operator.mjs hosted configure-monitor
node scripts/availability/worker-operator.mjs hosted status
```

`configure-monitor` reads only `SENTRY_WORKER_DSN` from the ignored backend
`supabase/.env.local`, validates the exact destination and stores it in Vault as
`available_now_worker_dsn`. It refuses an existing different credential. Never
print the file, expose the DSN to mobile/admin or paste it into shell arguments.
Local lab tests do not need a Sentry credential; avoid sending local test noise.
Run hosted database CLI operations sequentially.

There are exactly two fixed feature jobs, not one job per barber:

- `quicktrimr.available_now.expiry`: indexed due-session scan, configured batch
  limit, profile-before-session locking, skip locked parents and one sweep lock.
- `quicktrimr.available_now.health`: safe failure / heartbeat / oldest-due checks,
  delivery reconciliation and bounded operational retention, then a minute Sentry
  check-in. pg_net sends after commit; no network call holds the row locks.

The deadline and current session state are authoritative. A dropped tick leaves
work discoverable; an aborted transaction releases claims and rolls back state and
audits. The next successful sweep retries it. Running install again updates the
same named schedules. It does not reactivate a barber's ended availability.

Check health using the operator `status` command and Sentry's code-managed
`available-now-worker-health` monitor in `development`. Monitor details show the
minute schedule, first failed/recovered check-in, and the project email alert for
Joel. Sentry detects a missing heartbeat even when both database jobs stop. A green
cron run alone is insufficient: a handled worker failure is recorded separately,
and monitor failures remain unacknowledged until a 2xx ingest response is observed.

Operational evidence is private: worker state, safe run/error-code records,
failure receipts and delivery status. Thirty-day pruning never removes business
`audit_logs`, request outcome receipts, booking history or reliability history.
Do not inspect or export the Net queue or decrypted Vault contents for diagnostics.
Managed Net/Vault ownership remains unchanged and their schemas stay outside the
Data API. All new QuickTrimr-owned tables enable RLS and deny runtime access.

Controlled proof commands create only synthetic test fixtures:

```bash
node scripts/availability/verify-worker.mjs local
node scripts/availability/verify-worker.mjs hosted
node scripts/availability/verify-worker.mjs hosted --capacity-only
node scripts/availability/verify-monitor.mjs hosted
```

The monitor proof pauses/resumes the two jobs, injects safe synthetic overdue / bad
config / stale-heartbeat conditions, and leaves a three-minute missing-check-in
window. It restores the original job states and removes its disposable fixtures.
Run it only while the isolated target is free of real users and with the approved
recipient aware of test emails. Check the final `restored` record; after any process
or network interruption, run `install` and `status`, then verify a recovered Sentry
check-in before considering the test finished. Keep immutable audit evidence.

The local PostgreSQL 17.6 build crashed when directly executing a forbidden private
function under `SET ROLE authenticated`. Do not repeat that platform probe on the
user's data-bearing stack. The migration proof checks exact ACLs, and the running
API proof verifies actual runtime denial. A safe local database upgrade can revisit
the provider bug without weakening access controls or resetting application data.
