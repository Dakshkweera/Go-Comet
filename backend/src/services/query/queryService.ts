import { z } from "zod";
import {
  queryClassificationSchema,
  sqlGenerationResultSchema,
  type QueryExecutionResult,
  type QueryResponse,
} from "../../schemas/index.js";
import type { NovaDb } from "../../db/index.js";
import type { LlmClient } from "../llm/index.js";
import { ANSWER_PROMPT, CLASSIFY_PROMPT, GENERAL_PROMPT, SQL_PROMPT } from "./prompts.js";
import { validateSql } from "./sqlValidator.js";

const MAX_ROWS = 200;
// Server paths and hashes are never shown, even when the model selects every column.
const INTERNAL_COLUMNS = new Set(["storage_path", "raw_path", "content_hash", "evaluation_hash"]);
const answerSchema = z.object({ answer: z.string().min(1) });

export class QueryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type QueryModels = { queryRouter: string; sql: string; answer: string };

// limit output and check is it read only from db
export function executeReadOnly(db: NovaDb, sql: string): QueryExecutionResult {
  const stmt = db.$client.prepare(
    `SELECT * FROM (${sql.trim().replace(/;\s*$/, "")}) LIMIT ${MAX_ROWS}`,
  );
  if (!stmt.readonly)
    throw new QueryError("SQL_INVALID", "Only read-only queries can be executed.");
  const columns = stmt
    .columns()
    .map((c) => c.name)
    .filter((name) => !INTERNAL_COLUMNS.has(name));
  const rows = (stmt.all() as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(columns.map((name) => [name, row[name]])),
  );
  return { columns, rows };
}

export function createQueryService({
  db,
  llm,
  models,
}: {
  db: NovaDb;
  llm: LlmClient;
  models: QueryModels;
}) {
  const ask = async <T>(model: string, system: string, user: string, schema: z.ZodType<T>) =>
    schema.parse(
      await llm.chatJson({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    );

  async function generateValidSql(question: string): Promise<string> {
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { sql } = await ask(
        models.sql,
        SQL_PROMPT,
        question + feedback,
        sqlGenerationResultSchema,
      );
      const check = validateSql(sql);
      if (check.valid) return sql;
      feedback = `\n\nYour previous query was rejected: ${check.reason}`;
    }
    throw new QueryError(
      "SQL_INVALID",
      "The generated query was rejected because it was not a permitted read-only query.",
    );
  }

  return {
    async answer(question: string): Promise<QueryResponse> {
      const { type } = await ask(
        models.queryRouter,
        CLASSIFY_PROMPT,
        question,
        queryClassificationSchema,
      );

      if (type === "general_question") {
        const { answer } = await ask(models.answer, GENERAL_PROMPT, question, answerSchema);
        return { type, answer, data: null, sql: null };
      }

      const sql = await generateValidSql(question);
      let data: QueryExecutionResult;
      try {
        data = executeReadOnly(db, sql);
      } catch (err) {
        if (err instanceof QueryError) throw err;
        throw new QueryError(
          "SQL_EXECUTION_FAILED",
          "The database could not run the generated query.",
        );
      }

      if (data.rows.length === 0) {
        return { type, answer: "No matching records were found.", data, sql };
      }
      try {
        const { answer } = await ask(
          models.answer,
          ANSWER_PROMPT,
          JSON.stringify({
            question,
            sql,
            rows: data.rows.slice(0, 50),
            rowCount: data.rows.length,
          }),
          answerSchema,
        );
        return { type, answer, data, sql };
      } catch {
        return { type, answer: `The query returned ${data.rows.length} row(s).`, data, sql };
      }
    },
  };
}

export type QueryService = ReturnType<typeof createQueryService>;
