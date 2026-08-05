#!/usr/bin/env node
/**
 * Generates sections 8 (traceability) and 9 (reverse dependency index) of
 * TRIMR_BACKLOG_README.md from the ticket YAML headers, and validates the
 * ticket graph against TRIMR_KNOWLEDGE_BASE.md.
 *
 *   node scripts/jira/generate-indexes.mjs            # write the indexes
 *   node scripts/jira/generate-indexes.mjs --check    # validate only, exit 1 on error
 *
 * The indexes are derived. Never hand-edit them — edit the ticket headers.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BACKLOG = resolve(root, 'TRIMR_BACKLOG_README.md');
const KB = resolve(root, 'TRIMR_KNOWLEDGE_BASE.md');

const checkOnly = process.argv.includes('--check');

// ---------------------------------------------------------------- parsing

/** Minimal parser for the flat ticket headers. Not a general YAML parser. */
function parseTickets(md) {
  const tickets = [];
  const re = /```yaml\n(id:[\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const t = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, raw] = kv;
      const value = raw.trim();
      if (value.startsWith('[')) {
        t[key] = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (value === 'null' || value === '') {
        t[key] = null;
      } else {
        t[key] = value.replace(/^"(.*)"$/, '$1');
      }
    }
    if (t.id) tickets.push(t);
  }
  return tickets;
}

/**
 * Stable IDs the knowledge base actually defines.
 *
 * The trailing-hyphen guard matters: prose writes `RULE-CANCEL-*` to mean the whole
 * family, and the pattern would otherwise match the truncated `RULE-CANCEL` and
 * report it as a defined-but-uncited rule. Five phantom IDs in a generated list is
 * how people learn to ignore the list.
 */
function parseKbIds(md) {
  const ids = new Set();
  for (const m of md.matchAll(/\b(ADR|RULE|CFG|ENUM|ROLE|TBC)-[A-Z0-9-]+\b/g)) {
    if (md.startsWith('-*', m.index + m[0].length)) continue;
    ids.add(m[0]);
  }
  return ids;
}

/** TBC ids still listed as unresolved in the §14 register. */
function parseOpenTbcs(md) {
  const open = new Set();
  const section = md.split('## 14. Open Decisions')[1]?.split('\n## ')[0] ?? '';
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const id = line.match(/`(TBC-[A-Z0-9-]+)`/)?.[1];
    if (id && !/RESOLVED/i.test(line)) open.add(id);
  }
  return open;
}

/** Reserved-but-undecided rule ids, mapped to the decision ticket that writes each. */
function parsePendingRules(md) {
  const pending = new Map();
  const section = md.split('### Pending rules')[1]?.split('\n## ')[0] ?? '';
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`(RULE-[A-Z0-9-]+)`\s*\|[^|]*\|\s*`(P0-D\d+)`\s*\|/);
    if (m) pending.set(m[1], m[2]);
  }
  return pending;
}

const backlogMd = readFileSync(BACKLOG, 'utf8');
const kbMd = readFileSync(KB, 'utf8');

const tickets = parseTickets(backlogMd);
const byId = new Map(tickets.map((t) => [t.id, t]));
const kbIds = parseKbIds(kbMd);
const openTbcs = parseOpenTbcs(kbMd);
const pendingRules = parsePendingRules(kbMd);

/** Every ticket this one depends on, transitively. */
function ancestors(id, seen = new Set()) {
  for (const dep of byId.get(id)?.dependsOn ?? []) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    ancestors(dep, seen);
  }
  return seen;
}

// ---------------------------------------------------------------- validation

const errors = [];
const warnings = [];

for (const t of tickets) {
  if (!['Tony', 'Andrew'].includes(t.owner)) {
    errors.push(`${t.id}: owner must be exactly Tony or Andrew (got "${t.owner}")`);
  }
  for (const dep of t.dependsOn ?? []) {
    if (!byId.has(dep)) errors.push(`${t.id}: dependsOn references unknown ticket ${dep}`);
  }
  for (const aff of t.affects ?? []) {
    if (!byId.has(aff)) errors.push(`${t.id}: affects references unknown ticket ${aff}`);
  }
  for (const kb of t.knowledgeBase ?? []) {
    if (kb.endsWith('-NONE') || kb.endsWith('-*')) continue;
    if (!kbIds.has(kb)) errors.push(`${t.id}: knowledgeBase references unknown ${kb}`);
  }
  for (const tbc of t.blockedByTbc ?? []) {
    if (!kbIds.has(tbc)) errors.push(`${t.id}: blockedByTbc references unknown ${tbc}`);
  }
  // A ticket citing an unresolved TBC in knowledgeBase, without declaring it as
  // a blocker, will start against a rule that does not exist yet.
  for (const kb of t.knowledgeBase ?? []) {
    if (openTbcs.has(kb) && !(t.blockedByTbc ?? []).includes(kb)) {
      warnings.push(`${t.id}: cites unresolved ${kb} but does not list it in blockedByTbc`);
    }
  }
  // A ticket citing a reserved-but-undecided rule must depend on the decision that
  // writes it, or it starts against a rule nobody has made (KB §9 pending rules).
  for (const kb of t.knowledgeBase ?? []) {
    const decision = pendingRules.get(kb);
    if (!decision || t.id === decision) continue;
    if (!ancestors(t.id).has(decision)) {
      errors.push(`${t.id}: cites pending ${kb} but does not depend on ${decision} that writes it`);
    }
  }
}

// Dependency cycles — a cycle means neither ticket can ever be Ready (KB §6.4).
const state = new Map();
const cycles = [];
function walk(id, path) {
  if (state.get(id) === 'done') return;
  if (state.get(id) === 'open') {
    cycles.push([...path.slice(path.indexOf(id)), id].join(' -> '));
    return;
  }
  state.set(id, 'open');
  for (const dep of byId.get(id)?.dependsOn ?? []) {
    if (byId.has(dep)) walk(dep, [...path, id]);
  }
  state.set(id, 'done');
}
for (const t of tickets) walk(t.id, []);
for (const c of cycles) errors.push(`dependency cycle: ${c}`);

// Phase ordering — a dependency on a later phase makes the phase gates a fiction,
// which is exactly the defect the old backlog had (P2 depending on P3).
for (const t of tickets) {
  for (const dep of t.dependsOn ?? []) {
    const d = byId.get(dep);
    if (d && Number(d.phase) > Number(t.phase)) {
      errors.push(`${t.id} (phase ${t.phase}) depends on ${dep} (phase ${d.phase}) — later phase`);
    }
  }
}

// ---------------------------------------------------------------- generation

function traceability() {
  const map = new Map();
  for (const t of tickets) {
    for (const kb of t.knowledgeBase ?? []) {
      if (kb.endsWith('-NONE') || kb.endsWith('-*')) continue;
      if (!map.has(kb)) map.set(kb, []);
      map.get(kb).push(t.id);
    }
  }
  const order = { ADR: 0, RULE: 1, CFG: 2, ENUM: 3, ROLE: 4, TBC: 5 };
  const rows = [...map.entries()].sort(([a], [b]) => {
    const pa = order[a.split('-')[0]] ?? 9;
    const pb = order[b.split('-')[0]] ?? 9;
    return pa - pb || a.localeCompare(b);
  });

  let out = `## 8. Traceability: Knowledge Base → Tickets

**Generated by \`scripts/jira/generate-indexes.mjs\`. Do not hand-maintain.**

Use it when you change a rule in the knowledge base: look up the ID you changed, and every
ticket listed is either still correct or needs a follow-up. Record which, in the PR (\`KB §1.3\`).

| Knowledge base ID | Implemented by |
|---|---|
`;
  for (const [kb, ids] of rows) {
    out += `| \`${kb}\` | ${ids.map((i) => `\`${i}\``).join(', ')} |\n`;
  }

  const unreferenced = [...kbIds]
    .filter((id) => !map.has(id) && !id.startsWith('TBC'))
    .sort();
  if (unreferenced.length) {
    out += `
