import pino, { type Logger } from "pino";

export type { Logger };

export const createLogger = (level: string): Logger => pino({ level });
