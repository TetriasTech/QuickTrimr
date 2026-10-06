# P0-D07 / TRIMR-8 — disposable scheduling laboratories

This is a spike, **not a production workflow engine**. No application imports these files.
The synthetic `pending/accepted/expired` fixture is deliberately not the booking model. It
does not implement payment holds, acceptance eligibility, notifications or status history.
Do not copy it into a migration. Production rules remain in the KB and `packages/domain`.

## PostgreSQL and pg_cron

Prerequisites: Node 24+, Docker running, and the pinned images available (Docker pulls them if
missing). From the repository root:

```sh
node scripts/spikes/P0-D07/pg-cron-proof.mjs
```

Allow about five minutes: a real deadline from `CFG-AVAIL-EXPIRY-MIN` runs while the other
checks execute. The six-hour example uses a private injected clock and finishes immediately.
The one-second cron cadence, batch size, synthetic history volume and timeouts are **lab
parameters**, not approved production configuration.

The runner creates uniquely named/labelled containers from PostgreSQL `17.6.1.167` and
PostgREST `v16.2`, without host ports, bind mounts, existing databases or `.env` files.
PostgreSQL has no external network; PostgREST shares only its isolated network namespace.
Trust authentication is permitted only inside that disposable namespace. JWTs use a generated
throwaway secret; two synthetic signed-in users and an anonymous caller exercise every table
verb and the private RPC boundaries through actual HTTP responses.

The checks exercise exact deadlines, repeated parallel duplicates, cancellation/stale calls,
accept/expiry atomicity, dropped schedules, paused/restarted sweeps, failed-run history,
indexed bounded claims under contention, RLS and append-only effect evidence. They test a
database-local effect, **not** exactly-once external delivery, process-crash recovery, Stripe,
cloud latency, durable worker leases or production capacity.

Normal success/failure removes only this run's labelled containers, including their synthetic
data. A force-killed process may not run cleanup. Inspect `docker ps -a --filter
label=quicktrimr.spike` and verify the exact printed name/label before removing any leftover
lab container. Never stop or reset an existing Supabase project for this proof.

## Optional Inngest comparison

This standalone npm project is outside the pnpm workspace; it does not add a runtime app
dependency. From the repository root:

```sh
npm ci --prefix scripts/spikes/P0-D07/inngest --workspaces=false --no-audit --no-fund
node scripts/spikes/P0-D07/inngest/proof.mjs
npm audit --prefix scripts/spikes/P0-D07/inngest --workspaces=false
```

SDK `4.21.1`, CLI `1.45.1`; the CLI archive dependency is overridden to patched `adm-zip`
`0.6.1`. The CLI installs its native binary. Run only on a trusted development machine:
the SDK and HTTP API bind loopback, but the CLI also opens internal development listeners.
All ports are selected separately from existing development-server defaults. Auto-discovery
is disabled, persistence is disabled, and only synthetic events are sent to the explicit
local base URL. No real keys or `.env` are loaded or passed to the child. The CLI may warn
that its home-directory variable is absent; no account configuration is needed.

Tests cover ten short real sleeps, reported wake-up offsets, refusal of any early wake-up,
reconciliation, matching cancellation, a fresh duplicate event, and run-status API evidence.
The state store is memory: this comparison **cannot prove database concurrency or durability**.
An early wake-up must not apply an effect early; the explicit reconciliation event recovers
it after the deadline. This is not a production scheduler latency guarantee. Servers shut
down on success/failure. This test is intentionally not part of the application's CI suite.

## Costs and evidence

```sh
node scripts/spikes/P0-D07/cost-model.mjs
```

The calculator includes seven assertions and prints workload counts, paid-plan scenarios and
compute-duration sensitivity. Assumptions are planning inputs, not product configuration.
See `docs/decisions/P0-D07.md` for the approved decision and sources, and `docs/qa/P0-D07.md`
for actual results and limitations. Trigger.dev has not been run; its documentation-only
comparison was explicitly approved. None of these fixtures is a production implementation.
