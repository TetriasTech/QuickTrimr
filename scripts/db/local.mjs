import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = resolve(import.meta.dirname, '../..');
export const projectId = 'quicktrimr';

export function commandArgs(command, args = []) {
  if (command === 'new') {
    if (args.length !== 1 || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(args[0]))
      throw new Error(
        'Use db:new <lower_snake_case_name>; flags and paths are not accepted.',
      );
    return ['migration', 'new', args[0]];
  }
  if (command === 'serve') {
    if (args.length === 0)
      return ['functions', 'serve', '--env-file', 'supabase/.env.example'];
    if (
      args.length === 2 &&
      args[0] === '--env-file' &&
      args[1] === 'supabase/.env.local'
    )
      return ['functions', 'serve', '--env-file', 'supabase/.env.local'];
    throw new Error(
      'Only --env-file supabase/.env.local is accepted by functions:serve.',
    );
  }
  if (args.length !== 0)
    throw new Error(
      'Local database commands do not accept target flags or extra arguments.',
    );
  const commands = {
    start: ['start', '--yes'],
    stop: ['stop', '--project-id', projectId],
    reset: ['db', 'reset', '--local'],
    'reset-empty': ['db', 'reset', '--local', '--no-seed'],
    migrate: ['migration', 'up', '--local'],
  };
  if (!Object.hasOwn(commands, command))
    throw new Error('Unknown local workflow command.');
  return commands[command];
}

export function assertLocalProject() {
  const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
  if (!/^project_id = "quicktrimr"$/m.test(config))
    throw new Error('Refusing to run with a different local project ID.');
}

export function runLocal(
  command,
  args = [],
  { run = spawnSync, env = process.env } = {},
) {
  const cliArgs = commandArgs(command, args);
  assertLocalProject();
  const localEnv = { ...env };
  // Hosted operator credentials are irrelevant to local commands and are never forwarded.
  for (const name of Object.keys(localEnv))
    if (name.startsWith('SUPABASE_')) delete localEnv[name];
  const result = run(resolve(root, 'node_modules/.bin/supabase'), cliArgs, {
    cwd: root,
    env: localEnv,
    // Supabase start prints local private keys on stdout; keep those out of logs.
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (result.error)
    throw new Error(
      'Could not run the pinned Supabase CLI. Run pnpm install --frozen-lockfile.',
    );
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, ...args] = process.argv.slice(2);
    process.exitCode = runLocal(command, args);
    if (process.exitCode === 0) {
      console.log(`QuickTrimr local workflow: ${command} completed.`);
      if (command === 'start')
        console.log(
          'API: http://127.0.0.1:55321 | Studio: http://127.0.0.1:55323',
        );
      if (command === 'new')
        console.log(
          `Migration: supabase/migrations/<UTC timestamp>_${args[0]}.sql`,
        );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Local workflow failed.',
    );
    process.exitCode = 1;
  }
}
