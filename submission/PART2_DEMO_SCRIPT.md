# Part 2 — Demo video script and submission checklist

The assignment asks for **a 2-minute video showing the trigger → verification → draft → CG-edits-and-sends loop.** This script follows exactly that loop on one shipment, `03-validation`: three documents, two problems.

## Submission checklist (from the Part 2 brief)

| Required | Where it is | Status |
|---|---|---|
| Runnable agent + UI, with a README that has setup and run instructions | `README.md` → *Install and Run*, *Part 2: supplier emails*. Backend: 270 tests, frontend: 105 tests, both build. | Done |
| PRD, PDF, **max 1 page** (2 personas, 2 JTBDs, 1 north-star, 1 failure mode) | [`submission/PART2_PRD.pdf`](PART2_PRD.pdf) (1 page) · [Markdown](PART2_PRD.md) | Done |
| Sample SU emails + the trade documents used in the demo | `samples/emails/` (6 `.eml`, with their PDFs in a folder of the same name) · `samples/demo-emails/` (3 `.eml`, one per outcome) | Done |
| 2-minute demo video: trigger → verification → draft → CG edits and sends | Script below | **You record it** |

Before submitting: merge to `main` and push, rotate the OpenRouter key (it was shown in chat earlier), and add the video link to the *Live Demo* table in the README.

## Before you record

1. **Live model on.** `backend/.env` needs `LLM_PROVIDER=openrouter` and a valid `LLM_API_KEY`. Never show this file on screen.
2. **Start clean** (stop both servers first), so the shipment is `SHP-0001`:
   ```powershell
   cd backend
   Remove-Item -Recurse -Force data\nova.db*, data\uploads, data\emails, data\inbox -ErrorAction SilentlyContinue
   ```
3. **Start both apps**, each in its own terminal: `cd backend; npm run dev` and `cd frontend; npm run dev`. Open http://127.0.0.1:5173 at 100% zoom.
4. **Rehearse once, then reset.** Each sample email can be received only once. After a rehearsal, either repeat step 2, or open the shipment and use **Delete shipment**.
5. **Timing.** On the live model, three attachments take about 30–45 seconds to read. Talk over the wait, or trim it when editing. The video must stay under 2:00.
6. Close other tabs, hide bookmarks and notifications, and record at 1080p.

## The 2-minute script

| Time | On screen | Say |
|---|---|---|
| **0:00–0:15** | **Simulate email** page. Click **Deliver** on *Shipment documents INV-2026-2043*. | "A supplier has just emailed three shipping documents. Today a CG operator opens every PDF and checks every field by hand. Nova wakes up the moment the email arrives." |
| **0:15–0:35** | Follow the link to **Inbox** (the email is there), then **Processing** (the progress bar fills as attachments are read). | "Each attachment is read on its own. Nova works out what a document is from its content, not its filename, and checks every value against the PDF's own text. The model only reads; the decisions are code." |
| **0:35–1:05** | Open the shipment (from **Exceptions** or **Shipments**). Show the headline *2 corrections needed*, then the **Verification** grid. Point at the red cells: HS code on the packing list, gross weight on the bill of lading. | "About thirty seconds later: two corrections. One grid shows every field against every document. The packing list says HS code 6403.22, and the customer requires 6403.99. The bill of lading says 950 kilos where the packing list says 900." |
| **1:05–1:20** | Click the HS code row to open the discrepancy drawer. Show *expected* vs *found*, all three documents' values with confidence, and the source text. | "Clicking a field shows what was expected, what was found, every document's value with its confidence, and the exact text it came from. I can open the original file right here." |
| **1:20–1:45** | Scroll to **Reply to supplier**. Show the draft grouped by file. Add one sentence to the body, for example *Please also confirm the vessel ETA.* Click outside the box so it saves. | "Nova drafted the reply: every discrepancy, grouped by file, with found and expected. It's only a draft. I'll add a line myself. Nothing goes to the supplier until I send it." |
| **1:45–2:00** | Click **Send amendment**, then confirm in the dialog (point at *Simulated: no real email is sent*). Open **Sent emails**. | "I send it, and it's recorded in Sent emails. The shipment now waits for the supplier. Their corrected reply arrives in the same thread as cycle two, and is checked again." |

About 290 words, roughly 1:55 at a normal pace. If you finish early, add this at the end, on the **Queries** page: *"Show me everything pending review for Bata India."*

## If something goes wrong

- **The model is slow or fails with a rate limit (429).** Nova retries on its own. If it still fails, delete the shipment and deliver the email again.
- **The grid shows no red cells.** The shipment was read in fake mode, where every document returns the same clean values. Check `LLM_PROVIDER=openrouter`.
- **"This email was already received."** The sample was delivered before. Delete that shipment, or reset the data folder as in step 2.

## Optional second video: other outcomes

Only if the brief allows more than one clip. Each is about 30 seconds:

- **`04-review`:** a scanned packing list with a smudged HS code goes to **Exceptions** as *Needs your review*. Click *I checked the original and it's fine*, enter 6403.99 and confirm; validation then runs.
- **`02-intake` then `02-intake-reply`:** a damaged file gets a resend request first; the reply becomes cycle 2 and is checked as a full set.
- **`01-clean`:** everything agrees, and the fumigation certificate is tagged *Other* without any review.
