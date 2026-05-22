

export function uuid() {
  const now = Date.now();
  const randon = 1 + Math.random();
  return Math.round(now * randon).toString(36);
}
