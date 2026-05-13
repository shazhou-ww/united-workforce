/**
 * Read a required environment variable. Throws with `message` if missing or empty.
 */
export function requireEnv(name: string, message: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(message);
  }
  return value;
}

/**
 * Read an optional environment variable. Returns `fallback` if missing or empty.
 */
export function optionalEnv(name: string, fallback: string): string;
export function optionalEnv(name: string): string | null;
export function optionalEnv(name: string, fallback?: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback ?? null;
  }
  return value;
}
