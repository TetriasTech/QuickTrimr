---
name: audit-trimr-code
description: Audit TRIMR code, architecture, and technical decisions to the standard of the brightest software engineer — and to the repository's non-negotiables. Checks RLS, client-trusted identity, address and location exposure, integer-cent money with per-booking snapshots, capture and payout idempotency, no-client-side-timers, config-not-literals, PostGIS server-side filtering, Google server keys out of the mobile bundle, domain purity, and truthful copy, plus wasted API/DB calls (N+1s, over-fetching, unthrottled Routes and Places calls), dead code, and missed reuse of shared components, schemas, and templates. Use whenever the user asks Codex to audit, review the quality of, or check the standard of written code — manually, or automatically after pick-up-trimr-ticket delivers a slice and after any code change. Produces ranked, evidence-backed findings; it is advisory and never edits code.
---

# Audit TRIMR Code

Hold the code, architecture, and technical decisions to the standard of the brightest engineer you
have ever worked with — and to TRIMR's non-negotiables, which are stricter because this repo moves
real money and sends a named stranger to a client's home address at a stated time.

## Load and follow the authoritative spec

Read `TRIMR_AUDIT_PROMPT.md` completely before taking any other action. It is the single source of
truth for this audit; `/audit` (Claude) and this skill both defer to it so there is one copy that
cannot drift. Follow it exactly, including its:

- Scope resolution (change / path / ticket id / full repo).
- Checklist: §3.A non-negotiables, B cost (wasted API and DB work), C dead code, D reuse of shared
  components/schemas/templates, E architecture and technical decisions, F general engineering bar.
- Severity levels (Critical / Major / Minor) and ranking rules.
- Report format and the closing verdict.

## Resolve the scope

1. No argument — audit the current change: `git diff HEAD` plus `git status`; if the tree is clean,
   the current branch against `main`.
2. A path — audit that file or directory.
3. A ticket id (`P2-T12`, or a Jira key matched against `TRIMR_BACKLOG_README.md`'s `jiraKey:`) —
   audit the vertical slice delivered for that ticket.
4. `all` — full-repository sweep; confirm before a long run.

State the scope you audited at the top of the report.

## Stay in bounds

This audit is **advisory**. Report ranked, evidence-backed findings — do not edit code. Do not
resolve a `TBC-*`, pick a config value, or make a Decision ticket's call; those are Tony's or
Andrew's, and an undecided value is itself a finding. Do not touch the generated backlog sections
(`§8`, `§9`). Do not invent findings to look thorough — if the slice is clean, say so and name what
you checked.
