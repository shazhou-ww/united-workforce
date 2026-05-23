import { readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

type LogListItem = {
  name: string;
  size: number;
  date: string;
};

type LogShowFilter = {
  thread: string | null;
  process: string | null;
  date: string | null;
};

type LogEntry = {
  ts: string;
  pid: string;
  tag: string;
  msg: string;
  thread: string | null;
  workflow: string | null;
};

type LogCleanResult = {
  deleted: number;
};

function logsDir(storageRoot: string): string {
  return join(storageRoot, "logs");
}

async function listLogFiles(dir: string): Promise<Array<string>> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
}

function dateFromFilename(name: string): string {
  return name.replace(".jsonl", "");
}

async function parseJsonlFile(path: string): Promise<Array<LogEntry>> {
  const content = await readFile(path, "utf-8");
  const lines = content.trim().split("\n").filter((l) => l.length > 0);
  return lines.map((line) => JSON.parse(line) as LogEntry);
}

export async function cmdLogList(storageRoot: string): Promise<Array<LogListItem>> {
  const dir = logsDir(storageRoot);
  const files = await listLogFiles(dir);
  const items: Array<LogListItem> = [];
  for (const name of files) {
    const s = await stat(join(dir, name));
    items.push({ name, size: s.size, date: dateFromFilename(name) });
  }
  // sort by date descending
  items.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  return items;
}

export async function cmdLogShow(
  storageRoot: string,
  filter: LogShowFilter,
): Promise<Array<LogEntry>> {
  const dir = logsDir(storageRoot);
  let files: Array<string>;

  if (filter.date !== null) {
    files = [`${filter.date}.jsonl`];
  } else {
    files = await listLogFiles(dir);
  }

  let entries: Array<LogEntry> = [];
  for (const file of files) {
    try {
      const parsed = await parseJsonlFile(join(dir, file));
      entries = entries.concat(parsed);
    } catch {
      // file doesn't exist or is unreadable, skip
    }
  }

  if (filter.thread !== null) {
    entries = entries.filter((e) => e.thread === filter.thread);
  }
  if (filter.process !== null) {
    entries = entries.filter((e) => e.pid === filter.process);
  }

  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return entries;
}

export async function cmdLogClean(
  storageRoot: string,
  before: string,
): Promise<LogCleanResult> {
  const dir = logsDir(storageRoot);
  const files = await listLogFiles(dir);
  let deleted = 0;

  for (const name of files) {
    const date = dateFromFilename(name);
    if (date < before) {
      await unlink(join(dir, name));
      deleted++;
    }
  }

  return { deleted };
}
