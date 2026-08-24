# Team Approval Flow

## How to use this template

Use one approval record for every material decision. A decision is material when it changes the deliverable, deadline, budget, payment milestone, risk level, or person responsible. Store the record with the project files and link it from the project control board.

## Approval Record

| Field | Entry |
|---|---|
| Project ID |  |
| Client |  |
| Decision ID |  |
| Decision title |  |
| Requested by |  |
| Date requested |  |
| Decision deadline |  |
| Affected deliverable |  |
| Current baseline |  |
| Proposed change |  |
| Budget impact |  |
| Schedule impact |  |
| Risk impact |  |
| Options considered |  |
| Recommended option |  |
| Final decision |  |
| Decision status | Draft / Awaiting internal approval / Awaiting client approval / Approved / Rejected / Superseded |
| Client approver |  |
| Internal approver |  |
| Approval date |  |
| Evidence link |  |
| Follow-up owner |  |
| Follow-up due date |  |

## Responsibility Matrix

| Activity | Account owner | Project lead | Delivery specialist | QA reviewer | Client |
|---|---|---|---|---|---|
| Confirm commercial terms | A | C | I | I | A |
| Lock scope and acceptance criteria | C | A | C | C | A |
| Estimate delivery effort | C | A | R | C | I |
| Approve internal production start | A | R | C | I | I |
| Review quality before client delivery | I | A | R | R | I |
| Approve client-facing delivery | A | R | C | C | A |
| Approve change request | R | C | I | I | A |
| Close project and record acceptance | A | R | C | C | A |

**R** means responsible for doing the work. **A** means accountable for the outcome or approval. **C** means consulted before the decision. **I** means informed after the decision. One person may hold several roles on a small project, but every material decision must still have a named accountable owner.

## Approval Rules

### Rule 1: No silent scope changes

A request that adds a page, feature, revision round, channel, meeting, or deliverable must be recorded before production work begins. If it is included in the existing scope, point to the exact scope line. If it is not included, open a Change Request and confirm the price or schedule impact.

### Rule 2: No approval by ambiguity

“Sounds good” is not sufficient when the decision affects money, dates, or acceptance. Ask the approver to confirm the exact option, deliverable, or milestone in writing.

### Rule 3: No client approval without an evidence link

Record the document version, review link, or message URL that contains the approved item. If the approval is verbal, send a written recap and ask the client to confirm it.

### Rule 4: Escalate before the deadline

If an approval is not received by the decision deadline, mark the project Amber, pause dependent work, and send a dated reminder. Do not silently consume the contingency or promise the original date without a written decision.

## Decision Log

| Decision ID | Date | Decision | Status | Approver | Evidence | Consequence | Next action |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |

## Client Approval Message

**Subject:** Approval required — [Project] / [Decision]

Hi [Client name],

To keep [project or milestone] on track, please confirm one of the following options by [date and time]:

**Option A — [name]:** [short description, price impact, and schedule impact].

**Option B — [name]:** [short description, price impact, and schedule impact].

Our recommendation is **[option]** because [reason]. Work depending on this decision will remain paused until we receive written approval.

Please reply: “I approve [option] for [project].”

Best,
[Name]
