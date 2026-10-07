import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { projectId } from './local.mjs';

export function queryLocal(sql) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      `supabase_db_${projectId}`,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0)
    throw new Error('Local database query failed. Run pnpm db:start first.');
  return result.stdout.trim();
}

export function verifyPostgis() {
  const version = queryLocal('select extensions.postgis_full_version();');
  const distance = Number(
    queryLocal(
      'select round(extensions.st_distance(extensions.st_setsrid(extensions.st_point(0, 0), 4326)::extensions.geography, extensions.st_setsrid(extensions.st_point(1, 0), 4326)::extensions.geography))::integer;',
    ),
  );
  if (!version.includes('POSTGIS=') || distance < 111000 || distance > 112000)
    throw new Error('PostGIS geography verification failed.');
  return { version, distance };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 2)
      throw new Error('db:verify accepts no arguments.');
    const { version, distance } = verifyPostgis();
    console.log(version);
    console.log(
      `PostGIS geography: PASS (one equatorial degree = ${distance} metres).`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Local verification failed.',
    );
    process.exitCode = 1;
  }
}
