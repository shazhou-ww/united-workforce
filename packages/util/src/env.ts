/**
 * Read an environment variable with a required fallback default.
 * Returns the env value if set and non-empty, otherwise returns `fallback`.
 *
 * Every env var in a bundle must have a sensible default — bundles must run
 * without any env vars set. Env vars are overrides, not requirements.
 */
export function env(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}
