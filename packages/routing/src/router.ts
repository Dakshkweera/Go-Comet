import { REQUIRED_FIELDS, type Router, type RouterDecision } from "@nova/contracts";
import { assessField } from "@nova/validation";
import { draftAmendment, toDiscrepancy } from "./amendment.js";

const label = (field: string) => field.replaceAll("_", " ");

const humanReview = (reasoning: string): RouterDecision => ({
  decision: "human_review",
  reasoning,
  discrepancies: [],
  amendmentDraft: null,
});

export function createRouter({ minConfidence }: { minConfidence: number }): Router {
  return {
    decide({ customerResolution, rulesAvailable, extraction, validations, pipelineErrors }) {
      if (pipelineErrors.length > 0 || !extraction) {
        const errors = pipelineErrors.map((e) => e.message).join(" ");
        return humanReview(`The document could not be processed reliably. ${errors}`.trim());
      }

      if (!customerResolution || customerResolution.status !== "resolved") {
        return humanReview(
          `Customer could not be identified: ${customerResolution?.reason ?? "no customer resolution"}. ` +
            "No customer rules were applied.",
        );
      }
      const customer = `Customer was resolved as ${customerResolution.customerName}.`;

      if (!rulesAvailable || validations.length === 0) {
        return humanReview(`${customer} No validation rules are configured for this customer.`);
      }

      const issues = new Map<string, string>();
      for (const field of REQUIRED_FIELDS) {
        const { reliable, reasons } = assessField(field, extraction[field], minConfidence);
        if (!reliable) issues.set(field, reasons.join("; "));
      }
      for (const v of validations) {
        if (v.status === "uncertain" && !issues.has(v.field)) issues.set(v.field, v.reason);
      }
      if (issues.size > 0) {
        const list = [...issues].map(([field, reason]) => `${label(field)} (${reason})`).join("; ");
        return humanReview(
          `${customer} Automatic compliance could not be established because of: ${list}.`,
        );
      }

      const mismatches = validations.filter((v) => v.status === "mismatch");
      if (mismatches.length > 0) {
        const discrepancies = mismatches.map(toDiscrepancy);
        const list = discrepancies
          .map((d) => `${label(d.field)} found ${d.found}, expected ${d.expected}`)
          .join("; ");
        return {
          decision: "amendment_request",
          reasoning: `${customer} All required fields were read reliably, but ${mismatches.length} rule(s) failed: ${list}.`,
          discrepancies,
          amendmentDraft: draftAmendment(extraction.invoice_number.value, discrepancies),
        };
      }

      const validated = new Set(validations.map((v) => v.field));
      const notValidated = REQUIRED_FIELDS.filter((f) => !validated.has(f)).map(label);
      return {
        decision: "auto_approve",
        reasoning:
          `${customer} All ${validations.length} configured rules matched and every required field was read reliably.` +
          (notValidated.length
            ? ` Not validated (no customer rule): ${notValidated.join(", ")}.`
            : ""),
        discrepancies: [],
        amendmentDraft: null,
      };
    },
  };
}
