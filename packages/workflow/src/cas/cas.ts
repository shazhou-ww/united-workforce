import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { hashString } from "./hash.js";
import type { CasStore } from "./types.js";

export function createCasStore(casDir: string): CasStore {
  async function ensureDir(): Promise<void> {
    await mkdir(casDir, { recursive: true });
  }

  function filePath(hash: string): string {
    return join(casDir, `${hash}.txt`);
  }

  return {
    async put(content: string): Promise<string> {
      const hash = hashString(content);
      await ensureDir();
      const target = filePath(hash);
      const tmp = `${target}.tmp.${Date.now()}`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, target);
      return hash;
    },

    async get(hash: string): Promise<string | null> {
      try {
        return await readFile(filePath(hash), "utf8");
      } catch (e) {
        const errObj = e as NodeJS.ErrnoException;
        if (errObj.code === "ENOENT") {
          return null;
        }
        throw e;
      }
    },

    async delete(hash: string): Promise<void> {
      try {
        await unlink(filePath(hash));
      } catch (e) {
        const errObj = e as NodeJS.ErrnoException;
        if (errObj.code === "ENOENT") {
          return;
        }
        throw e;
      }
    },

    async list(): Promise<string[]> {
      try {
        const entries = await readdir(casDir);
        return entries.filter((name) => name.endsWith(".txt")).map((name) => name.slice(0, -4));
      } catch (e) {
        const errObj = e as NodeJS.ErrnoException;
        if (errObj.code === "ENOENT") {
          return [];
        }
        throw e;
      }
    },
  };
}

/** @deprecated Use {@link createCasStore} — CAS is global, not per-thread. */
export const createThreadCas = createCasStore;
