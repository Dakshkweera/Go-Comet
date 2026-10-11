import type {
  CustomerResolution,
  CustomerRule,
  IssueResolution,
  ShipmentDocument,
  Validator,
} from "../../schemas/index.js";
import { applyResolutions, fieldStates, isOpen, routeShipment, toSend } from "../routing/index.js";
import {
  checkConsistency,
  checkIntake,
  describeFields,
  resolveShipmentCustomer,
} from "../validation/index.js";
import { applyVerifiedValues } from "./documents.js";

export type AssessInput = {
  documents: ShipmentDocument[];
  actions: Map<string, IssueResolution>;
  resolveCustomer: (consignee: string | null) => CustomerResolution;
  loadRules: (customerId: string) => CustomerRule[];
  validator: Validator;
  minConfidence: number;
};

/** Stage 1, then stage 2 only on a clean intake, then the route. Pure apart from the lookups. */
export function assessShipment(input: AssessInput) {
  const { documents, actions, validator, minConfidence } = input;
  const { documents: checked, verified } = applyVerifiedValues(documents, actions);
  const customer = resolveShipmentCustomer(checked, input.resolveCustomer);
  const rules =
    customer.status === "resolved" && customer.customerId
      ? input.loadRules(customer.customerId)
      : [];

  const stage1 = applyResolutions(
    checkIntake({ documents, customer, rulesCount: rules.length, minConfidence }),
    actions,
  );
  const intakeClear = !stage1.some(isOpen) && !stage1.some(toSend);
  const consistency = intakeClear
    ? checkConsistency({
        documents: checked,
        rules,
        customer: {
          id: customer.customerId ?? "unknown",
          name: customer.customerName ?? "the customer",
        },
        validator,
        minConfidence,
      })
    : null;
  const stage2 = consistency ? applyResolutions(consistency.issues, actions) : null;
  const route = routeShipment({
    stage1,
    stage2,
    documents,
    customerName: customer.customerName,
    customerReason: customer.reason,
    rulesCount: rules.length,
  });
  const issues = [...stage1, ...(stage2 ?? [])];
  const fields = describeFields({
    documents: checked,
    verified,
    checks: consistency?.checks ?? null,
    states: fieldStates(issues),
    minConfidence,
  });
  return { customer, checked, stage1, stage2, route, issues, fields };
}
