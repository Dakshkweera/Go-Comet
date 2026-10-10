import { describe, expect, it } from "vitest";
import { apiErrorSchema, healthResponseSchema } from "../../src/schemas/index.js";

describe("healthResponseSchema", () => {
  it("accepts a valid health body", () => {
    expect(healthResponseSchema.parse({ status: "ok", db: "ok" })).toEqual({
      status: "ok",
      db: "ok",
    });
  });

  it("rejects an unknown status", () => {
    expect(healthResponseSchema.safeParse({ status: "fine", db: "ok" }).success).toBe(false);
  });
});

describe("apiErrorSchema", () => {
  it("rejects an empty error code", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "", message: "x" } }).success).toBe(false);
  });
});
