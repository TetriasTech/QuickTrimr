#!/usr/bin/env node
/**
 * Creates Jira issues from QUICKTRIMR_BACKLOG_README.md, one phase at a time.
 *
 * The backlog file is the source of truth. Jira is a projection of it (backlog §4).
 * If they disagree, the backlog wins and Jira is corrected — never the reverse.
 *
 *   node scripts/jira/create-tickets.mjs --phase 0 --dry-run   # render, no API calls
 *   node scripts/jira/create-tickets.mjs --phase 0             # create for real
 *
 * Idempotency: a ticket with a non-null `jiraKey` is SKIPPED. The key is written back
 * into the backlog immediately after each create. This is what stops Phase 0 being
 * duplicated when you come back for Phase 1 — and what makes a crashed half-run safe
 * to re-run.
 *
 * Config: see scripts/jira/.env.example.
 *
 * Runs as the shared Tetrias service account (info@tetriastech.com.au), which
 * both engineers use. That is deliberate: Jira is a projection of the backlog
 * (backlog §4), so the bot authoring the projection is more honest than either
 * engineer appearing to have written 83 issues. They still log into Jira as
 * themselves; this token is for the script only.
 *
 * The service account CREATES the issues. Assignment is separate and follows
 * each ticket's `owner` field in the backlog — so both JIRA_ACCOUNT_TONY and
 * JIRA_ACCOUNT_ANDREW are needed regardless of who runs it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BACKLOG = resolve(root, 'QUICKTRIMR_BACKLOG_README.md');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const whoami = args.includes('--whoami');
const update = args.includes('--update');
const phase = args[args.indexOf('--phase') + 1];

if (!whoami && (!args.includes('--phase') || phase === undefined)) {
  console.error('Usage: create-tickets.mjs --phase <0-7> [--dry-run]   # create missing issues');
  console.error('       create-tickets.mjs --update --phase <0-7> [--dry-run]');
  console.error('                                          # re-push changed issues, backfill links');
  console.error('       create-tickets.mjs --whoami        # find accountIds and AC field id');
  process.exit(1);
}

/**
 * Cross-project guard.
 *
 * Tony and Andrew run this same script shape in two repos against one Atlassian
 * site: QuickTrimr here, myClean (key MC) next door. Both .env files export the same
 * variable names, so a stale `set -a && source ../MyClean/scripts/jira/.env` in a
 * shell leaves JIRA_PROJECT_KEY=MC — and this script would then happily file 107
 * QuickTrimr tickets into the myClean board.
 *
 * That is not a recoverable mistake at this size. Deleting 107 issues is manual,
 * one at a time, and the myClean backlog's own jiraKey write-back would be
 * untouched, so nothing would even record what happened.
 *
 * So the expected key is pinned in code, next to the backlog it belongs to,
 * rather than trusted from the environment.
 */
const EXPECTED_PROJECT_KEY = 'TRIMR';
const EXPECTED_PROJECT_NAME = 'QuickTrimr';
const LEGACY_PRODUCT_NAME = 'TRIMR';

const cfg = {
  baseUrl: process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL,
  token: process.env.JIRA_API_TOKEN,
  projectKey: process.env.JIRA_PROJECT_KEY,
  acField: process.env.JIRA_AC_FIELD || null,
  accounts: {
    Tony: process.env.JIRA_ACCOUNT_TONY || null,
    Andrew: process.env.JIRA_ACCOUNT_ANDREW || null,
  },
};

if (cfg.projectKey && cfg.projectKey !== EXPECTED_PROJECT_KEY) {
  console.error(
    `\nREFUSING TO RUN — wrong Jira project.\n\n` +
    `  JIRA_PROJECT_KEY is "${cfg.projectKey}", expected "${EXPECTED_PROJECT_KEY}".\n\n` +
    `This repo files tickets into ${EXPECTED_PROJECT_KEY} only. "${cfg.projectKey}" is a\n` +
    `different project — most likely myClean (MC) from a .env sourced in this shell.\n\n` +
    `Fix it with:\n` +
    `  set -a && source scripts/jira/.env && set +a\n\n` +
    `Nothing was sent.`
  );
  process.exit(1);
}

