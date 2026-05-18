function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Phase 4 placeholder — thread commands are not implemented yet. */
export function cmdThreadPlaceholder(command: string): never {
  fail(`uwf thread ${command}: not implemented (Phase 4)`);
}
