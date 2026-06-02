const originalExit = process.exit;

process.exit = ((code?: number) => {
  throw new Error(`process.exit(${code ?? 1})`);
}) as typeof process.exit;

export { originalExit };
