import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ASGS Edition 4, 14 October 2026. Pin the official distribution, rather
// than accepting an arbitrary GeoPackage as trusted boundary data.
const archiveSha256 =
  '2e075da92240a20763aac082d2ad904cd87a9ac9168ff6f67e42d5835c4fe33b';
const sourceUrl =
  'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-4-july-2026-june-2031/access-and-downloads/digital-boundary-files';
const attribution =
  'Australian Bureau of Statistics, Australian Statistical Geography Standard Edition 4, Suburbs and Localities 2026. © Commonwealth of Australia (ABS), CC BY 4.0. Transformed to WGS84 and representative points added by QuickTrimr.';
const member = 'ASGS_Ed4_Non_ABS_Structures_GDA2020.gpkg';
const layer = 'SAL_2026_AUST_GDA2020';
const vintage = 2026;
const datum = 7844;
const envelopeBytes = [0, 32, 48, 48, 64];
const csv = (part) => `"${part.replaceAll('"', '""')}"`;
const literal = (part) => `'${part.replaceAll("'", "''")}'`;

const [input, ...extra] = process.argv.slice(2);
if (!input || extra.length)
  throw new Error(
    `Usage: node scripts/db/import-abs-sal.mjs <official ASGS Edition 4 GeoPackage ZIP>`,
  );
const archive = resolve(input);
const sha256 = createHash('sha256');
for await (const chunk of createReadStream(archive)) sha256.update(chunk);
if (sha256.digest('hex') !== archiveSha256)
  throw new Error(
    'The ABS archive does not match the pinned official release.',
  );

function wkbOf(blob) {
  if (!blob) return null;
  const header = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const flags = header[3];
  const envelope = envelopeBytes[(flags >> 1) & 7];
  if (
    header.toString('ascii', 0, 2) !== 'GP' ||
    header[2] !== 0 ||
    envelope === undefined ||
    flags & 32
  )
    throw new Error('Unexpected ABS GeoPackage geometry header.');
  if (flags & 16) return null; // ABS non-spatial codes have no boundary.
  const srs = flags & 1 ? header.readInt32LE(4) : header.readInt32BE(4);
  if (srs !== datum) throw new Error('Unexpected ABS boundary datum.');
  return header.subarray(8 + envelope).toString('hex');
}

const dir = await mkdtemp(join(tmpdir(), 'quicktrimr-abs-sal-'));
try {
  execFileSync('unzip', ['-q', archive, member, '-d', dir]);
  const geopackage = new DatabaseSync(join(dir, member), { readOnly: true });
  try {
    const metadata = geopackage
      .prepare(
        'select geometry_type_name, srs_id from gpkg_geometry_columns where table_name = ?',
      )
      .get(layer);
    if (
      metadata?.geometry_type_name !== 'MULTIPOLYGON' ||
      metadata.srs_id !== datum
    )
      throw new Error('Unexpected ABS SAL layer or coordinate system.');
    const areas = geopackage.prepare(
      `select SAL_CODE_2026 as code, SAL_NAME_2026 as label, GEOM as geom from ${layer} order by SAL_CODE_2026`,
    );
    function* commands() {
      yield 'begin;\ncreate temp table sal_import (code text primary key, label text not null, wkb text not null) on commit drop;\n';
      yield 'copy sal_import (code,label,wkb) from stdin with (format csv);\n';
      let count = 0;
      for (const { code, label, geom } of areas.iterate()) {
        const wkb = wkbOf(geom);
        if (!wkb) continue;
        if (!/^\d{5}$/.test(code) || !label)
          throw new Error('Invalid ABS SAL code or label.');
        yield `${csv(code)},${csv(label)},${wkb}\n`;
        count += 1;
      }
      if (!count) throw new Error('The ABS SAL layer has no spatial records.');
      yield `\\.\n
        with raw as materialized (
          select code, label, extensions.st_transform(extensions.st_geomfromwkb(decode(wkb, 'hex'), ${datum}), 4326) as geom
          from sal_import
          where not exists (select 1 from public.public_areas a where a.vintage = ${vintage} and a.code = sal_import.code
            and a.archive_sha256 = ${literal(archiveSha256)})
        )
        insert into public.public_areas (id, code, label, vintage, source_url, attribution, archive_sha256, boundary)
        select 'sal:${vintage}:' || code, code, label, ${vintage}, ${literal(sourceUrl)}, ${literal(attribution)}, ${literal(archiveSha256)},
          extensions.st_multi(extensions.st_collectionextract(
            case when extensions.st_isvalid(geom, 0) then geom else extensions.st_makevalid(geom) end, 3))
        from raw order by code
        on conflict (id) do nothing;
        do $$ begin
          if (select count(*) from public.public_areas where vintage = ${vintage} and archive_sha256 = ${literal(archiveSha256)}) <> ${count} then
            raise exception 'Published SAL count differs from the pinned source';
          end if;
        end $$;
        commit;
        analyze public.public_areas;
        select vintage, archive_sha256, count(*) from public.public_areas
          where vintage = ${vintage} group by vintage, archive_sha256;\n`;
    }
    const psql = spawn(
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
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const outcome = new Promise((resolveRun, reject) => {
      psql.once('error', reject);
      psql.once('close', (code) =>
        code === 0
          ? resolveRun()
          : reject(new Error('ABS SAL database import failed.')),
      );
    });
    await Promise.all([
      pipeline(Readable.from(commands()), psql.stdin),
      outcome,
    ]);
  } finally {
    geopackage.close();
  }
} finally {
  await rm(dir, { force: true, recursive: true });
}
