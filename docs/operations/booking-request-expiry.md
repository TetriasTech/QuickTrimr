# Booking request expiry

`P2-T15` processes the deadlines stored by booking request creation. The
primary job and the reconciliation job both select pending rows by
`expires_at,id`. Only one scheduled batch can run at a time. Reconciliation
can recover an overdue request directly from its row after a missed job or a
rolled-back transaction. The transition locks the barber profile before the
request, checks the database clock, and commits the request, audit and any
Available Now receipt together.

## Run locally

From the repository root, with the QuickTrimr local Supabase stack running:

```sh
pnpm db:migrate
docker exec -i supabase_db_quicktrimr psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/operations/booking-request-expiry.sql
```

The installation updates the two named jobs in place. If an approved cadence
changes in platform configuration, rerun the installer to apply it. Other
settings are read by the worker or independent monitor. Restart the monitor
after changing its polling interval or thresholds.

Start the Edge Functions with the normal local workflow. The server-only
`expire-booking-request` function accepts a request ID and returns the
resulting status with `applied`. The scheduler runs the same transition
directly in Postgres. Runtime callers cannot access job management, health or
run history. Verify permissions, concurrency and recovery with:

```sh
node scripts/request-expiry/verify.mjs
node scripts/request-expiry/verify-capacity.mjs
node scripts/db/verify-booking-requests.mjs
```

The first command briefly pauses both local expiry jobs and restores their
original states on exit. It creates disposable fixtures, starts a separate
minute-level monitor and receives its alerts on a local HTTP listener.
Use a development stack without other active expiry tests. The capacity
command creates a schema-only database with synthetic rows and removes it
after measurement. It runs an actual pg_cron job using the migration's
transition and indexes.

## Inspect health

The separately running monitor can also point at a local test receiver:

```sh
node scripts/request-expiry/monitor.mjs http://127.0.0.1:PORT
```

It posts aggregate alert and recovery reasons only. A failed run, an old
heartbeat for either job, overdue requests or an unreachable database each
have their own reason. Operational timestamps can be read through the
operator connection with `select private.booking_request_expiry_health();`.
Compare the two heartbeats, the latest failure and the oldest due deadline.
Once the scheduler resumes, look for a fresh heartbeat and clearing overdue
work. Reconciliation prunes operational runs past the approved retention
period. Request audits and Available Now receipts are immutable.

The `booking_request.expired` audit and request ID identify the committed
deadline expiry. P3-T06 owns durable payment authorisation release. The local
receiver verifies alert delivery for this ticket's approved environment.
