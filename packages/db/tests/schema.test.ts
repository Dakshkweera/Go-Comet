import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  customerRules,
  customers,
  decisions,
  documents,
  extractions,
  pipelineRuns,
  seedDb,
  type NovaDb,
} from "../src/index.js";

let db: NovaDb;

beforeEach(() => {
  db = createDb(":memory:");
});

afterEach(() => {
  db.$client.close();
});

function insertRun(runId = "run_1") {
  db.insert(documents)
    .values({
      id: `doc_${runId}`,
      originalFilename: "a.pdf",
      mimeType: "application/pdf",
      fileSize: 1,
      storagePath: "x",
    })
    .run();
  db.insert(pipelineRuns)
    .values({ id: runId, documentId: `doc_${runId}`, status: "RECEIVED", currentStage: "RECEIVED" })
    .run();
}

describe("seedDb", () => {
  it("creates Bata India with 5 rules and is safe to run twice", () => {
    seedDb(db);
    seedDb(db);
    expect(db.select().from(customers).all()).toHaveLength(1);
    const rules = db
      .select()
      .from(customerRules)
      .where(eq(customerRules.customerId, "cust_bata_india"))
      .all();
    expect(rules.map((r) => r.field).sort()).toEqual([
      "gross_weight",
      "hs_code",
      "incoterms",
      "port_of_discharge",
      "port_of_loading",
    ]);
  });
});

describe("constraints", () => {
  it("rejects a run for a missing document", () => {
    expect(() =>
      db
        .insert(pipelineRuns)
        .values({ id: "run_x", documentId: "nope", status: "RECEIVED", currentStage: "RECEIVED" })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("allows one extraction row per field per run", () => {
    insertRun();
    const row = { runId: "run_1", fieldName: "hs_code", valueText: "640399", confidence: 0.9 };
    db.insert(extractions)
      .values({ id: "ext_1", ...row })
      .run();
    expect(() =>
      db
        .insert(extractions)
        .values({ id: "ext_2", ...row })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("allows one decision per run", () => {
    insertRun();
    const row = { runId: "run_1", decision: "auto_approve", reasoning: "ok" };
    db.insert(decisions)
      .values({ id: "dec_1", ...row })
      .run();
    expect(() =>
      db
        .insert(decisions)
        .values({ id: "dec_2", ...row })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("rolls back a failed transaction", () => {
    insertRun();
    expect(() =>
      db.transaction((tx) => {
        tx.insert(extractions)
          .values({ id: "ext_1", runId: "run_1", fieldName: "hs_code", confidence: 0.9 })
          .run();
        tx.insert(extractions)
          .values({ id: "ext_2", runId: "missing", fieldName: "hs_code", confidence: 0.9 })
          .run();
      }),
    ).toThrow();
    expect(db.select().from(extractions).all()).toHaveLength(0);
  });
});
