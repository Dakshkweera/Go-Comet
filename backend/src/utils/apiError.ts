import type { ApiError } from "../schemas/index.js";

export const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });
