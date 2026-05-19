import { stringify } from "yaml";

export type OutputFormat = "json" | "yaml";

export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(data);
    case "yaml":
      return stringify(data).trimEnd();
  }
}
