import type { NovaDb } from "./client.js";
import { customerRules, customers } from "./schema.js";

const CUSTOMER_ID = "cust_bata_india";

const rules = [
  { id: "rule_bata_hs_code", field: "hs_code", operator: "EXACT", expectedValue: "640399" },
  { id: "rule_bata_pol", field: "port_of_loading", operator: "EXACT", expectedValue: "Shanghai" },
  { id: "rule_bata_pod", field: "port_of_discharge", operator: "EXACT", expectedValue: "Mumbai" },
  { id: "rule_bata_incoterms", field: "incoterms", operator: "EXACT", expectedValue: "FOB" },
  { id: "rule_bata_weight", field: "gross_weight", operator: "MAX", maxValue: 1000, unit: "kg" },
];

export function seedDb(db: NovaDb) {
  db.transaction((tx) => {
    tx.insert(customers)
      .values({ id: CUSTOMER_ID, name: "Bata India", normalizedName: "bata india" })
      .onConflictDoNothing()
      .run();
    for (const rule of rules) {
      tx.insert(customerRules)
        .values({ ...rule, customerId: CUSTOMER_ID })
        .onConflictDoNothing()
        .run();
    }
  });
}
