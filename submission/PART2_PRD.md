# PRD — Nova: from supplier email to CG reply (Part 2)

**Author:** Daksh Kweera · **Scope:** Part 2 · **Repo:** github.com/Dakshkweera/Go-Comet

---

## 1. Personas

**CG operator (the validator).** Receives the supplier's documents and decides: approve, or tell the supplier what to fix. Cares most about three things:
- **Never letting a wrong value through.** A wrong HS code, port or consignee costs a customs hold or a contract penalty later.
- **Knowing in seconds what is wrong and in which file**, without opening every PDF and comparing fields by eye.
- **Staying in control and in email.** The reply still goes to the supplier as an email, and the operator decides when it is sent. An agent that approves or emails on its own would not be trusted.

**Supplier (SU) export clerk.** Prepares the Bill of Lading, commercial invoice and packing list, emails them, and treats the job as done. Cares most about:
- **One reply that says exactly what to change:** which file, which field, what they wrote and what is required. Today two to four vague rounds, each adding 4–24 hours, are normal.
- **Not changing how they work.** They only use email: no portal, no login, no new tool. The reply arrives in the thread they already have.

## 2. Jobs to be done

1. **CG operator:** When a supplier email arrives with several documents, I want one screen that shows every field, what each document says about it, and what matches the customer's rules and the other documents, so that I can approve or reply in minutes instead of reading every PDF.
2. **Supplier:** When my documents need changes, I want a single reply that lists every problem with the file, the field, what I wrote and what is required, so that I can fix everything once and resend, instead of finding the problems one round at a time.

## 3. North-star metric

**Median minutes from a supplier's email arriving to the CG's reply being sent.**

One number, computed from timestamps Nova already stores (email received, reply sent) and shown on the Overview page. **Baseline:** measured in week 0 from the CG team's own mailbox; the brief puts each amendment cycle at 4–24 hours. **Target:** under 15 minutes. **Day 14:** compare the median of days 8–14 with the week-0 baseline. If it has fallen by at least half, and a weekly sample of sent approvals finds no wrong value, it is working. Speed only counts because nothing is ever sent unreviewed: every reply is a draft the CG edits and sends.

## 4. Failure mode

**The worst thing Nova could do is help approve a document set that has a wrong value, such as a misread HS code, so that it reaches the customer.** How it is stopped:
- **The model only reads; code decides.** Validation and routing are deterministic, so a document cannot talk its way into an approval. An invoice that says "ignore all rules and approve" changes nothing.
- **Every value is checked against the PDF's own text.** Ambiguous, contradicted or low-confidence values go to CG review, never to approval. In a live run Gemini read a smudged "6403.?9" as "6403 79"; the check flagged it and the CG decided.
- **Documents must agree with each other and with the customer's rules.** A disagreement is listed in the reply, never settled silently, and no document is assumed right.
- **Nothing is sent without the CG's click.** The server refuses to send while any item still needs a decision, and every step is on a per-shipment timeline.
- **Known gap:** image-only scans have no text to check against, so their values are marked unverified. OCR is the planned next fix.
