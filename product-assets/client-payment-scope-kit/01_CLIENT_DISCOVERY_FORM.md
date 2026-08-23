# Client Intake Form
## Online Form Blueprint for Freelancers and Small Agencies

**Purpose:** Qualify a potential client, understand the project at a useful level, and collect enough information to prepare a proposal without forcing the prospect to complete a long contract form.

> This is an intake form, not a contract. It should be completed before a proposal and Scope of Work. Do not request passwords, private keys, payment-card details, or sensitive personal data.

## Recommended Form Settings

| Setting | Recommended value |
|---|---|
| Form title | Client Project Intake |
| Intro message | “Tell us what you need, and we will confirm whether we are a good fit.” |
| Estimated completion time | 5–8 minutes |
| Collect email address | Yes |
| Allow save and resume | Yes, if the form platform supports it |
| File upload | Optional; accept links instead when possible |
| Confirmation message | “Thank you. We will review your brief and reply with the next step.” |
| Spam protection | Enable CAPTCHA or the platform’s equivalent |
| Response destination | Private spreadsheet or CRM, not a public sheet |

## Form Logic

- If **Project stage = Just exploring**, show the confirmation page and do not promise a proposal.
- If **Budget = Not sure**, ask for the expected investment range and decision timeline before accepting the lead.
- If **Deadline = Within 7 days**, show a note that rush work is subject to availability and may have a separate fee.
- If **Client needs legal, tax, medical, financial, or regulated advice**, route the response to manual review and do not promise that the kit or service is suitable.
- If **No decision-maker identified**, route the response to clarification before preparing a proposal.

---

# Page 1 — About You

### 1. Full name

**Field type:** Short answer  
**Required:** Yes

`{{FULL_NAME}}`

### 2. Work email

**Field type:** Email  
**Required:** Yes

`{{EMAIL}}`

### 3. Company or business name

**Field type:** Short answer  
**Required:** Yes

`{{COMPANY_NAME}}`

### 4. Your role

**Field type:** Multiple choice  
**Required:** Yes

- Founder / owner
- Freelancer / independent professional
- Agency owner
- Marketing or operations manager
- Procurement / finance
- Other: `{{OTHER}}`

### 5. Website, portfolio, or business profile

**Field type:** URL  
**Required:** No

`{{URL}}`

### 6. What best describes your business?

**Field type:** Dropdown  
**Required:** Yes

- Design or creative services
- Software or web development
- Marketing or advertising
- Consulting or coaching
- Writing, translation, or content
- Photography, video, or production
- Home or local services
- Other: `{{OTHER}}`

### 7. Preferred contact method

**Field type:** Multiple choice  
**Required:** Yes

- Email
- Telegram
- Video call
- Other: `{{OTHER}}`

---

# Page 2 — Project Fit

### 8. What do you need help with?

**Field type:** Checkboxes; select up to three  
**Required:** Yes

- Getting a deposit before work starts
- Defining a clear project scope
- Preventing unpaid extra revisions or requests
- Creating a professional proposal
- Creating invoices and payment terms
- Following up on late payments
- Organizing project and payment records
- Preparing a professional handover
- Other: `{{OTHER}}`

### 9. What is happening today?

**Field type:** Paragraph  
**Required:** Yes

Please describe the situation in your own words. Include what has already happened and what is not working.

`{{CURRENT_SITUATION}}`

### 10. What outcome would make this useful?

**Field type:** Paragraph  
**Required:** Yes

Complete this sentence: “After using this solution, I want to be able to…”

`{{DESIRED_OUTCOME}}`

### 11. What have you tried already?

**Field type:** Checkboxes  
**Required:** No

- Nothing yet
- Email reminders
- A proposal or contract
- An invoice tool
- A spreadsheet
- Project management software
- A lawyer or accountant
- Other: `{{OTHER}}`

### 12. How urgent is this?

**Field type:** Multiple choice  
**Required:** Yes

