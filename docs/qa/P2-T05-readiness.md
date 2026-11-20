# P2-T05 / TRIMR-48 — readiness

Owner: Andrew. Issue type: Story. Ready: yes.

Resolved against the authoritative backlog; loaded the repository ticket prompt,
KB instructions, complete ticket/cited rules, dependency contracts/sync notes,
affected consumers and Ready/Done gates before implementation.

Dependency status checked through Jira on 2026-11-21: P0-D08/TRIMR-9,
P0-T15/TRIMR-24, P1-T05/TRIMR-35 and P2-T04/TRIMR-47 are all Done. Main contains
merged PR #61. One owner, real implemented rules, no blocked TBC and nine
individually checkable acceptance criteria. Graph check: 214 IDs, 0 open TBCs, OK.

The existing rules decide all values: CFG-SCHED-MIN-LEAD-MIN=240,
CFG-SCHED-MAX-HORIZON-DAYS=30, inclusive elapsed bounds under RULE-SCHED-04;
discovery radius/page policy comes from RULE-DISCOVERY-06 and its CFG rows.
No new product decision was made. The read-only config/address projection's
contract example was added to P2-T05 before implementing that endpoint. Its name
was added to the KB inventory and shared registry/metadata/examples together.

P2-T06/P2-T07/P2-T09 consume the draft and live search contract; their scope
remains correct. P1-T05's existing saved-address list and form are reused for
selection and GPS → confirm → save. Only the selected ID goes in the draft;
config, clock, address label/point, catalogue and search results stay in query
state. No filter results cards, map or request submission is built here.

Generated backlog sections 8/9 are unchanged. Acceptance/runtime evidence is in
[P2-T05.md](P2-T05.md); readiness does not certify runtime completion.
