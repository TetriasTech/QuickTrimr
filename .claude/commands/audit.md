---
description: Audit code, architecture and technical decisions to the highest engineering bar
argument-hint: "[nothing | <path> | <ticket-id> | all]  e.g. /audit, /audit supabase/functions, /audit P2-T12"
---

Run the QuickTrimr code audit over **$ARGUMENTS**.

Read `QUICKTRIMR_AUDIT_PROMPT.md` in full, now, before doing anything else. It is the single source of
truth for this audit — its scope rules, its checklist (§3.A non-negotiables, B cost, C dead code,
D reuse, E architecture, F engineering bar), its severity levels, and its report format all apply.

Resolve the scope from `$ARGUMENTS`:

- **empty** — audit the current change: `git diff HEAD` plus `git status`; if the tree is clean,
  the current branch's diff against `main`.
- **a path** — audit that file or directory.
- **a ticket id** (`P2-T12`, or a Jira key resolved via `QUICKTRIMR_BACKLOG_README.md`) — audit the
  vertical slice delivered for that ticket.
- **`all`** — full-repo sweep. Confirm first; it is expensive.

The audit is advisory: **report ranked findings with evidence, do not edit code.** Do not resolve a
`TBC-*`, pick a config value, or make a Decision ticket's call — surface it as a finding. Do not
invent findings to look thorough; if the slice is clean, say so and name what you checked.
