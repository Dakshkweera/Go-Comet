import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const samplePath = (name: string) =>
  fileURLToPath(new URL(`../../../samples/${name}-invoice.pdf`, import.meta.url));

export const sampleBuffer = (name: string) => readFileSync(samplePath(name));

export const recordedReply = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
  );
