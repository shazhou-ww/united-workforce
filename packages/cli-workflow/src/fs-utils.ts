import { readFile, stat } from "node:fs/promises";

export async function readTextFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