// Update dry runs inspect live issue fields and properties, so they still need Jira.
if (!dryRun || update) {
  const missing = ['baseUrl', 'email', 'token', 'projectKey'].filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}. Use --dry-run to render without them.`);
    process.exit(1);
  }
}

/**
 * The backlog's issueType vocabulary is richer than Jira's. `Decision` and `Spike`
 * are meaningful distinctions in the backlog — a decision produces a knowledge base
 * edit, a spike produces an evaluation — but the QuickTrimr Jira project only has
 * Epic/Task/Story/Bug/Subtask, so both land as Task.
 *
 * The distinction is not lost: it survives in the backlog (which is the source of
 * truth) and in the `decision` label. Do not "fix" this by adding issue types to
 * Jira — the backlog is authoritative and Jira is a projection of it.
 */
const ISSUE_TYPE_MAP = {
  Decision: 'Task',
  Spike: 'Task',
};

const PHASE_TITLES = {
  0: 'Foundations & Decisions',
  1: 'Auth, Profiles, Onboarding & Services',
  2: 'Available Now, Discovery & Booking Requests',
  3: 'Payments, Earnings, Cancellations & Payouts',
  4: 'Booking Lifecycle, ETA, Completion, Disputes & Reviews',
  5: 'Admin Dashboard',
  6: 'Notifications, Analytics, QA & Release',
  7: 'Wix Marketing Website',
};

// ---------------------------------------------------------------- parsing

/**
 * Splits the backlog into tickets: the YAML header plus the markdown body that
 * follows it, up to the next ticket heading.
 */
function parseTickets(md) {
  const out = [];
  const re = /^#### (P[\dA-Z-]+) — (.+?)\n\n```yaml\n([\s\S]*?)```\n([\s\S]*?)(?=\n^#### P|\n^## |\n^<!-- TICKETS-END)/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const [, id, heading, yaml, body] = m;
    const t = { id, heading, body: body.trim(), _yamlRaw: yaml };
    for (const line of yaml.split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, raw] = kv;
      const v = raw.trim();
      if (v.startsWith('[')) {
        t[key] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      } else if (v === 'null' || v === '') {
        t[key] = null;
      } else {
        t[key] = v.replace(/^"(.*)"$/, '$1');
      }
    }
    out.push(t);
  }
  return out;
}

/** Pulls the Acceptance criteria checklist out of the body, if present. */
function extractAcceptanceCriteria(body) {
  const m = body.match(/\*\*Acceptance criteria\*\*\n\n([\s\S]*?)(?=\n\*\*|$)/);
  if (!m) return null;
  return m[1]
    .split('\n')
    .filter((l) => l.trim().startsWith('- [ ]'))
    .map((l) => l.replace(/^\s*- \[ \]\s*/, ''))
    .join('\n');
}

/** The References block appended to every description — the KB links (backlog §4.1). */
function referencesBlock(t) {
  const lines = ['', '---', '', '**References**', ''];
  lines.push(`- Backlog ticket: \`${t.id}\` in \`QUICKTRIMR_BACKLOG_README.md\` (source of truth)`);
  if (t.knowledgeBase?.length) {
    lines.push(`- Knowledge base: ${t.knowledgeBase.map((k) => `\`${k}\``).join(', ')}`);
  }
  if (t.blockedByTbc?.length) {
    lines.push(`- **Blocked by unresolved:** ${t.blockedByTbc.map((k) => `\`${k}\``).join(', ')}`);
  }
  if (t.dependsOn?.length) {
    lines.push(`- Depends on: ${t.dependsOn.map((k) => `\`${k}\``).join(', ')}`);
  }
  if (t.affects?.length) {
    lines.push(`- Affects (revisit if this ticket's contract changes): ${t.affects.map((k) => `\`${k}\``).join(', ')}`);
  }
  lines.push('');
  lines.push('To implement: paste `QUICKTRIMR_TICKET_PROMPT.md` into a fresh agent session and name this ticket id.');
  lines.push('Do not work from this Jira description alone — it is a projection. The backlog is authoritative.');
  return lines.join('\n');
}

