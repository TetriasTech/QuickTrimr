import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const states = ['ACT', 'NSW', 'NT', 'OT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const publishBatchSize = 25_000;
const [archive, ...args] = process.argv.slice(2);
const selected = args.length === 0 ? states : args.slice(1);
if (
  !archive ||
  !/gda94.*\.zip$/i.test(basename(archive)) ||
  (args.length && args[0] !== '--local-states') ||
  !selected.length ||
  selected.some((state) => !states.includes(state)) ||
  new Set(selected).size !== selected.length
)
  throw new Error(
    'Usage: node scripts/db/import-gnaf.mjs <official GDA94 zip> [--local-states NSW VIC ...]',
  );

const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  .trim()
  .split('\n');
const standard = entries.find((entry) =>
  entry.endsWith('/Standard/ACT_ADDRESS_DETAIL_psv.psv'),
);
const vintage = standard?.match(/\/G-NAF ([A-Z]+ [0-9]{4})\/Standard\//)?.[1];
if (!standard || !vintage)
  throw new Error('Expected an official Geoscape G-NAF Standard release');

const hash = createHash('sha256');
for await (const part of createReadStream(archive)) hash.update(part);
console.log(`G-NAF ${vintage} GDA94 SHA-256 ${hash.digest('hex')}`);

const staging = `gnaf_import_${randomBytes(6).toString('hex')}`;
const psql = (sql, stdio) =>
  spawn(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_quicktrimr',
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=terse',
      '-U',
      'postgres',
      '-d',
      'postgres',
      ...(sql === undefined ? [] : ['-c', sql]),
    ],
    { stdio },
  );

function outcome(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`G-NAF ${label} failed`));
    });
  });
}

async function run(sql, label) {
  await outcome(psql(sql, ['ignore', 'inherit', 'inherit']), label);
}

async function runPublication(sql, label) {
  const db = psql(undefined, ['pipe', 'inherit', 'inherit']);
  await Promise.all([
    pipeline(Readable.from([sql]), db.stdin),
    outcome(db, label),
  ]);
}

async function load(table, suffix) {
  const matches = entries.filter((entry) => entry.endsWith(suffix));
  if (matches.length !== 1)
    throw new Error(`Expected one G-NAF file for ${table}`);
  const member = matches[0];
  const probe = spawn('unzip', ['-p', archive, member], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: probe.stdout, crlfDelay: Infinity });
  let header;
  for await (const line of lines) {
    header = line
      .replace(/^\ufeff/, '')
      .split('|')
      .map((field) => field.toLowerCase());
    break;
  }
  probe.kill();
  if (
    !header?.length ||
    header.some((field) => !/^[a-z][a-z0-9_]+$/.test(field))
  )
    throw new Error(`Invalid G-NAF header for ${table}`);
  await run(
    `create unlogged table ${staging}.${table} (${header.map((field) => `${field} text`).join(', ')}); alter table ${staging}.${table} enable row level security`,
    'staging',
  );
  const source = spawn('unzip', ['-p', archive, member], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const db = psql(
    `copy ${staging}.${table} from stdin with (format csv, header true, delimiter '|', quote E'\\001')`,
    ['pipe', 'ignore', 'ignore'],
  );
  await Promise.all([
    pipeline(source.stdout, db.stdin),
    outcome(source, 'unzip'),
    outcome(db, table),
  ]);
  await run(`analyze ${staging}.${table}`, 'staging statistics');
}

