import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import * as schemas from '../../packages/validation/src/contracts/index.ts';
import {
  API_FIXTURES,
  CONTRACT_DETAILS,
} from '../../packages/validation/src/fixtures.ts';

export function renderContracts() {
  const lines = [
    '# QuickTrimr API contracts',
    '',
    'P0-T08 / TRIMR-17: executable contract foundation, not implemented endpoints.',
    'Source: KB function inventory, shared Zod schemas and contract-details metadata.',
    'This file is a deterministic projection; edit schemas/examples/metadata together,',
    'then use scripts/api/contracts.mjs to render and --check to detect drift.',
    '',
    '## Boundaries and usage',
    '',
    '- User calls: verified JWT identity, server-resolved role AND entity ownership; never trust body identity/status/amounts. An inventory entry is not a permission grant.',
    '- Server calls: internal authenticated services/workers only, not public mobile/admin controls. The response/status codes below describe the logical transport contract, not a deployed HTTP endpoint.',
    '- Stripe: authenticate the original raw bytes before SDK decoding or Zod parsing. The unsigned event example is a minimal decoded envelope, not a signature test or complete provider object schema.',
    '- Success is 200. All ordinary failures use strict `{ "error": "stable_code", "fields"?: { "field": "message" } }`; no raw errors, provider payloads, secrets, decline objects or ad hoc status properties. Field errors require safe messages. Read authoritative state separately when needed.',
    '- Schema validity is NOT authorization, idempotency, deadline, eligibility or financial correctness. Owning tickets must test those against actual APIs/database/provider sandboxes. No handlers, migrations, RLS changes, mock routes or payment flows are implemented here.',
    '- Money is integer AUD cents. Snapshots, current eligibility, configured bounds and cumulative refunds are server-owned. The admin partial-refund intent exception does not allow an admin to choose charged/net/commission amounts. Do not use illustrative fixture numbers as operational config.',
    '- Worker clocks, keys and deadlines are server-derived; early/stale/duplicate delivery rechecks persisted state. Payout paid means verified bank payout, not transfer success. An open dispute blocks release. Never hold a database lock across a provider call.',
    '- SAL mapPoint is an area representative point, never the barber position. Public responses reject address/contact, exact origin/distance and routing payload additions.',
    '- Existing Phase 2 acceptance returns accepted_pending_payment. Later capture wiring must coordinate schema/example/docs changes rather than silently reporting paid confirmation.',
    '- mark-on-the-way accepts both coordinates or neither to support denied permission; it does not start location reads before consent. Errors are normalized to the P0-T07 envelope (see affected backlog examples).',
    '',
    '## Development fixtures',
    '',
    'Opt in through `docs/api/fixtures/index.mjs`, or the typed `@quicktrimr/validation/fixtures` package subpath. Neither entry is imported by production routes. Do not use fixture data as a network-failure fallback or authentication bypass.',
    '',
    '```ts',
    "import { API_FIXTURES } from '@quicktrimr/validation/fixtures';",
    "const fixture = API_FIXTURES['search-available-now-barbers'];",
    '// fixture.request / fixture.response are inferred from the shared schemas.',
    '// fixture.errors contains { status, body } for each documented failure.',
    '```',
    '',
    'All names, phone values, IDs, URLs, dates and profile descriptions are synthetic examples. Connect links are nonfunctional; the phone fixture must never be called. No credentials, real address, bank details, card data or customer profile data are included. Empty search/list results use `{ "results": [], "nextCursor": null }`; a payout empty tick has no batch and zero totals.',
    '',
    'The fixture import smoke tests bundle and execute from each app directory in an isolated browser-like context without process/env/network. They prove importability, not a running product feature or native/provider integration.',
    '',
    '## Function contracts',
    '',
  ];
  for (const name of Object.keys(schemas.CONTRACTS).sort()) {
    const contract = schemas.CONTRACTS[name];
    const detail = CONTRACT_DETAILS[name];
    const fixture = API_FIXTURES[name];
    const schemaName = (side) =>
      Object.entries(schemas)
        .filter(
          ([key, value]) =>
            key.endsWith(`${side}Schema`) &&
            value === contract[`${side.toLowerCase()}Schema`],
        )
        .map(([key]) => `\`${key}\``)
        .join(', ');
    lines.push(
      `### ${name}`,
      '',
      `Owner ticket: ${detail.owner}. Caller: **${detail.caller}**. Roles: ${detail.roles.join(', ') || 'no user role; authenticated internal service or verified provider only'}.`,
      '',
      `Rules: ${detail.rules.map((rule) => `\`${rule}\``).join(', ')}.`,
      '',
      detail.notes,
      '',
      `Shared request schema: ${schemaName('Request')}.`,
      `Shared response schema: ${schemaName('Response')}.`,
      'Exports: [packages/validation contracts](../../packages/validation/src/contracts/index.ts). Payload types are z.infer, not parallel interfaces.',
      '',
      'Request (decoded envelope only for Stripe):',
      '',
      '```json',
      JSON.stringify(fixture.request, null, 2),
      '```',
      '',
      '200 response:',
      '',
      '```json',
      JSON.stringify(fixture.response, null, 2),
      '```',
      '',
      '| Status | Error response | When |',
      '| --- | --- | --- |',
    );
    detail.errors.forEach((error, index) =>
      lines.push(
        `| ${error.status} | \`${JSON.stringify(fixture.errors[index].body)}\` | ${error.condition.replaceAll('|', '\\|')} |`,
      ),
    );
    lines.push('');
  }
  return lines.join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.argv.slice(2).some((arg) => arg !== '--check') ||
    process.argv.length > 3
  )
    throw new Error('Usage: node scripts/api/contracts.mjs [--check]');
  const rendered = renderContracts();
  if (process.argv.includes('--check')) {
    if (
      (await readFile(
        new URL('../../docs/api/contracts.md', import.meta.url),
        'utf8',
      )) !== rendered
    )
      throw new Error(
        'API docs drift: render scripts/api/contracts.mjs and update docs/api/contracts.md alongside schemas/examples/metadata.',
      );
    console.log(
      `API contracts: ${Object.keys(API_FIXTURES).length} documented functions; no drift`,
    );
  } else process.stdout.write(rendered);
}
