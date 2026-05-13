import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import type { PresetProvider } from "./types.js";



type RawPresetEntry = {
	name: unknown;
	label: unknown;
	baseUrl: unknown;
};

function isRawEntry(v: unknown): v is RawPresetEntry {
	if (typeof v !== "object" || v === null) return false;
	const o = v as Record<string, unknown>;
	return typeof o.name === "string" && typeof o.label === "string" && typeof o.baseUrl === "string";
}

let cached: ReadonlyArray<PresetProvider> | null = null;

export function loadPresetProviders(): ReadonlyArray<PresetProvider> {
	if (cached !== null) return cached;

	const yamlPath = join(import.meta.dirname, "providers.yaml");
	const raw = readFileSync(yamlPath, "utf8");
	const parsed: unknown = parseYaml(raw);

	if (!Array.isArray(parsed)) {
		throw new Error(`providers.yaml: expected array, got ${typeof parsed}`);
	}

	const result: PresetProvider[] = [];
	for (const entry of parsed) {
		if (!isRawEntry(entry)) {
			throw new Error(`providers.yaml: invalid entry: ${JSON.stringify(entry)}`);
		}
		result.push({
			name: entry.name as string,
			label: entry.label as string,
			baseUrl: entry.baseUrl as string,
		});
	}

	cached = result;
	return result;
}
