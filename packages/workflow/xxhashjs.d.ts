declare module "xxhashjs" {
  type Digest = {
    toString(radix?: number): string;
  };

  type Hasher64 = {
    update(data: Buffer): Hasher64;
    digest(): Digest;
  };

  type XXH = {
    h64(seed: number): Hasher64;
  };

  const XXH: XXH;
  export default XXH;
}
