import type { RequestHandler } from "express";
import { queryRequestSchema } from "../schemas/index.js";
import { QueryError, type QueryService } from "../services/query/index.js";
import { apiError } from "../utils/apiError.js";

export function createQueryController(queryService: QueryService | null) {
  const ask: RequestHandler = async (req, res) => {
    const body = queryRequestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(apiError("INVALID_QUESTION", "Ask a question (max 500 characters)."));
      return;
    }
    if (!queryService) {
      res
        .status(503)
        .json(apiError("QUERY_UNAVAILABLE", "Set LLM_PROVIDER=openrouter to enable questions."));
      return;
    }
    try {
      res.json(await queryService.answer(body.data.question));
    } catch (err) {
      if (err instanceof QueryError) {
        res.status(422).json(apiError(err.code, err.message));
        return;
      }
      req.log.error({ err }, "query failed");
      res
        .status(502)
        .json(apiError("QUERY_FAILED", "The question could not be answered right now."));
    }
  };
  return { ask };
}