await run(
  `
  create schema ${staging};
  create unlogged table ${staging}.ready (
    id text not null, line1 text not null, line1_long text not null, suburb text not null,
    state text not null, postcode text not null, unit text not null,
    location extensions.geography(Point, 4326) not null
  );
  alter table ${staging}.ready enable row level security;
`,
  'setup',
);
try {
  await load(
    'street_types',
    '/Authority Code/Authority_Code_STREET_TYPE_AUT_psv.psv',
  );
  for (const state of selected) {
    for (const [table, file] of Object.entries({
      detail: 'ADDRESS_DETAIL',
      geocode: 'ADDRESS_DEFAULT_GEOCODE',
      street: 'STREET_LOCALITY',
      locality: 'LOCALITY',
      jurisdiction: 'STATE',
    }))
      await load(table, `/Standard/${state}_${file}_psv.psv`);

    await run(
      `
      set enable_nestloop = off;
      insert into ${staging}.ready
      select d.address_detail_pid,
        concat_ws(' ', parts.number, s.street_name, coalesce(t.name, s.street_type_code), s.street_suffix_code),
        concat_ws(' ', parts.number, s.street_name, s.street_type_code, s.street_suffix_code),
        l.locality_name, j.state_abbreviation, d.postcode,
        concat(d.flat_number_prefix, d.flat_number, d.flat_number_suffix),
        extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(
          g.longitude::double precision, g.latitude::double precision
        ), 4283), 4326)::extensions.geography
      from ${staging}.detail d
      join ${staging}.geocode g using (address_detail_pid)
      join ${staging}.street s using (street_locality_pid)
      join ${staging}.locality l on d.locality_pid = l.locality_pid
      join ${staging}.jurisdiction j using (state_pid)
      left join ${staging}.street_types t on t.code = s.street_type_code
      cross join lateral (select case
        when d.number_first is not null then concat(d.number_first_prefix, d.number_first, d.number_first_suffix,
          case when d.number_last is not null then concat('-', d.number_last_prefix, d.number_last, d.number_last_suffix) end)
        when d.lot_number is not null then concat('LOT ', d.lot_number_prefix, d.lot_number, d.lot_number_suffix)
      end as number) parts
      where d.date_retired is null and g.date_retired is null and s.date_retired is null
        and l.date_retired is null and j.date_retired is null and j.state_abbreviation = '${state}'
        and g.geocode_type_code not in ('STL', 'LOC') and g.longitude is not null and g.latitude is not null
        and d.postcode ~ '^[0-9]{4}$' and parts.number is not null;
      drop table ${staging}.detail, ${staging}.geocode, ${staging}.street,
        ${staging}.locality, ${staging}.jurisdiction;
    `,
      state,
    );
    // Bound index pressure with ordered batches. Keep retired records until
    // every batch in the jurisdiction succeeds, and serialize publishers.
    await runPublication(
      `
    set work_mem = '16MB';
    set maintenance_work_mem = '32MB';
    set max_parallel_workers_per_gather = 0;
    select pg_advisory_lock(hashtext('quicktrimr-address-directory-import'));
    do $$ begin
      if not exists (select 1 from ${staging}.ready) then
        raise exception 'Selected jurisdiction produced no address points';
      end if;
    end $$;
    create index on ${staging}.ready (id);
    analyze ${staging}.ready;
    with ranked as (
      select id, row_number() over (order by id) as position from (select distinct id from ${staging}.ready) ids
    ), boundaries as (
      select id, lead(id) over (order by id) as upper_id from ranked
      where (position - 1) % ${publishBatchSize} = 0
    )
    select format($batch$
      insert into private.address_directory as d (id,line1,line1_long,suburb,state,postcode,unit,location)
      select distinct on (id) id,line1,line1_long,suburb,state,postcode,unit,location
      from ${staging}.ready where id >= %L and (%L is null or id < %L)
      order by id, (unit = '') desc, line1, suburb, location
      on conflict (id) do update
        set line1 = excluded.line1, line1_long = excluded.line1_long, suburb = excluded.suburb,
          state = excluded.state, postcode = excluded.postcode, unit = excluded.unit, location = excluded.location
      where (d.line1,d.line1_long,d.suburb,d.state,d.postcode,d.unit,d.location::text)
        is distinct from (excluded.line1,excluded.line1_long,excluded.suburb,excluded.state,
          excluded.postcode,excluded.unit,excluded.location::text)
    $batch$, id, upper_id, upper_id) from boundaries order by id
    \\gexec
    delete from private.address_directory d where d.state = '${state}'
      and not exists (select 1 from ${staging}.ready r where r.id = d.id);
    drop index ${staging}.ready_id_idx;
    truncate ${staging}.ready;
    select pg_advisory_unlock(hashtext('quicktrimr-address-directory-import'));
  `,
      `${state} publication`,
    );
    console.log(`Published address points from ${state}`);
  }
  await run(
    'analyze private.address_directory; select state, count(*) from private.address_directory group by state order by state',
    'published counts',
  );
} finally {
  await run(`drop schema ${staging} cascade`, 'staging cleanup').catch(() => {
    console.error(`Check local staging cleanup for ${staging}.`);
  });
}
