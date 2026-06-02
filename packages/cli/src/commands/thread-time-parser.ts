/**
 * Parse time input: ISO date (YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS) or relative (7d, 24h, 30m)
 * Returns Unix timestamp in milliseconds.
 */
export function parseTimeInput(input: string, nowMs: number): number {
  const trimmed = input.trim();

  // Relative time: 7d, 24h, 30m
  const relativeMatch = /^(\d+)(d|h|m)$/.exec(trimmed);
  if (relativeMatch !== null) {
    const value = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const multiplier = unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000;
    return nowMs - value * multiplier;
  }

  // ISO date: try parsing
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`invalid time format: ${trimmed} (expected ISO date or relative like '7d')`);
  }
  return parsed;
}
