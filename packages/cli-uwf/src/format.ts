import { stringify } from "yaml";

export type OutputFormat = "json" | "yaml" | "table";

function formatTable(data: Array<Record<string, unknown>>): string {
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

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(data);
    case "yaml":
      return stringify(data).trimEnd();
    case "table":
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
        return formatTable(data as Array<Record<string, unknown>>);
      }
      return stringify(data).trimEnd();
  }
}