/** Markdown → Atlassian Document Format. Minimal: paragraphs, headings, code, lists. */
function toAdf(md) {
  const content = [];
  const blocks = md.split(/\n\n+/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const code = block.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (code) {
      content.push({
        type: 'codeBlock',
        attrs: code[1] ? { language: code[1] } : {},
        content: [{ type: 'text', text: code[2].replace(/\n$/, '') }],
      });
      continue;
    }

    if (block === '---') {
      content.push({ type: 'rule' });
      continue;
    }

    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l) || /^\s*- \[[ x]\]\s+/.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: l.replace(/^\s*[-*]\s+(\[[ x]\]\s*)?/, '') }],
          }],
        })),
      });
      continue;
    }

    // Tables and anything else fall through as preformatted text rather than being
    // mangled. Better a readable code block than a broken table.
    if (block.startsWith('|')) {
      content.push({
        type: 'codeBlock',
        attrs: {},
        content: [{ type: 'text', text: block }],
      });
      continue;
    }

    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: block.replace(/\*\*/g, '') }],
    });
  }
  return { type: 'doc', version: 1, content };
}

// ---------------------------------------------------------------- jira api

const auth = () => 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');

async function jira(path, method = 'GET', body) {
  const res = await fetch(`${cfg.baseUrl}/rest/api/3${path}`, {
    method,
    headers: {
      Authorization: auth(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${method} ${path} → ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

function assertTargetProject(project) {
  if (project.key !== EXPECTED_PROJECT_KEY) {
    throw new Error(
      `Jira returned project "${project.key}" (${project.name}) for key ` +
      `"${cfg.projectKey}", expected stable key "${EXPECTED_PROJECT_KEY}".`
    );
  }
  if (project.name !== EXPECTED_PROJECT_NAME) {
    throw new Error(
      `Jira project ${EXPECTED_PROJECT_KEY} still has display name "${project.name}". ` +
      `Rename it to "${EXPECTED_PROJECT_NAME}" in Project settings before the live sync; ` +
      `the stable project key must remain "${EXPECTED_PROJECT_KEY}".`
    );
  }
}

async function findPhaseEpic() {
  const found = await jira(
    `/search/jql?jql=${encodeURIComponent(
      `project = ${cfg.projectKey} AND issuetype = Epic AND ` +
      `(summary ~ "${EXPECTED_PROJECT_NAME} Phase ${phase}" OR ` +
      `summary ~ "${LEGACY_PRODUCT_NAME} Phase ${phase}")`
    )}&fields=key,summary,labels`
  );
  const epics = found?.issues ?? [];
  return epics.find((e) => e.fields.summary === `${EXPECTED_PROJECT_NAME} Phase ${phase} — ${PHASE_TITLES[phase]}`)
    ?? epics.find((e) => e.fields.summary === `${LEGACY_PRODUCT_NAME} Phase ${phase} — ${PHASE_TITLES[phase]}`)
    ?? null;
}

async function reconcilePhaseEpic(epic) {
  const summary = `${EXPECTED_PROJECT_NAME} Phase ${phase} — ${PHASE_TITLES[phase]}`;
  const labels = [...new Set([
    ...(epic.fields.labels ?? []).filter((label) => label !== 'trimr'),
    'quicktrimr',
    `phase-${phase}`,
  ])];
  const changed = epic.fields.summary !== summary ||
    [...(epic.fields.labels ?? [])].sort().join(',') !== [...labels].sort().join(',');
  if (!changed) return;

  if (dryRun) {
    console.log(`  ${epic.key}  WOULD UPDATE epic identity to "${summary}" labels=[${labels.join(', ')}]`);
    return;
  }
  await jira(`/issue/${epic.key}`, 'PUT', { fields: { summary, labels } });
  console.log(`  ${epic.key}  updated epic identity to "${summary}"`);
}

function buildIssue(t, epicKey) {
  const ac = extractAcceptanceCriteria(t.body);
  let description = t.body;

  // If the project has no dedicated AC field, the criteria stay in the description
  // where they already are. Otherwise they move, so Jira renders them properly.
  if (cfg.acField && ac) {
    description = description.replace(/\*\*Acceptance criteria\*\*\n\n[\s\S]*?(?=\n\*\*|$)/, '');
  }
  description += referencesBlock(t);

  const fields = {
    project: { key: cfg.projectKey },
    summary: t.title,
    description: toAdf(description),
    issuetype: { name: ISSUE_TYPE_MAP[t.issueType] ?? t.issueType },
    // Deduped: tickets already carry phase-N in their own labels.
    labels: [...new Set([...(t.labels ?? []), `phase-${t.phase}`, `owner-${t.owner.toLowerCase()}`])],
    priority: { name: t.priority },
  };

  // Jira assigns by accountId only. If we don't have one, leave it unassigned rather
  // than guessing — the owner-* label still carries the ownership either way.
  const accountId = cfg.accounts[t.owner];
  if (accountId) fields.assignee = { id: accountId };

  if (cfg.acField && ac) fields[cfg.acField] = toAdf(ac);
  if (epicKey) fields.parent = { key: epicKey };

  return { fields };
}

/**
 * Fingerprint of everything this script projects into Jira.
 *
 * Stored as a Jira issue property after each write, so --update can tell a ticket
 * that actually changed from one that did not. Without it, every update run would
 * PUT every issue and stamp a changelog entry on each, and the Jira history would stop
 * being a useful record of what really changed.
 *
 * Comparing the rendered ADF against what Jira returns does not work — Jira
 * normalises the document, so identical input reads as a diff every time.
 */
const SYNC_PROPERTY = 'quicktrimr-backlog-sync';

function fingerprint(t) {
  const labels = [...new Set([...(t.labels ?? []), `phase-${t.phase}`, `owner-${t.owner.toLowerCase()}`])];
  return createHash('sha256')
    .update(JSON.stringify({
      title: t.title,
      body: t.body,
      issueType: ISSUE_TYPE_MAP[t.issueType] ?? t.issueType,
      priority: t.priority,
      owner: t.owner,
      labels: labels.sort(),
      dependsOn: [...(t.dependsOn ?? [])].sort(),
      affects: [...(t.affects ?? [])].sort(),
      knowledgeBase: [...(t.knowledgeBase ?? [])].sort(),
      blockedByTbc: [...(t.blockedByTbc ?? [])].sort(),
    }))
    .digest('hex');
}

async function storedFingerprint(key) {
  try {
    const r = await jira(`/issue/${key}/properties/${SYNC_PROPERTY}`);
    return r?.value?.hash ?? null;
  } catch (error) {
    // 404 on a ticket created before fingerprinting existed, which is every ticket
    // from the first create run. Treated as "unknown", so the first --update writes
    // the baseline rather than claiming a false change.
    if (error.message.includes('→ 404')) return null;
    throw error;
  }
}

/** Writes the returned key back into the backlog. This is the idempotency guard. */
function writeBackKey(id, key) {
  const md = readFileSync(BACKLOG, 'utf8');
  const re = new RegExp(`(id: ${id}\\n(?:.*\\n)*?jiraKey: )null`);
  if (!re.test(md)) throw new Error(`Could not write jiraKey back for ${id} — aborting.`);
  writeFileSync(BACKLOG, md.replace(re, `$1${key}`));
}

// ---------------------------------------------------------------- whoami

// Discovers the two things you cannot guess: assignable accountIds, and whether the
// project has a dedicated Acceptance Criteria field.
if (whoami) {
  const missing = ['baseUrl', 'email', 'token', 'projectKey'].filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const me = await jira('/myself');
  console.log(`Authenticated as ${me.displayName} <${me.emailAddress}>\n`);

  const users = await jira(
    `/user/assignable/search?project=${cfg.projectKey}&maxResults=50`
  );
  console.log('Assignable users — copy the accountId for Tony and Andrew:');
  for (const u of users) {
    console.log(`  ${u.accountId}  ${u.displayName} <${u.emailAddress ?? 'hidden'}>`);
  }

  const fields = await jira('/field');
  const candidates = fields.filter(
    (f) => f.custom && /acceptance|criteria/i.test(f.name)
  );
  console.log('\nAcceptance Criteria field candidates:');
  if (candidates.length) {
    for (const f of candidates) console.log(`  ${f.id}  "${f.name}"`);
  } else {
    console.log('  none found — leave JIRA_AC_FIELD unset and criteria stay in the description');
  }

  const types = await jira(`/issuetype/project?projectId=${
    (await jira(`/project/${cfg.projectKey}`)).id
  }`);
  console.log(`\nIssue types in ${cfg.projectKey}: ${types.map((t) => t.name).join(', ')}`);
  console.log('(The backlog uses Story, Task and Spike. Decision maps to Task.)');
  process.exit(0);
}

// ---------------------------------------------------------------- run

const tickets = parseTickets(readFileSync(BACKLOG, 'utf8'));
const inPhase = tickets.filter((t) => String(t.phase) === String(phase));

if (!inPhase.length) {
  console.error(`No tickets found for phase ${phase}.`);
  process.exit(1);
}

// ---------------------------------------------------------------- update mode

/**
 * Re-pushes tickets whose backlog entry has changed since they were created, and
 * backfills links that could not be made at creation time.
 *
 * Backlog §4 rule 5: changing a ticket after its Jira issue exists means updating
 * both, in the same change. Without this mode that second half is manual, and a
 * manual step done rarely is a step that stops being done — which is exactly how
 * Jira drifts from the backlog and stops being a projection of it.
 *
 * The link backfill exists because creation can only link to issues that already
 * have a key. When Phase 0 was created, every `affects` edge pointing into Phase 1
 * was silently skipped, and creating Phase 1 later does not go back for them. This
 * pass does.
 */
if (update) {
  const live = inPhase.filter((t) => t.jiraKey);
  const missing = inPhase.filter((t) => !t.jiraKey);

  console.log(`Phase ${phase} — ${PHASE_TITLES[phase] ?? ''}  [update]`);
  console.log(`  ${live.length} in Jira, ${missing.length} not yet created`);
  if (missing.length) {
    console.log(`  not created (run without --update first): ${missing.map((t) => t.id).join(', ')}`);
  }
  if (!live.length) process.exit(0);

  const project = await jira(`/project/${cfg.projectKey}`);
  try {
    assertTargetProject(project);
  } catch (error) {
    console.error(`\nREFUSING TO RUN — ${error.message}\nNothing was sent.`);
    process.exit(1);
  }
  console.log(`  target project: ${project.key} — ${project.name}\n`);

  const phaseEpic = await findPhaseEpic();
  if (phaseEpic) {
    await reconcilePhaseEpic(phaseEpic);
  } else {
    console.warn(`  WARNING: no Phase ${phase} epic found under the current or former product name.`);
  }

  let changed = 0;
  let unchanged = 0;
  for (const t of live) {
    const hash = fingerprint(t);
    const stored = await storedFingerprint(t.jiraKey);
    if (stored === hash) {
      unchanged++;
      continue;
    }

    // Report the fields a human can actually eyeball, by diffing against Jira's
    // current state. The description is compared by fingerprint, not by text — see
    // the note on SYNC_PROPERTY.
    const cur = await jira(`/issue/${t.jiraKey}?fields=summary,priority,labels,assignee`);
    const want = buildIssue(t).fields;
    const diffs = [];
    if (cur.fields.summary !== want.summary) {
      diffs.push(`summary: "${cur.fields.summary}" → "${want.summary}"`);
    }
    if (cur.fields.priority?.name !== want.priority.name) {
      diffs.push(`priority: ${cur.fields.priority?.name} → ${want.priority.name}`);
    }
    const curLabels = [...(cur.fields.labels ?? [])].sort().join(',');
    const wantLabels = [...want.labels].sort().join(',');
    if (curLabels !== wantLabels) diffs.push(`labels: [${curLabels}] → [${wantLabels}]`);
    if ((cur.fields.assignee?.accountId ?? null) !== (want.assignee?.id ?? null)) {
      diffs.push(`assignee: ${cur.fields.assignee?.displayName ?? 'none'} → ${t.owner}`);
    }
    if (!diffs.length) diffs.push(stored === null ? 'baseline fingerprint (first update run)' : 'description / body');

    if (dryRun) {
      console.log(`  ${t.id} → ${t.jiraKey}  WOULD UPDATE`);
      for (const d of diffs) console.log(`      ${d}`);
      changed++;
      continue;
    }

    // parent is omitted: the epic is set at creation and re-sending it on a
    // Team-managed project is rejected. Nothing here should move an issue's epic.
    const { parent, project: _p, issuetype: _i, ...mutable } = want;
    await jira(`/issue/${t.jiraKey}`, 'PUT', { fields: mutable });
    await jira(`/issue/${t.jiraKey}/properties/${SYNC_PROPERTY}`, 'PUT', { hash });
    console.log(`  ${t.id} → ${t.jiraKey}  updated`);
    for (const d of diffs) console.log(`      ${d}`);
    changed++;
  }

  // --- link backfill ---
  const keyOf = new Map(tickets.map((t) => [t.id, t.jiraKey]).filter(([, k]) => k));
  let added = 0;
  let possible = 0;
  for (const t of live) {
    const existing = await jira(`/issue/${t.jiraKey}?fields=issuelinks`);
    const have = new Set(
      (existing.fields.issuelinks ?? []).map(
        (l) => `${l.type.name}:${(l.outwardIssue ?? l.inwardIssue)?.key}`
      )
    );
    for (const [rel, ids] of [['Blocks', t.dependsOn], ['Relates', t.affects]]) {
      for (const id of ids ?? []) {
        const outward = keyOf.get(id);
        if (!outward) continue;
        possible++;
        if (have.has(`${rel}:${outward}`)) continue;
        if (dryRun) {
          console.log(`  link ${t.id} ${rel} ${id} (${t.jiraKey} → ${outward})  WOULD ADD`);
          added++;
          continue;
        }
        try {
          await jira('/issueLink', 'POST', {
            type: { name: rel },
            inwardIssue: { key: t.jiraKey },
            outwardIssue: { key: outward },
          });
          console.log(`  link ${t.id} ${rel} ${id}  added`);
          added++;
        } catch (e) {
          console.error(`  link ${t.id}→${id} failed: ${e.message.split('\n')[0]}`);
        }
      }
    }
  }

  console.log(
    `\n${dryRun ? 'Would update' : 'Updated'} ${changed} issue(s), ${unchanged} unchanged. ` +
    `${dryRun ? 'Would add' : 'Added'} ${added} link(s) of ${possible} resolvable.`
  );
  if (dryRun) console.log('Nothing was sent.');
  process.exit(0);
}

// ---------------------------------------------------------------- create mode

const todo = inPhase.filter((t) => !t.jiraKey);
const skipped = inPhase.filter((t) => t.jiraKey);

console.log(`Phase ${phase} — ${PHASE_TITLES[phase] ?? ''}`);
console.log(`  ${inPhase.length} tickets, ${todo.length} to create, ${skipped.length} already in Jira`);
if (skipped.length) {
  console.log(`  skipping: ${skipped.map((t) => `${t.id}→${t.jiraKey}`).join(', ')}`);
}

// Blocked tickets are still created — the blocker is recorded in the description and
// as a link. What must not happen is starting one, and that is the Readiness Gate's
// job (QUICKTRIMR_TICKET_PROMPT.md §3), not this script's.
const blocked = todo.filter((t) => t.blockedByTbc?.length);
if (blocked.length) {
  console.log(`  note: ${blocked.length} ticket(s) cite unresolved TBCs; created but not startable`);
}

if (dryRun) {
  console.log(`\n--- DRY RUN — no API calls ---\n`);
  console.log(`EPIC  ensure QuickTrimr Phase ${phase} — ${PHASE_TITLES[phase]}`);
  console.log(`      project=${cfg.projectKey ?? '<JIRA_PROJECT_KEY unset>'}  labels=[quicktrimr, phase-${phase}]\n`);
  for (const t of todo) {
    const issue = buildIssue(t, 'EPIC-KEY');
    const ac = extractAcceptanceCriteria(t.body);
    console.log(`ISSUE ${t.id}  ${issue.fields.summary}`);
    console.log(`      type=${issue.fields.issuetype.name}  priority=${t.priority}  assignee=${
      issue.fields.assignee ? `${t.owner} (${issue.fields.assignee.id})` : `UNASSIGNED — no JIRA_ACCOUNT_${t.owner.toUpperCase()}`
    }`);
    console.log(`      labels=[${issue.fields.labels.join(', ')}]`);
    console.log(`      description=${JSON.stringify(issue.fields.description).length} bytes ADF`);
    console.log(`      acceptance criteria=${ac ? ac.split('\n').length : 0} items → ${
      cfg.acField ? `field ${cfg.acField}` : 'description (no JIRA_AC_FIELD set)'
    }`);
    if (t.dependsOn?.length) console.log(`      link "is blocked by": ${t.dependsOn.join(', ')}`);
    if (t.affects?.length) console.log(`      link "relates to":     ${t.affects.join(', ')}`);
    console.log('');
  }
  console.log(`Would reuse or create the Phase ${phase} epic and create ${todo.length} issue(s). Nothing was sent.`);
  process.exit(0);
}

// --- live ---

// State the authoring account. Expected to be the shared service account — every
// issue below is attributed to it, and that is the intended design.
const me = await jira('/myself');
console.log(`\nAuthoring as: ${me.displayName} <${me.emailAddress ?? 'hidden'}>`);

// If someone sourced their personal token by mistake, the issues would be authored
// by them instead of the bot. Harmless but wrong, and confusing six months later.
const personal = Object.entries(cfg.accounts).find(([, id]) => id === me.accountId);
if (personal) {
  console.log(
    `              → WARNING: this is ${personal[0]}'s personal account, not the service account.\n` +
    `                Issues will be authored by ${personal[0]}. Expected info@tetriastech.com.au.\n` +
    `                Check JIRA_EMAIL / JIRA_API_TOKEN if that wasn't intended.`
  );
}

// Preflight: fail before creating anything if the project lacks an issue type we
// need. Discovering this at issue 12 of 18 leaves a half-created phase to clean up.
const project = await jira(`/project/${cfg.projectKey}`);

// Second half of the cross-project guard. The env check above catches a wrong key;
// this catches a right key pointing at a project that is not what we think it is —
// a renamed project, or a key reused after a delete. Confirm against what Jira
// actually returned before creating anything.
try {
  assertTargetProject(project);
} catch (error) {
  console.error(`\nREFUSING TO RUN — ${error.message}\nNothing was sent.`);
  process.exit(1);
}
console.log(`Target project: ${project.key} — ${project.name}`);

const available = new Set(
  (await jira(`/issuetype/project?projectId=${project.id}`)).map((t) => t.name)
);
const needed = new Set(todo.map((t) => ISSUE_TYPE_MAP[t.issueType] ?? t.issueType));
needed.add('Epic');
const absent = [...needed].filter((n) => !available.has(n));
if (absent.length) {
  console.error(
    `\nProject ${cfg.projectKey} has no issue type: ${absent.join(', ')}\n` +
    `Available: ${[...available].join(', ')}\n` +
    `Add a mapping to ISSUE_TYPE_MAP, or create the type in Jira. Nothing was created.`
  );
  process.exit(1);
}

const epicSummary = `QuickTrimr Phase ${phase} — ${PHASE_TITLES[phase]}`;
const existingEpic = await findPhaseEpic();
let epicKey = existingEpic?.key;
if (epicKey) {
  await reconcilePhaseEpic(existingEpic);
  console.log(`\nEpic exists: ${epicKey}`);
} else {
  const epic = await jira('/issue', 'POST', {
    fields: {
      project: { key: cfg.projectKey },
      summary: epicSummary,
      issuetype: { name: 'Epic' },
      labels: ['quicktrimr', `phase-${phase}`],
    },
  });
  epicKey = epic.key;
  console.log(`\nCreated epic: ${epicKey}`);
}

const created = [];
for (const t of todo) {
  try {
    const issue = await jira('/issue', 'POST', buildIssue(t, epicKey));
    // Write back immediately, per ticket. If the run dies at ticket 9 of 18, the
    // first 8 are recorded and a re-run skips them rather than duplicating.
    writeBackKey(t.id, issue.key);
    t.jiraKey = issue.key;
    created.push(t);
    console.log(`  ${t.id} → ${issue.key}  ${t.title}`);
    try {
      await jira(`/issue/${issue.key}/properties/${SYNC_PROPERTY}`, 'PUT', {
        hash: fingerprint(t),
      });
    } catch (error) {
      console.warn(`      sync fingerprint failed; run --update after creation: ${error.message.split('\n')[0]}`);
    }
  } catch (e) {
    console.error(`  ${t.id} FAILED: ${e.message}`);
    console.error(`\nStopped. ${created.length} created and written back; re-run to continue.`);
    process.exit(1);
  }
}

// Links last: every ticket needs its key before any link can resolve.
const keyOf = new Map(tickets.map((t) => [t.id, t.jiraKey]).filter(([, k]) => k));
let links = 0;
for (const t of created) {
  for (const [rel, ids] of [['Blocks', t.dependsOn], ['Relates', t.affects]]) {
    for (const id of ids ?? []) {
      const outward = keyOf.get(id);
      if (!outward) continue;
      try {
        await jira('/issueLink', 'POST', {
          type: { name: rel },
          inwardIssue: { key: t.jiraKey },
          outwardIssue: { key: outward },
        });
        links++;
      } catch (e) {
        console.error(`  link ${t.id}→${id} failed: ${e.message.split('\n')[0]}`);
      }
    }
  }
}

console.log(`\nCreated ${created.length} issues, ${links} links, under ${epicKey}.`);
console.log('jiraKey written back to QUICKTRIMR_BACKLOG_README.md — commit it, or the next run duplicates.');
