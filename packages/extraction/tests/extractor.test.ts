import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LlmError, parseJsonContent, type ChatMessage, type LlmClient } from "@nova/llm";
import { createExtractor, FAKE_EXTRACTION } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "nova-extract-"));
const filePath = join(dir, "doc.pdf");
writeFileSync(filePath, "%PDF-1.4 test");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const input = { runId: "run_1", documentId: "doc_1", filePath, mimeType: "application/pdf" };

function stubLlm(response: unknown) {
  const calls: ChatMessage[][] = [];
  const llm: LlmClient = {
    chatJson: async ({ messages }) => {
      calls.push(messages);
      return response;
    },
  };
  return { llm, calls };
}

describe("extractor", () => {
  it("sends the PDF as a file part and returns schema-valid output", async () => {
    const { llm, calls } = stubLlm(FAKE_EXTRACTION);
    const result = await createExtractor({ llm, model: "m" }).extract(input);
    expect(result).toEqual(FAKE_EXTRACTION);
    const userContent = calls[0]![1]!.content as { type: string }[];
    expect(userContent.map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("rejects output that does not match the schema as a retryable error", async () => {
    const { llm } = stubLlm({ hs_code: { value: "640399", confidence: 3 } });
    const err = await createExtractor({ llm, model: "m" })
      .extract(input)
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "MODEL_OUTPUT_INVALID", retryable: true });
  });
});

describe("parseJsonContent", () => {
  it("accepts fenced JSON and rejects prose", () => {
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonContent("Sure! Here is the data")).toThrow(LlmError);
  });
});