**Defined in the knowledge base but not cited by any ticket** — either the rule is not
implemented, or a ticket is missing its citation. Both are worth knowing:

${unreferenced.map((i) => `\`${i}\``).join(', ')}
`;
  }
  return out;
}

function reverseIndex() {
  const dependedOnBy = new Map();
  const affectedBy = new Map();
  for (const t of tickets) {
    for (const d of t.dependsOn ?? []) {
      if (!dependedOnBy.has(d)) dependedOnBy.set(d, []);
      dependedOnBy.get(d).push(t.id);
    }
    for (const a of t.affects ?? []) {
      if (!affectedBy.has(a)) affectedBy.set(a, []);
      affectedBy.get(a).push(t.id);
    }
  }

  let out = `## 9. Reverse Dependency Index

**Generated by \`scripts/jira/generate-indexes.mjs\`. Do not hand-maintain.**

The inverse of every \`dependsOn\` and \`affects\` edge. Nobody writes reverse edges by hand —
that is what rotted \`canRunInParallelWith\` in the previous backlog (§3.1).

- **Blocks** — tickets that cannot start until this one closes.
- **Changed by** — tickets that declared this one in their \`affects\`: if they change, check this.

| Ticket | Blocks | Changed by |
|---|---|---|
`;
  for (const t of tickets) {
    const blocks = dependedOnBy.get(t.id) ?? [];
    const changed = affectedBy.get(t.id) ?? [];
    if (!blocks.length && !changed.length) continue;
    out += `| \`${t.id}\` | ${blocks.map((i) => `\`${i}\``).join(', ') || '—'} | ${
      changed.map((i) => `\`${i}\``).join(', ') || '—'
    } |\n`;
  }

  const leaves = tickets.filter((t) => !dependedOnBy.has(t.id) && !affectedBy.has(t.id));
  out += `
**Blocks nothing and is changed by nothing** (${leaves.length}): ${
    leaves.map((t) => `\`${t.id}\``).join(', ') || '—'
  }. These are safe to defer.
`;
  return out;
}

// ---------------------------------------------------------------- report

const owners = tickets.reduce((a, t) => ((a[t.owner] = (a[t.owner] ?? 0) + 1), a), {});
const phases = tickets.reduce((a, t) => ((a[t.phase] = (a[t.phase] ?? 0) + 1), a), {});
const unlinked = tickets.filter((t) => !t.jiraKey).length;

console.log(`tickets:   ${tickets.length}`);
console.log(`owners:    ${Object.entries(owners).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`phases:    ${Object.entries(phases).sort().map(([k, v]) => `P${k}:${v}`).join(' ')}`);
console.log(`kb ids:    ${kbIds.size} defined, ${openTbcs.size} TBC open`);
console.log(`jira:      ${unlinked}/${tickets.length} not yet created`);

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}

if (checkOnly) {
  console.log('\nOK');
  process.exit(0);
}

const head = backlogMd.split('## 8. Traceability')[0];
writeFileSync(BACKLOG, `${head}${traceability()}\n---\n\n${reverseIndex()}`);
console.log('\nWrote sections 8 and 9.');
