export function printCliLine(line: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI user-facing output
  console.log(line);
}

export function printCliError(line: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI user-facing errors
  console.error(line);
}
