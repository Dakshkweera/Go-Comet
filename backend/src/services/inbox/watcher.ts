import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../../utils/logger.js";

export type WatcherDeps = {
  dir: string;
  pollMs: number;
  ingest: (raw: Buffer) => Promise<unknown>;
  logger: Logger;
};

/** Polls the inbox folder; fs.watch is unreliable on Windows and network drives. */
export function createInboxWatcher({ dir, pollMs, ingest, logger }: WatcherDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let stopped = true;

  async function scan() {
    const processed = join(dir, "processed");
    const failed = join(dir, "failed");
    await mkdir(processed, { recursive: true });
    await mkdir(failed, { recursive: true });

    const names = (await readdir(dir)).filter((name) => name.endsWith(".eml"));
    const files = await Promise.all(
      names.map(async (name) => ({ name, time: (await stat(join(dir, name))).mtimeMs })),
    );
    for (const { name } of files.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))) {
      const path = join(dir, name);
      let target = processed;
      try {
        await ingest(await readFile(path));
      } catch (err) {
        target = failed;
        logger.warn({ err, file: name }, "inbox email rejected");
      }
      await rename(path, join(target, `${Date.now()}-${name}`));
    }
  }

  function poll() {
    running ??= scan()
      .catch((err) => logger.error({ err }, "inbox scan failed"))
      .finally(() => {
        running = null;
      });
    return running;
  }

  function schedule() {
    if (!stopped) timer = setTimeout(() => void poll().finally(schedule), pollMs);
  }

  return {
    poll,
    start() {
      if (pollMs <= 0 || !stopped) return;
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type InboxWatcher = ReturnType<typeof createInboxWatcher>;
