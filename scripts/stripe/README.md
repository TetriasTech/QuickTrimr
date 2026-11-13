# Stripe scripts

Local verification for P0-T18 / TRIMR-27. The approved design is `RULE-PAY-12`; this is not
production onboarding, a payment service, a payout worker or a durable webhook inbox.

## Credentials and environment

Use the customer's **Quick Trimr sandbox**, not live mode or the shared test-mode view.
Put its test/restricted API credential in `STRIPE_SECRET_KEY` in ignored `supabase/.env.local`.
Use the least permissions needed for the selected account/payment operations. Never paste keys
into chat, a command argument, a screenshot, a committed example or an app environment file.
The root `.env` is not loaded. No credentials are bundled into mobile/admin.

Before inspecting browser content, check the tab URL using metadata only. Do not capture an
API-keys page, a revealed-secret view or an expanded raw event/request payload. If a secret
appears in tool/log output, stop using it, notify the owner and require rotation plus replacement
of the ignored env value. Do not assume test keys or Git ignore rules make disclosure safe.

Do not capture full account/profile or bank-detail pages. Inspect only specifically named
navigation, controls and status fields; do not retrieve a full page and redact it afterward.
Never print or save phone, identity or bank values, including from test profiles. A fixture
created as synthetic does not independently establish what a human later entered.

`STRIPE_WEBHOOK_SECRET` must be the signing secret for the selected local listener/destination;
an unrelated endpoint secret cannot verify its events. The official SDK verifies raw request
bytes and uses its default signature timestamp tolerance. The probe does not require an API key
and disables API authentication entirely.

## Local signed-webhook and callback probe

```sh
node --env-file=supabase/.env.local scripts/stripe/local-probe.mjs
```

Binds **127.0.0.1 only**, using `CFG-DEV-PROVIDER-URLS` from the KB:

- POST `http://127.0.0.1:4242/stripe/webhook`: verifies the signature and rejects live-mode or
  malformed events. Only event ID/type are retained; no card/bank/person fields or full payloads.
- GET `/connect/return` and `/connect/refresh`: record local redirects without reflecting query
  values or claiming onboarding succeeded. Real account eligibility must be rechecked in Stripe.
- GET `/health` and `/evidence`: local, redacted diagnostic status only; no CORS access is enabled.

After authenticating the official Stripe CLI to the **same sandbox**, forward both platform and
connected-account events to the webhook route using the CLI's documented listener options. Obtain
the listener secret privately and set `STRIPE_WEBHOOK_SECRET` before starting this probe. The probe
never starts a CLI listener or prints its signing secret itself.

The HTTP probe has a 1 MiB body limit, five-second request/header timeout, and room for 1000
unique event IDs. At capacity it rejects new events rather than forgetting prior deduplication.
Its in-memory deduplication disappears on restart and has **no business effects**. Passing these
tests is not proof of a production money ledger, application idempotency, thin v2 notification
handling or real Stripe delivery; capture the latter separately against the actual listener.

## Manual capture and provider idempotency proof

```sh
node --env-file=supabase/.env.local scripts/stripe/verify-manual-capture.mjs --account <sandbox-account-id>
```

Before any money call, the script rejects live keys and verifies the credential's own account
against the explicitly selected Australian/AUD sandbox. It uses Stripe's named test PaymentMethod
and the 4500-cent KB worked example, not card numbers, booking data or a real payment method.

It repeats creation/capture with deterministic account/case-derived keys, checks that the observed
capture deadline covers both configured pending windows, retrieves the resulting charge and emits
only selected IDs, test amounts, statuses and deadline evidence. It does not create a booking or
earning. Provider failures are not logged with raw errors or full payloads.

Run against the approved account once and preserve the safe output. Inspect the Dashboard's
`verification_ticket=P0-T18` metadata before retrying an uncertain result. Stripe idempotency
retention is finite; this test helper is not durable cross-run/weekly reconciliation and does not
prove a second run after key expiry cannot create another **test** payment. A failed assertion
may leave a test authorization to reconcile in the sandbox; never assume it was cancelled.

The actual P0-T18 run has Visa capture, 3DS-required/cancelled proof, signed platform/connected
delivery, active Connect capabilities and actual hosted return/refresh callbacks, recorded in
[the QA report](../../docs/qa/P0-T18.md). A separate one-cent AUD transfer and standard bank
payout reused their respective IDs under duplicate calls; the payout reached `paid`. This is
a sandbox provider-boundary test, not a production earning or weekly payout worker. Express
manual payouts and schedule editing are off; complete Instant prevention, bank correction and
production fee-invoice proof remain unverified. Genuine capture-time failure also remains
outstanding. No authorization-decline fixture is claimed to fail at capture.

Official CLI 1.53.1 was invoked from its npm package without a global installation. For the
one-off delivery verification, the verified sandbox credential was mapped to the CLI's
`STRIPE_API_KEY` child-process environment, never an argument. CLI stdout/stderr stayed private
to the parent process; its listener signing secret was extracted in memory and passed to
`createProbe` without printing or persisting it. The listener forwarded filtered snapshot
events to loopback and was terminated after the run. This does not populate a persistent
`STRIPE_WEBHOOK_SECRET` or establish connected-account/thin-event delivery.

A later, separate ephemeral observer verified an actual v2 connected-account notification with
`Stripe.parseEventNotification`, provider event/account correlation, invalid-signature rejection
and 48 parallel duplicate replays. See the QA report and architecture reproduction notes. This
does not add thin-event support to `local-probe.mjs`, which remains snapshot-only, or provide a
durable business webhook handler. Never send a v2 notification to `constructEvent` and claim it
was handled successfully.

## Checks

```sh
node --test scripts/stripe/*.test.mjs
```

These local tests exercise actual SDK signature verification, replay/invalid/live rejection,
parallel deduplication, capacity, callback copy and credential/account guards. Synthetic events
and fake account responses test the verifier's protections; they are not provider setup evidence.
