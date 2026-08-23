# Change Request Form
## Online Form Blueprint for Scope, Budget, and Timeline Changes

**Purpose:** Capture a proposed change before additional work begins. The form creates a decision record; it does not approve the change automatically.

> A change request should be brief enough to complete quickly, but detailed enough for the provider and decision-maker to evaluate scope, cost, timeline, resources, quality, and risk. This structure follows common project-management change-request fields used in published templates. [1] [2]

## Recommended Form Settings

| Setting | Recommended value |
|---|---|
| Form title | Project Change Request |
| Response time | 3–5 minutes |
| Collect email address | Yes |
| Require project ID | Yes |
| Allow file or link attachments | Optional |
| Confirmation message | “Your request has been recorded. Additional work begins only after written approval.” |
| Approval method | Written approval from the named decision-maker |
| Response destination | Private project tracker |

---

# Page 1 — Request Details

### 1. Project name

**Field type:** Short answer  
**Required:** Yes

`{{PROJECT_NAME}}`

### 2. Project ID

**Field type:** Short answer  
**Required:** Yes

`{{PROJECT_ID}}`

### 3. Change request number

**Field type:** Short answer  
**Required:** Yes

`{{CR-001}}`

### 4. Requested by

**Field type:** Short answer  
**Required:** Yes

`{{REQUESTER_NAME}}`

### 5. Requester email

**Field type:** Email  
**Required:** Yes

`{{REQUESTER_EMAIL}}`

### 6. Date requested

**Field type:** Date  
**Required:** Yes

`{{REQUEST_DATE}}`

### 7. Change name

**Field type:** Short answer  
**Required:** Yes

Use a short label, such as “Add mobile checkout page.”

`{{CHANGE_NAME}}`

### 8. Priority

**Field type:** Multiple choice  
**Required:** Yes

- Low — can be handled in normal planning
- Medium — useful for the current milestone
- High — affects an important deadline or dependency
- Emergency — work is blocked or a critical failure requires immediate attention

### 9. Date needed

**Field type:** Date  
**Required:** No

`{{DATE_NEEDED}}`

---

# Page 2 — Change Description and Reason

### 10. What needs to change?

**Field type:** Paragraph  
**Required:** Yes

Describe the requested change, the affected item, and the expected result. Avoid “make it better” or other vague wording.

`{{CHANGE_DESCRIPTION}}`

### 11. Why is this change needed?

**Field type:** Paragraph  
**Required:** Yes

Explain the business reason, user need, defect, new requirement, or dependency that caused the request.

`{{CHANGE_REASON}}`

### 12. What happens if the change is not made?

**Field type:** Paragraph  
**Required:** Yes

`{{IMPACT_OF_NOT_MAKING_CHANGE}}`

### 13. Supporting link or file

**Field type:** URL or optional file upload  
**Required:** No

Do not upload passwords, private keys, payment-card data, or confidential information without authorization.

`{{LINK_OR_FILE}}`

---

# Page 3 — Impact Assessment

### 14. Does the change affect any of the following?

**Field type:** Checkboxes  
**Required:** Yes

- Scope or deliverables
- Quantity of work
- Budget or fee
- Timeline or deadline
- Resources or people
- Platform, integration, or language
- Quality or acceptance criteria
- Client materials or access
- No known impact yet

### 15. Impact on scope and deliverables

**Field type:** Paragraph  
**Required:** Yes

`{{SCOPE_IMPACT}}`

### 16. Impact on budget

**Field type:** Paragraph  
**Required:** Yes

Include an estimated additional fee or state “No additional fee proposed.”

`{{BUDGET_IMPACT}}`

### 17. Impact on timeline

**Field type:** Paragraph  
**Required:** Yes

Include additional business days or state “No schedule impact proposed.”

`{{TIMELINE_IMPACT}}`

### 18. Impact on quality or risk

**Field type:** Paragraph  
**Required:** Yes

`{{QUALITY_AND_RISK_IMPACT}}`

### 19. Additional resources or dependencies

**Field type:** Paragraph  
**Required:** No

`{{RESOURCES_AND_DEPENDENCIES}}`

---

# Page 4 — Recommendation and Decision

### 20. Recommended action

**Field type:** Multiple choice  
**Required:** Yes

- Approve the change as proposed
- Approve the change with a revised scope
- Reject the change
- Defer the change to a later phase
- Request more information
- Keep the original scope

### 21. Alternative option

**Field type:** Paragraph  
**Required:** No

Describe a lower-cost, lower-risk, or later-phase alternative if one exists.

`{{ALTERNATIVE}}`

### 22. Proposed additional fee

**Field type:** Currency / short answer  
**Required:** Yes

`{{ADDITIONAL_FEE}}`

### 23. Proposed revised delivery date

**Field type:** Date  
**Required:** Yes

`{{REVISED_DELIVERY_DATE}}`

### 24. Approval status

**Field type:** Multiple choice  
**Required:** Yes

- Draft
- Submitted for review
- Approved
- Rejected
- Deferred
- More information required

### 25. Approved or rejected by

**Field type:** Short answer  
**Required:** No until a decision is made

`{{REVIEWER_NAME_AND_ROLE}}`

### 26. Decision date

**Field type:** Date  
**Required:** No until a decision is made

`{{DECISION_DATE}}`

### 27. Decision comments

**Field type:** Paragraph  
**Required:** No

`{{DECISION_COMMENTS}}`

### 28. Written approval

**Field type:** Checkbox or signature field  
**Required:** Yes before work begins

- I approve the change described above, including the additional fee of `{{ADDITIONAL_FEE}}` and the revised delivery date of `{{REVISED_DELIVERY_DATE}}`.

**Approver name:** `{{APPROVER_NAME}}`  
**Approver role:** `{{APPROVER_ROLE}}`  
**Approval date:** `{{DATE}}`

---

# Internal Completion Record

These fields are completed after the change is delivered.

| Field | Type | Value |
|---|---|---|
| Completion date | Date | `{{DATE}}` |
| Related invoice | Short answer | `{{INVOICE_ID}}` |
| Delivery link | URL | `{{LINK}}` |
| Client acceptance | Multiple choice | Pending / Accepted / Correction required |
| Notes | Paragraph | `{{NOTES}}` |

## Rules for Using This Form

A new request is not automatically approved because it appears in a chat, call, or email. The provider must assess its impact, state the fee and schedule, and receive written approval before beginning the additional work. A small correction that stays within the approved deliverable may be recorded as an internal correction rather than a paid Change Request.

### References

[1]: https://www.projectmanager.com/templates/change-request-form "Change Request Form — ProjectManager"

[2]: https://www.smartsheet.com/content/change-request-form-templates "Free Change Request Forms and Templates — Smartsheet"
