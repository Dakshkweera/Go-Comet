import type { ExtractorAgent } from "../../schemas/index.js";

/** Caps parallel model calls; a slot is held only during a call, not during retry backoff. */
export function limitExtractor(extractor: ExtractorAgent, max: number): ExtractorAgent {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = async () => {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    async extract(input) {
      await acquire();
      try {
        return await extractor.extract(input);
      } finally {
        release();
      }
    },
  };
}
