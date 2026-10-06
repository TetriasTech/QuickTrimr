import { readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Match substrings too: adding EXPO_PUBLIC_ or NEXT_PUBLIC_ must not launder a secret.
export const serverOnlyNames = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_DB_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GOOGLE_MAPS_SERVER_API_KEY',
  'GOOGLE_SERVER_API_KEY',
  'GOOGLE_ROUTES_API_KEY',
  'STRIPE_CONNECT_RETURN_URL',
  'STRIPE_CONNECT_REFRESH_URL',
  'JIRA_API_TOKEN',
  'SENTRY_AUTH_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
];

// Dependencies and generated artifacts are not authored app inputs. Native source,
// hidden files (including local .env), docs, tests and templates ARE scanned.
const generatedDirectories = new Set([
  'node_modules',
  '.git',
  '.next',
  '.expo',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  'Pods',
  '.gradle',
]);

export async function checkClientEnv(root) {
  const findings = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      const file = relative(root, path);
      if (entry.isDirectory() && generatedDirectories.has(entry.name)) continue;
      // Do not let a source symlink silently escape the scanned boundary.
      if (entry.isSymbolicLink()) {
        if (entry.name === 'node_modules') continue;
        findings.push({
          file,
          line: 1,
          rule: 'source symlink is not permitted',
        });
      } else if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          for (const name of serverOnlyNames) {
            if (line.toUpperCase().includes(name))
              findings.push({ file, line: index + 1, rule: name });
          }
        }
      }
    }
  }
  // A missing apps directory is an error, never a successful empty scan.
  await visit(resolve(root, 'apps'));
  return findings;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected arguments');
    const findings = await checkClientEnv(resolve(import.meta.dirname, '..'));
    for (const finding of findings) {
      // No source lines or values: local .env files may contain live credentials.
      console.error(
        `${finding.file}:${finding.line}: forbidden client reference (${finding.rule})`,
      );
    }
    if (findings.length) process.exitCode = 1;
    else console.log('Client environment boundary: PASS');
  } catch {
    console.error(
      'Client environment boundary: could not complete scan. Check arguments and filesystem access.',
    );
    process.exitCode = 1;
  }
}
