---
description: Pick up a QuickTrimr backlog ticket
argument-hint: <ticket-id or jira key>  e.g. P2-T12 or TRIMR-21
---

Pick up QuickTrimr ticket **$ARGUMENTS**.

## First, resolve the id

`$ARGUMENTS` may be either form:

- **A backlog id** — `P0-T03`, `P2-T12`, `P3-T07`, `P0-D02`. Use it directly.
- **A Jira key** — `TRIMR-21`, `TRIMR-11`. Find the ticket in `QUICKTRIMR_BACKLOG_README.md` whose
  `jiraKey:` matches, and work from that ticket's backlog id:

  ```bash
  grep -B12 "jiraKey: TRIMR-21" QUICKTRIMR_BACKLOG_README.md | grep "^id:"
  ```

If a Jira key matches no ticket, stop and say so — do not guess. Either the key is wrong, or the
issue was created outside the backlog, which means it has no spec and should not be started.

State which backlog ticket you resolved to before continuing.

## Then

Read `QUICKTRIMR_TICKET_PROMPT.md` in full, now, before doing anything else. Follow it exactly — its
load order, readiness gate, drift protocol, testing mandate and report format all apply.

Read the ticket from `QUICKTRIMR_BACKLOG_README.md`. That is the source of truth. Do not work from my
description of it, and do not work from the Jira issue — Jira is a projection and it loses
information. In particular, **classify Decision vs build from the backlog's `issueType`, not
Jira's**: Jira shows every `P0-D*` as a plain `Task`, so an agent reading Jira assumes build mode
and starts inventing business decisions — the commission percentage, the refund split, the
reliability thresholds.

If the readiness gate in §3 fails, stop and tell me which gate failed and what would fix it. Do
not start the ticket.
