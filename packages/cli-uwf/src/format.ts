import { stringify } from "yaml";

export type OutputFormat = "json" | "yaml" | "table";

function formatHorizontalTable(data: Array<Record<string, unknown>>): string {
  if (data.length === 0) return "";
  const keys = Object.keys(data[0]);
  const widths = keys.map((k) => {
    let max = k.length;
    for (const row of data) {
      const len = String(row[k] ?? "").length;
      if (len > max) max = len;
    }
    return max;
  });
  const header = keys.map((k, i) => k.toUpperCase().padEnd(widths[i])).join("  ");
  const rows = data.map((row) =>
    keys.map((k, i) => String(row[k] ?? "").padEnd(widths[i])).join("  "),
  );
  return [header, ...rows].join("\n");
}

function formatVerticalTable(data: Record<string, unknown>): string {
  const entries = Object.entries(data);
  if (entries.length === 0) return "";
  const keyWidth = Math.max(...entries.map(([k]) => k.length));
  const header = `${"KEY".padEnd(keyWidth)}  VALUE`;
  const rows = entries.map(
    ([k, v]) => `${k.padEnd(keyWidth)}  ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
  );
  return [header, ...rows].join("\n");
}

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(data);
    case "yaml":
      return stringify(data).trimEnd();
    case "table":
      if (
        Array.isArray(data) &&
        data.length > 0 &&
        typeof data[0] === "object" &&
        data[0] !== null
      ) {
        return formatHorizontalTable(data as Array<Record<string, unknown>>);
      }
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        return formatVerticalTable(data as Record<string, unknown>);
      }
      return stringify(data).trimEnd();
  }
}
