import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, documents, pipelineRuns, seedDb, type NovaDb } from "../../db/src/index.js";
import type { LlmClient } from "../../llm/src/index.js";
import { createQueryService, executeReadOnly, QueryError, validateSql } from "../src/index.js";

describe("validateSql", () => {
  it.each([
    "SELECT COUNT(*) FROM pipeline_runs WHERE final_decision = 'human_review'",
    "SELECT d.original_filename FROM pipeline_runs pr JOIN documents d ON d.id = pr.document_id;",
    "WITH recent AS (SELECT * FROM pipeline_runs) SELECT COUNT(*) FROM recent",
  ])("accepts %s", (sql) => {
    expect(validateSql(sql).valid).toBe(true);
  });

  it.each([
    ["DELETE FROM pipeline_runs", "Only SELECT"],
    ["UPDATE decisions SET decision = 'auto_approve'", "Only SELECT"],
    ["DROP TABLE customers", "Only SELECT"],
    ["INSERT INTO customers VALUES ('x')", "Only SELECT"],
    ["SELECT 1; DROP TABLE customers", "single statement"],
    ["SELECT * FROM customers -- hide", "comments"],
    ["SELECT * FROM sqlite_master", "not available"],
    ["WITH x AS (DELETE FROM customers) SELECT 1", "DELETE"],
    ["PRAGMA table_info(customers)", "Only SELECT"],
  ])("rejects %s", (sql, reason) => {
    const result = validateSql(sql);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(reason);
  });
});

describe("query service", () => {
  let db: NovaDb;

  beforeEach(() => {
    db = createDb(":memory:");
    seedDb(db);
    db.insert(documents)
      .values({
        id: "doc_1",
        originalFilename: "messy.pdf",
        mimeType: "application/pdf",
        fileSize: 1,
        storagePath: "x",
      })
      .run();
    db.insert(pipelineRuns)
      .values({
        id: "run_1",
        documentId: "doc_1",
        status: "COMPLETED",
        currentStage: "COMPLETED",
        finalDecision: "human_review",
      })
      .run();
  });

  afterEach(() => db.$client.close());

  function serviceWith(responses: unknown[]) {
    const prompts: string[] = [];
    const llm: LlmClient = {
      chatJson: async ({ messages }) => {
        prompts.push(String(messages[1]!.content));
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    };
    const service = createQueryService({
      db,
      llm,
      models: { queryRouter: "r", sql: "s", answer: "a" },
    });
    return { service, prompts };
  }

  it("answers a database question from SQLite rows", async () => {
    const { service, prompts } = serviceWith([
      { type: "database_query", reason: "stored runs" },
      { sql: "SELECT COUNT(*) AS n FROM pipeline_runs WHERE final_decision = 'human_review'" },
      { answer: "1 shipment was flagged for human review." },
    ]);
    const res = await service.answer("How many shipments were flagged?");
    expect(res.data?.rows).toEqual([{ n: 1 }]);
    expect(res.answer).toBe("1 shipment was flagged for human review.");
    expect(prompts[2]).toContain('"n":1');
  });

  it("returns a fixed answer for empty results without asking the model", async () => {
    const { service, prompts } = serviceWith([
      { type: "database_query", reason: "stored runs" },
      { sql: "SELECT id FROM pipeline_runs WHERE final_decision = 'auto_approve'" },
    ]);
    const res = await service.answer("Which shipments were auto-approved?");
    expect(res.answer).toBe("No matching records were found.");
    expect(prompts).toHaveLength(2);
  });

  it("regenerates once, then refuses unsafe SQL without executing it", async () => {
    const { service } = serviceWith([
      { type: "database_query", reason: "x" },
      { sql: "DELETE FROM pipeline_runs" },
      { sql: "DROP TABLE decisions" },
    ]);
    await expect(service.answer("Delete everything")).rejects.toBeInstanceOf(QueryError);
    expect(executeReadOnly(db, "SELECT COUNT(*) AS n FROM pipeline_runs").rows).toEqual([{ n: 1 }]);
  });

  it("falls back to a row count when the answer model fails", async () => {
    const { service } = serviceWith([
      { type: "database_query", reason: "x" },
      { sql: "SELECT id FROM pipeline_runs" },
      new Error("model down"),
    ]);
    expect((await service.answer("List runs")).answer).toBe("The query returned 1 row(s).");
  });

  it("answers general questions without touching the database", async () => {
    const { service } = serviceWith([
      { type: "general_question", reason: "definition" },
      { answer: "FOB means Free On Board." },
    ]);
    expect(await service.answer("What does FOB mean?")).toEqual({
      type: "general_question",
      answer: "FOB means Free On Board.",
      data: null,
      sql: null,
    });
  });
});
