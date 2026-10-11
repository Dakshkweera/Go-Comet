import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().min(1).optional(),
);

const envSchema = z
  .object({
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: optionalString.default("./data/nova.db"),
    UPLOAD_DIR: optionalString.default("./data/uploads"),
    CORS_ORIGIN: optionalString.default("http://localhost:5173,http://127.0.0.1:5173"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    LLM_PROVIDER: z.enum(["fake", "openrouter"]).default("fake"),
    LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    LLM_API_KEY: optionalString,
    EXTRACTOR_MODEL: optionalString,
    QUERY_ROUTER_MODEL: optionalString,
    SQL_MODEL: optionalString,
    ANSWER_MODEL: optionalString,

    EXTRACTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(15),
    LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

    INBOX_DIR: optionalString.default("./data/inbox"),
    INBOX_POLL_MS: z.coerce.number().int().min(0).default(2000),
    EMAIL_DIR: optionalString.default("./data/emails"),
    SAMPLE_EMAILS_DIR: optionalString.default("../samples/emails"),
    MAX_ATTACHMENTS: z.coerce.number().int().min(1).max(50).default(10),
    MAX_EMAIL_MB: z.coerce.number().positive().max(200).default(25),
    CG_MAILBOX: z.string().trim().email().default("cg@nova.local"),
    CG_SIGNATURE: optionalString.default("CG Team"),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER !== "openrouter") return;
    for (const key of [
      "LLM_API_KEY",
      "EXTRACTOR_MODEL",
      "QUERY_ROUTER_MODEL",
      "SQL_MODEL",
      "ANSWER_MODEL",
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `required when LLM_PROVIDER=openrouter`,
        });
      }
    }
  });

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv, baseDir: string) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join("\n  ")}`);
  }
  const e = parsed.data;
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p));

  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: abs(e.DATABASE_PATH),
    uploadDir: abs(e.UPLOAD_DIR),
    corsOrigins: e.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    llm: {
      provider: e.LLM_PROVIDER,
      baseUrl: e.LLM_BASE_URL,
      apiKey: e.LLM_API_KEY ?? null,
      maxAttempts: e.LLM_MAX_ATTEMPTS,
      timeoutMs: e.LLM_TIMEOUT_MS,
      concurrency: e.EXTRACTION_CONCURRENCY,
      models: {
        extractor: e.EXTRACTOR_MODEL ?? null,
        queryRouter: e.QUERY_ROUTER_MODEL ?? null,
        sql: e.SQL_MODEL ?? null,
        answer: e.ANSWER_MODEL ?? null,
      },
    },
    policy: {
      extractionMinConfidence: e.EXTRACTION_MIN_CONFIDENCE,
    },
    limits: {
      maxUploadBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024),
      maxEmailBytes: Math.floor(e.MAX_EMAIL_MB * 1024 * 1024),
      maxAttachments: e.MAX_ATTACHMENTS,
    },
    inbox: {
      dir: abs(e.INBOX_DIR),
      pollMs: e.INBOX_POLL_MS,
      emailDir: abs(e.EMAIL_DIR),
      samplesDir: abs(e.SAMPLE_EMAILS_DIR),
    },
    cg: { mailbox: e.CG_MAILBOX, signature: e.CG_SIGNATURE },
  };
}
