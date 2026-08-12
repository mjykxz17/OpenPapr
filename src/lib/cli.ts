export function parseUserArg(argv: string[]): number {
  const i = argv.indexOf("--user");
  if (i === -1) return 1;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --user value: ${argv[i + 1]}`);
  return n;
}
