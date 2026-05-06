import { err, ok, type Result } from "./result.js";

/** Crockford Base32 alphabet (no I, L, O, U). */
export const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXZ";

const DECODE_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < CROCKFORD_BASE32_ALPHABET.length; i++) {
    map[CROCKFORD_BASE32_ALPHABET[i]] = i;
  }
  return map;
})();

function padBitCount(bitLength: number): number {
  const r = bitLength % 5;
  return r === 0 ? 0 : 5 - r;
}

/**
 * Encode an integer using exactly `bitLength` significant bits, MSB-first,
 * with the minimum number of leading zero bits so the total is a multiple of 5.
 */
export function encodeCrockfordBase32Bits(value: bigint, bitLength: number): string {
  if (bitLength <= 0) {
    throw new Error("bitLength must be positive");
  }
  const padBits = padBitCount(bitLength);
  const totalBits = bitLength + padBits;
  const charCount = totalBits / 5;
  const shifted = value << BigInt(padBits);
  let result = "";
  for (let i = 0; i < charCount; i++) {
    const shift = totalBits - 5 * (i + 1);
    const quintet = Number((shifted >> BigInt(shift)) & 0x1fn);
    result += CROCKFORD_BASE32_ALPHABET[quintet];
  }
  return result;
}

export function decodeCrockfordBase32Bits(encoded: string, bitLength: number): Result<bigint, Error> {
  if (bitLength <= 0) {
    return err(new Error("bitLength must be positive"));
  }
  const padBits = padBitCount(bitLength);
  const totalBits = encoded.length * 5;
  if (totalBits !== bitLength + padBits) {
    return err(new Error("encoded length does not match bitLength"));
  }
  let shifted = 0n;
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    if (ch === undefined) {
      return err(new Error("invalid encoded string"));
    }
    const upper = ch.toUpperCase();
    const val = DECODE_MAP[upper];
    if (val === undefined) {
      return err(new Error(`invalid Crockford Base32 character: ${ch}`));
    }
    shifted = (shifted << 5n) | BigInt(val);
  }
  return ok(shifted >> BigInt(padBits));
}

/** XXH64-sized value (13 Crockford chars). */
export function encodeUint64AsCrockford(value: bigint): string {
  const masked = value & 0xffff_ffff_ffff_ffffn;
  return encodeCrockfordBase32Bits(masked, 64);
}

export function decodeCrockfordToUint64(encoded: string): Result<bigint, Error> {
  const decoded = decodeCrockfordBase32Bits(encoded, 64);
  if (!decoded.ok) {
    return decoded;
  }
  return ok(decoded.value & 0xffff_ffff_ffff_ffffn);
}
