export function shouldUseColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

export function highlightLiveRole(name: string): string {
  if (!shouldUseColor()) {
    return name;
  }
  return `\x1b[1m\x1b[36m${name}\x1b[0m`;
}

export function dimGreyLine(line: string): string {
  if (!shouldUseColor()) {
    return line;
  }
  return `\x1b[2m\x1b[90m${line}\x1b[0m`;
}
