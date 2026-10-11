# Part 2 — Frontend Brief (for the frontend agent)

You are building the CG operator's screens for Part 2 in `frontend/`. The backend is built
separately on branch `part2/inbox-shipments`. Read these first:
- `docs/PART2_DESIGN.md`: the flow (§2, §6, §7) and the **API contract (§11)**.
- Part 2 of the assignment PDF (pages 6–9): the UI module and its evaluation.

---

## 1. Who it is for, and the bar

- The user is a **CG operator**, who is not technical. They check supplier (SU) documents
  against customer rules and reply to SU.
- The bar from the assignment: "a CG operator can look at this and understand what the agent
  found in **10 seconds**". It must be clickable, with real states, not a diagram.
- Part 2 grading: user behaviour 30 %, working pipeline 25 %, **UI quality 20 %**
  ("discrepancy detail is genuinely useful"), trust 15 %, outcome 10 %.

## 2. Non-negotiable rules

1. **Nothing is ever sent without a CG click.** Send happens only on an explicit button press
   followed by a confirm dialog. No auto-send, and no sending on Enter or on save.
2. **Show real backend state only.** No hard-coded statuses, demo data or mock payloads in
   shipped code. Mocks are allowed in tests only.
3. **Don't make decisions in the UI.** Display what the backend returns: `status`, `stage`,
   `headline`, `severity`, `state`, `allowedActions`, `canSend`. Never recompute a decision,
   colour rule or eligibility on the client.
4. **API URL only through `apiUrl()`** (`src/config.ts`, from `VITE_API_URL`). No hard-coded
   hosts.
5. **Render email bodies and document text as plain text.** Never use
   `dangerouslySetInnerHTML`; SU content is untrusted.
6. **Part 1 keeps working.** The Overview, Documents, DocumentDetail, Exceptions, Queries,
   Customers and Rules pages and the upload flow stay as they are.
7. **Types are hand-written** in `src/types/api.ts`, copied from PART2_DESIGN §11. Never
   import from `backend/`.
8. **No internal jargon on screen.** Don't show issue keys, raw codes or JSON. Use the labels
   the backend sends (`label`, `fieldLabel`, `docTypeLabel`).

## 3. Navigation

Add these to the sidebar, with **Inbox first**, since it is where the CG starts:
- **Inbox:** shipments from SU emails (Incoming state) and the "simulate email" controls.
- **Shipment detail** (`/shipments/:id`): verification, discrepancy detail, review and draft.
- **Sent emails:** simulated sent replies.

The existing pages stay. The Part 1 "Documents" page shows standalone uploads only; the
backend already filters out attachment runs.

## 4. Screens

### 4.1 Inbox (UI state 1: Incoming)

- A list of shipments (`GET /api/shipments`). Each row shows: reference (`SHP-0002`), supplier
  name, subject, received time, attachment count, status badge and `headline`.
