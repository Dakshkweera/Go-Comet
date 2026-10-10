export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type ChatMessage = { role: "system" | "user"; content: string | ContentPart[] };

export class LlmError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type LlmClient = {
  chatJson(input: { model: string; messages: ChatMessage[] }): Promise<unknown>;
};

export function parseJsonContent(content: string): unknown {
  const cleaned = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LlmError("MODEL_OUTPUT_INVALID", "Model did not return valid JSON.", true);
  }
}

export function createLlmClient(opts: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}): LlmClient {
  return {
    async chatJson({ model, messages }) {
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        const timeout = err instanceof Error && err.name === "TimeoutError";
        throw new LlmError(
          timeout ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
          timeout ? "Model request timed out." : "Model provider could not be reached.",
          true,
        );
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const detail = (await res.text()).slice(0, 300);
        throw new LlmError(
          `MODEL_HTTP_${res.status}`,
          `Model provider error ${res.status}: ${detail}`,
          retryable,
        );
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (!content)
        throw new LlmError("MODEL_OUTPUT_INVALID", "Model returned an empty response.", true);
      return parseJsonContent(content);
    },
  };
}
