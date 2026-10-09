import type { SqlValidationResult } from "../../contracts/src/index.js";


//  validate sql genrated to ensure that no harmful statements are executed and only allowed tables are used in the query
export const ALLOWED_TABLES = new Set([
  "customers",
  "customer_rules",
  "documents",
  "pipeline_runs",
  "extractions",
  "validation_results",
  "decisions",
  "pipeline_stage_runs",
]);

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release)\b/i;

export function validateSql(raw: string): SqlValidationResult {
  const sql = raw.trim().replace(/;\s*$/, "");
  const invalid = (reason: string) => ({ valid: false, reason });

  if (!sql) return invalid("Query is empty.");
  if (sql.includes(";")) return invalid("Only a single statement is allowed.");
  if (/--|\/\*/.test(sql)) return invalid("SQL comments are not allowed.");
  if (!/^(select|with)\b/i.test(sql)) return invalid("Only SELECT queries are allowed.");
  const forbidden = sql.match(FORBIDDEN);
  if (forbidden) return invalid(`${forbidden[1]!.toUpperCase()} statements are not permitted.`);

  const cteNames = new Set(
    [...sql.matchAll(/(?:with|,)\s*(\w+)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase()),
  );
  for (const [, table] of sql.matchAll(/\b(?:from|join)\s+([\w."]+)/gi)) {
    const name = table!.replaceAll('"', "").toLowerCase();
    if (!ALLOWED_TABLES.has(name) && !cteNames.has(name)) {
      return invalid(`Table "${name}" is not available to queries.`);
    }
  }
  return { valid: true, reason: "Read-only SELECT query using allowed tables." };
}