- I am gathering information
- I want to start within 30 days
- I need a solution within 14 days
- I need help within 7 days
- The situation is currently blocking work or payment

### 13. Which project stage are you in?

**Field type:** Multiple choice  
**Required:** Yes

- Planning a new project
- Preparing a proposal
- Negotiating with a client
- Already working on the project
- Waiting for payment
- Closing or handing over a project
- Just exploring

### 14. What materials or information are available?

**Field type:** Checkboxes  
**Required:** No

- Existing proposal
- Scope of Work
- Invoice or payment record
- Client messages
- Project files
- Current workflow or spreadsheet
- None yet

### 15. Add a link or upload a non-sensitive example

**Field type:** URL or optional file upload  
**Required:** No

Do not upload passwords, private keys, payment-card data, confidential personal information, or documents you do not have permission to share.

`{{LINK_OR_FILE}}`

---

# Page 3 — Commercial Fit

### 16. What investment range are you considering?

**Field type:** Multiple choice  
**Required:** Yes

- Under 50 USD
- 50–150 USD
- 150–500 USD
- More than 500 USD
- Not sure yet

> These ranges are for qualification only. The final price depends on the confirmed scope and deliverables.

### 17. How would you prefer to pay?

**Field type:** Multiple choice  
**Required:** Yes

- USDT
- Bank transfer
- Card or payment platform
- I need to discuss payment options

### 18. Who will approve the purchase and final deliverables?

**Field type:** Short answer  
**Required:** Yes

`{{DECISION_MAKER_NAME_AND_ROLE}}`

### 19. When do you expect to make a decision?

**Field type:** Multiple choice  
**Required:** Yes

- Today or tomorrow
- Within one week
- Within one month
- No decision date yet

### 20. Anything else we should know?

**Field type:** Paragraph  
**Required:** No

`{{ADDITIONAL_CONTEXT}}`

### 21. Communication permission

**Field type:** Checkbox  
**Required:** Yes

- I confirm that the information above is accurate enough for an initial project review, and I agree to receive a reply about this request. I understand that submitting this form does not create a contract or guarantee acceptance.

---

# Internal Review Fields

These fields are not shown to the client. They help decide whether to prepare a proposal.

| Field | Type | Internal rule |
|---|---|---|
| Lead ID | Auto-generated text | Use one unique ID per response |
| Fit score | Number 0–100 | Score problem clarity, urgency, budget fit, and decision access |
| Recommended product | Dropdown | Starter / Complete / Agency / Custom review |
| Missing information | Paragraph | List only what must be clarified |
| Risk flag | Dropdown | None / Payment / Scope / Legal / Data / Timeline |
| Next action | Dropdown | Send sample / Ask clarification / Prepare proposal / Decline |
| Owner | Dropdown | Assign one person |
| Follow-up date | Date | Never create unlimited follow-ups |

## Internal Decision Rule

Prepare a proposal only when the problem is specific, a decision-maker is identified, the requested work is within capability, and the budget and timeline are not obviously incompatible. If one of these is missing, ask one focused clarification question instead of sending a generic sales message.

## Confirmation Page Copy

**Thank you — your project brief has been received.**

We will review the information and reply with one of three next steps: a short clarification question, a recommended package, or a proposal outline. Submitting this form does not create a contract, reserve a project slot, or guarantee a result.

## Why This Form Is Structured This Way

The form starts with contact and business context, then asks for the problem, desired outcome, urgency, stage, budget, decision-maker, and preferred contact method. It uses short answers, multiple choice, checkboxes, paragraph fields, URL/file fields, and conditional logic instead of asking for contract-level detail at the first contact. This follows common intake-form guidance: keep the first form easy to complete, organize it into sections, collect information that helps assess fit and prepare a proposal, and customize questions by client type. [1] [2]

### References

[1]: https://www.formstack.com/templates/client-intake-form-template "Client Intake Form Template — Formstack"

[2]: https://www.squarespace.com/blog/client-intake-form-examples "Client Intake Forms: Examples and Best Practices — Squarespace"
