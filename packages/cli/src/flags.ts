/** Minimal `--key value` flag parser — zero-dependency by design for a lean CLI. */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      flags[arg.slice(2)] = args[i + 1] ?? "";
      i++;
    }
  }
  return flags;
}