- While a shipment is `RECEIVED` or `PROCESSING`, show visible progress ("2 of 3 attachments
  read") from `progress`.
- Filter chips: Needs review · Amendment ready · Ready to approve · Waiting for supplier ·
  Done.
- **Simulate SU email** panel:
  - The sample list (`GET /api/inbox/samples`) shows the subject, sender and attachment
    names, each with a **Deliver** button (`POST /api/inbox/samples/:name/deliver`). The new
    shipment appears within about 2 s, via polling.
  - "Upload .eml" (`POST /api/inbox/emails`, multipart `file`). If `duplicate: true`, say
    "This email was already received", and link to the shipment.
- Clicking a row opens Shipment detail.

### 4.2 Shipment detail

Top to bottom:

**a. Header (the 10-second view)**
- Reference, supplier, customer, "Cycle 2" if `cycle > 1`, status badge, and a stage chip
  (Intake / Validation).
- `headline` in large text.
- One **primary action** that matches the status:

| Status | Primary action |
|---|---|
| `NEEDS_REVIEW` | "Review N items" (scrolls to the review panel) |
| `AMENDMENT_READY` | "Send amendment" |
| `APPROVAL_READY` | "Send approval" |
| `AMENDMENT_SENT` | "Waiting for supplier" (read-only) |
| `APPROVAL_SENT` | "Done" (read-only) |

- `reasoning` in a collapsible "Why?" section.

**b. Email and attachments**
- For each cycle, show sender, received time and body (plain text).
- For each attachment:
  - filename and size;
  - document type tag, with **`OTHER` shown clearly** ("Other / unclassified") and
    `docTypeReason` on hover;
  - status (reading / read / failed with the plain error message);
  - an **"Unchanged from cycle N"** tag when set;
  - **Open original**, which reuses `useDocumentSource` / `documentUrl(runId)` from
    `components/DocumentDrawer.tsx` (`fileUrl` = `/api/runs/:runId/document`).
- Mark documents from earlier cycles that are no longer current (`current: false`) as
  "previous version".

**c. Verification result (UI state 2)**
- A grid with **rows = the 8 fields** and **columns = the current documents**, plus
  **Expected** and **Result** columns.
- Each cell shows the value and the confidence level (`high` / `medium` / `low`), with the
  exact number on hover. Show "—" when the field isn't on that document, which is normal and
  not an error.
- Mark the owner document's cell with an "owner" badge (`isOwner`).
- Colour the Result column from `field.state`: `ok` green, `amendment` red, `review` amber.
  Also colour any cell where `agrees === false` or `reliable === false`.
- Above the grid: "8 fields checked across 3 documents: 2 need correction, 1 needs your
  review".

**d. Discrepancy detail (UI state 3)**
- Clicking a flagged field (or an issue) opens a drawer showing:
  - **Expected** (from the rule or the reference document, with its source: "Bata India
    rule" or "Packing list (owner)"). Show "No expected value" when `expected` is null;
    never invent one.
  - **Every document's value:** filename, type, value, confidence level, reliability
    reasons, the **source snippet** (`evidence`) with its `evidenceStatus`, and an "Open
    original" link.
  - The plain-language `message` from the issue.

**e. Review panel (one screen per stage)**
- List the current stage's issues in two groups.
  - **Needs your decision** (`severity: review`), with buttons from `allowedActions`:
    - **Clarify:** "I checked the original and it's fine". Use `actionRules.clarify` to
      decide the inputs: a value input when `value` is `required` (pre-filled with the
      extracted value when it is `optional`), and a note input that is mandatory when `note`
      is `required`. The backend returns `VALUE_REQUIRED` / `NOTE_REQUIRED` otherwise.
    - **Amend:** "Ask the supplier to fix this". Show the `request` text that will go into
      the reply.
  - **Will be sent to supplier** (`severity: amendment`). Show each `request`, with a
    secondary **Waive** action (`clarify` with a required note).
- An issue with a `resolution` shows what CG decided (value, note, time), and can be changed:
  the latest action wins.
- Documents can be re-typed from the attachment list ("Change type": `PUT …/documents/:id/type`),
  which re-runs the checks.
- Show progress ("2 of 3 decisions made").
- Each action calls `POST /api/shipments/:id/review`. Re-render from the `ShipmentView` it
  returns, because the draft and status may change. No extra fetch is needed.
- When the last stage 1 review item is clarified, the backend runs validation immediately.
  Show that transition ("Intake complete, validation done").

**f. Draft reply (UI state 4)**
- `draft` is `null` while only review items are open. Show "Make the review decisions above
  to prepare the reply" instead of an editor.
- Editable **To**, **Subject** and **Body** (monospace textarea). Show an "Edited" badge when
  `edited`, and a "Reset to generated" button that sets body = `generatedBody`. If
  `previousVersionEdited` is true, warn: "The draft was regenerated after your last
  decision; your earlier edits are not in this version."
- Save with `PUT /api/shipments/:id/draft` and the current `version`. Saving does not change
  the version, so autosave on blur is fine.
- **Send:** a single button, disabled when `canSend` is false, with `sendBlockedReason`
  shown beside it.
  1. On click, save any unsaved edits first.
  2. Show a confirm dialog (reuse `ConfirmDialog`): "Send this amendment to
     docs@supplier.example? (Simulated: no real email is sent.)"
  3. Then call `POST /api/shipments/:id/draft/send` with `{ version }`.
- Error handling:

| Code | What to do |
|---|---|
| `DRAFT_OUTDATED` | Reload the shipment and say "The draft changed (for example, the supplier replied). Please check it again." |
| `REVIEW_INCOMPLETE` | Scroll to the review panel. |
| `ALREADY_SENT` | Reload and show the sent state. |

- After sending, the draft becomes read-only with a "Sent (simulated)" tag and the time, and
  a link to Sent emails.

**g. Timeline**
- `events`, oldest to newest, reusing `ActivityList`. This is the audit trail, so keep it
  visible on the page and don't hide it behind a toggle.

### 4.3 Sent emails

- A list from `GET /api/sent-emails`: sent time, kind badge (Approval / Amendment), recipient,
  subject, and a shipment reference link. Every row is clearly labelled **"Simulated"**.
- Clicking a row shows the full body as plain text.

### 4.4 Existing pages (small additions)

- **Queries:** add example questions for shipments: "Show me everything pending review for
  Bata India", "How many shipments are waiting for the supplier?", "Which shipments had an
  HS code problem this week?".
- **Overview (should):** a shipment KPI row from `GET /api/metrics` (median minutes from email
  to reply, shipments needing review, replies sent).

## 5. Labels and colours

| Status | Badge text | Tone |
|---|---|---|
| `RECEIVED` | Received | neutral |
| `PROCESSING` | Processing | info |
| `NEEDS_REVIEW` | Needs your review | warning |
| `AMENDMENT_READY` | Amendment ready | danger |
| `APPROVAL_READY` | Ready to approve | success |
| `AMENDMENT_SENT` | Waiting for supplier | neutral |
| `APPROVAL_SENT` | Approved and sent | success |
| `FAILED` | Failed | danger |

- Severity / state: `ok` → success, `amendment` → danger, `review` → warning.
- Confidence: show `confidenceLevel` as the word, never a bare float. The number goes in a
  tooltip.

## 6. Data and polling

- Follow the existing store pattern (`src/data.ts`) and the `request()` helper in
  `src/api.ts`. Add `api.listShipments`, `getShipment`, `review`, `saveDraft`, `sendDraft`,
  `listSentEmails`, `listSamples`, `deliverSample`, `uploadEmail` and `metrics`.
- Poll `GET /api/shipments` every 2 s while any shipment is `RECEIVED` or `PROCESSING`.
  Poll `GET /api/shipments/:id` every 2 s only while that shipment is processing. Stop
  polling otherwise.
- After any mutation, use the returned `ShipmentView` instead of refetching.
- Errors use the `{ error: { code, message } }` shape. Show the `message`, and branch on
  `code` only where §4.2f says so.

## 7. Conventions

- React 19 + Vite. Use the custom router (`src/router.tsx`) and add routes in `App.tsx`. Put
  styles in `src/styles/*.css`. Reuse `Icon`, `StatusBadge`, `EmptyState`, `PageHeader`,
  `ConfirmDialog`, `ActivityList` and `useDocumentSource`.
- No new dependencies unless clearly needed (no router or state library).
- Keep components small, with minimal comments, matching the existing style.
- Before handing back, run `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm test` and `npm run build`. Add unit tests for any pure helpers (label maps, grouping,
  status → action).
- If a backend payload differs from §11, report it to the backend owner instead of working
  around it in the UI.

## 8. Acceptance checklist (this is also the 2-minute demo)

1. **Deliver `03-validation`.** The shipment appears in Inbox as Processing and shows
   attachment progress.
2. It becomes **Amendment ready**. The grid shows the HS code (packing list) and gross weight
   (BOL) in red.
3. **Click HS code.** The drawer shows the expected 6403.99 from the Bata India rule, all 3
   document values with filenames, and the snippets.
4. The draft lists both corrections, grouped by document. **Edit one line**, then **Send**,
   confirm, and it shows Sent (simulated).
5. **Sent emails** shows it, and the shipment shows **Waiting for supplier**.
6. **Deliver `03-validation-reply`.** It becomes cycle 2 of the same shipment, reaches **Ready
   to approve**, and you send the approval.
7. **`01-clean`:** the fumigation certificate shows the `OTHER` tag, and the shipment is still
   Ready to approve.
8. **`02-intake`:** "Could not open scan_01.pdf"; the draft asks for a resend; validation
   doesn't run yet.
9. **`04-review`:** an unreadable HS code needs a decision. **Clarify** it with a value, and
   validation runs immediately.
10. On Queries, "Show me everything pending review for Bata India" returns shipment rows.
11. Every screen works with real backend data, and no Send happens without the confirm
    dialog.

## 9. Out of scope

Rule editing, login and roles, real email, forwarding to the customer, mobile-first layouts
(but don't break narrow screens), and any LLM features beyond the existing Queries page.
