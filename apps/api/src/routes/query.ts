import type { FastifyInstance } from "fastify";
import { queryRequestSchema } from "../../../../packages/contracts/src/index.js";
import { QueryError } from "../../../../packages/query/src/index.js";
import { queryService } from "../container.js";

export default async function queryRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const body = queryRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: { code: "INVALID_QUESTION", message: "Ask a question (max 500 characters)." },
      });
    }
    if (!queryService) {
      return reply.code(503).send({
        error: {
          code: "QUERY_UNAVAILABLE",
          message: "Set LLM_PROVIDER=openrouter to enable questions.",
        },
      });
    }
    try {
      return await queryService.answer(body.data.question);
    } catch (err) {
      if (err instanceof QueryError) {
        return reply.code(422).send({ error: { code: err.code, message: err.message } });
      }
      request.log.error({ err }, "query failed");
      return reply.code(502).send({
        error: { code: "QUERY_FAILED", message: "The question could not be answered right now." },
      });
    }
  });
}
