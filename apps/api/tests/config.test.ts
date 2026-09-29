import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const root = resolve("/repo");

describe("loadConfig", () => {
  it("applies defaults and resolves paths against the repo root", () => {
    const cfg = loadConfig({}, root);
    expect(cfg.port).toBe(3000);
    expect(cfg.llm.provider).toBe("fake");
    expect(cfg.databasePath).toBe(resolve(root, "data/nova.db"));
    expect(cfg.webDistDir).toBe(resolve(root, "apps/web/dist"));
    expect(cfg.limits.maxUploadBytes).toBe(15 * 1024 * 1024);
  });

  it("treats empty strings as unset", () => {
    const cfg = loadConfig({ LLM_API_KEY: "", EXTRACTOR_MODEL: "  " }, root);
    expect(cfg.llm.apiKey).toBeNull();
    expect(cfg.llm.models.extractor).toBeNull();
  });

  it("requires a key and every model ID for openrouter", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openrouter", LLM_API_KEY: "k" }, root)).toThrow(
      /EXTRACTOR_MODEL/,
    );
    const cfg = loadConfig(
      {
        LLM_PROVIDER: "openrouter",
        LLM_API_KEY: "k",
        EXTRACTOR_MODEL: "m1",
        QUERY_ROUTER_MODEL: "m2",
        SQL_MODEL: "m3",
        ANSWER_MODEL: "m4",
      },
      root,
    );
    expect(cfg.llm.models).toEqual({ extractor: "m1", queryRouter: "m2", sql: "m3", answer: "m4" });
  });

  it.each([
    ["EXTRACTION_MIN_CONFIDENCE", "1.5"],
    ["PORT", "0"],
    ["LLM_MAX_ATTEMPTS", "50"],
    ["LLM_PROVIDER", "openai"],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => loadConfig({ [key]: value }, root)).toThrow(/Invalid configuration/);
  });
});
