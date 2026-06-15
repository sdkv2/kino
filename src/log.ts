const c = { dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };
export const log = {
  info: (m: string) => console.error(`${c.cyan}›${c.reset} ${m}`),
  step: (m: string) => console.error(`${c.dim}  ·${c.reset} ${m}`),
  warn: (m: string) => console.error(`${c.yellow}!${c.reset} ${m}`),
  error: (m: string) => console.error(`${c.red}✗${c.reset} ${m}`),
  ok: (m: string) => console.error(`${c.cyan}✓${c.reset} ${m}`),
};
