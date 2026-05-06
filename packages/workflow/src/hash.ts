import { Buffer } from "node:buffer";

import XXH from "xxhashjs";

import { encodeUint64AsCrockford } from "./base32.js";

function digestToUint64(digest: { toString(radix?: number): string }): bigint {
  const hex = digest.toString(16).padStart(16, "0");
  return BigInt(`0x${hex}`);
}

/** XXH64 (seed 0) over bundle bytes, encoded as 13-char Crockford Base32. */
export function hashWorkflowBundleBytes(data: Uint8Array): string {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const digest = XXH.h64(0).update(buf).digest();
  return encodeUint64AsCrockford(digestToUint64(digest));
}
