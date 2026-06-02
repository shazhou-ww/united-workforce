import { decodeCrockfordBase32Bits, encodeCrockfordBase32Bits } from "./base32.js";

const ULID_TIME_BITS = 48;
const ULID_RANDOM_BITS = 80;

function readRandomUint80(): bigint {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) {
    x = (x << 8n) | BigInt(bytes[i]);
  }
  return x & ((1n << 80n) - 1n);
}

/**
 * Generate a ULID using Crockford Base32: 10 timestamp chars + 16 random chars.
 * Timestamp uses 48 bits of Unix time in milliseconds.
 */
export function generateUlid(nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs < 0 || nowMs >= 2 ** ULID_TIME_BITS) {
    throw new Error("nowMs must be a finite number in [0, 2^48)");
  }
  const time = BigInt(Math.floor(nowMs));
  const rand = readRandomUint80();
  const payload = (time << BigInt(ULID_RANDOM_BITS)) | rand;
  return encodeCrockfordBase32Bits(payload, ULID_TIME_BITS + ULID_RANDOM_BITS);
}

/**
 * Extract the timestamp (in milliseconds) from a ULID string.
 * Returns null if the ULID is invalid.
 */
export function extractUlidTimestamp(ulid: string): number | null {
  if (ulid.length !== 26) {
    return null;
  }
  const timestampPart = ulid.slice(0, 10);
  const decoded = decodeCrockfordBase32Bits(timestampPart, ULID_TIME_BITS);
  if (!decoded.ok) {
    return null;
  }
  return Number(decoded.value);
}
