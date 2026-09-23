---
name: pick-up-quicktrimr-ticket
description: Resolve and deliver a QuickTrimr backlog ticket from a backlog ID such as P2-T12 or P0-D02, or a Jira key such as TRIMR-21. Use whenever the user asks Codex to pick up, start, implement, investigate, or complete a QuickTrimr ticket. Enforces the repository ticket prompt, source-of-truth order, readiness gate, decision-ticket safeguards, testing mandate, and evidence-based completion report.
---

# Pick Up a QuickTrimr Ticket

Resolve the requested identifier, load the repository's ticket workflow, and deliver only work authorized by that ticket.

## Resolve the ticket

1. Extract one ticket identifier from the user's request.
2. Accept either:
   - A backlog ID such as `P0-T03`, `P0-D02`, `P2-T12`, or `P3-T07`.
   - A Jira key such as `TRIMR-21`.
3. For a Jira key, find the ticket block in `QUICKTRIMR_BACKLOG_README.md` whose `jiraKey:` exactly matches, then use the `id:` from that same block.
4. If the identifier is absent, ambiguous, or unmatched, stop and ask for a valid backlog ID or Jira key. Never guess.
5. State the resolved backlog ID before continuing.

Do not retrieve the Jira issue as the implementation specification. Jira is a projection of the backlog and may lose fields or map `Decision` and `Spike` tickets to `Task`.

## Load and follow the authoritative workflow

Read `QUICKTRIMR_TICKET_PROMPT.md` completely before taking any other ticket action. Follow it exactly, including its:

- Load order and source-of-truth hierarchy.
- Decision-versus-build classification.
- Readiness gate and stop conditions.
- Knowledge-base drift protocol.
- Security, privacy, financial, and architecture requirements.
- Testing mandate and evidence standard.
- Completion and reporting format.

Then locate the resolved ticket in `QUICKTRIMR_BACKLOG_README.md` and proceed according to `QUICKTRIMR_TICKET_PROMPT.md`.

Classify the ticket from the backlog's `issueType`, never from Jira. For a `Decision` ticket, research and frame the human decision, ask the user, and stop as required by the ticket prompt. Do not invent the business decision — the commission percentage, the cancellation refund split, the reliability thresholds, the payout schedule and the launch service categories are Tony's and Andrew's calls — and do not begin implementation.

If the readiness gate fails, stop and report every failed condition and the concrete action needed to make the ticket ready. Do not modify implementation files for an unready ticket.
