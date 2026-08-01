// Beat-local math expressions for layer `drive` channels (wiggle, sin offsets, etc.).
// No eval() — tokenized + parsed allowlist only.

export const DRIVE_CHANNELS = ["x", "y", "scale", "opacity", "rotate", "scaleX", "scaleY", "anchorX", "anchorY"] as const;

export type DriveContext = {
  t: number; // beat-local seconds
  p: number; // beat progress 0..1
  dur: number; // beat duration seconds
  seed: number; // deterministic wiggle phase per layer
};

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  lerp: (a, b, t) => a + (b - a) * t,
  noise: (t) => hash(t),
  wiggle: (freq, amp, t, seed) => amp * (2 * hash(t * freq + seed) - 1),
};

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ("+-*/%^(),".includes(c)) {
      if (c === "(") out.push({ k: "lp" });
      else if (c === ")") out.push({ k: "rp" });
      else if (c === ",") out.push({ k: "comma" });
      else out.push({ k: "op", v: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE+-]/.test(src[j])) j++;
      out.push({ k: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character '${c}'`);
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[], private ctx: DriveContext) {}

  parse(): number {
    const v = this.expr();
    if (this.i < this.toks.length) throw new Error("trailing tokens");
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private eat(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new Error("unexpected end");
    return t;
  }

  private expr(): number {
    let v = this.term();
    while (this.peek()?.k === "op" && (this.peek() as Tok & { v: string }).v.match(/^[+-]$/)) {
      const op = (this.eat() as { k: "op"; v: string }).v;
      const r = this.term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    while (this.peek()?.k === "op" && (this.peek() as Tok & { v: string }).v.match(/^[*/%]$/)) {
      const op = (this.eat() as { k: "op"; v: string }).v;
      const r = this.unary();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }

  private unary(): number {
    if (this.peek()?.k === "op" && (this.peek() as { k: "op"; v: string }).v === "-") {
      this.eat();
      return -this.unary();
    }
    if (this.peek()?.k === "op" && (this.peek() as { k: "op"; v: string }).v === "+") {
      this.eat();
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    let v = this.atom();
    if (this.peek()?.k === "op" && (this.peek() as { k: "op"; v: string }).v === "^") {
      this.eat();
      v = Math.pow(v, this.unary());
    }
    return v;
  }

  private atom(): number {
    const t = this.peek();
    if (!t) throw new Error("unexpected end");
    if (t.k === "num") {
      this.eat();
      return t.v;
    }
    if (t.k === "id") {
      const name = (this.eat() as { k: "id"; v: string }).v;
      if (name === "t") return this.ctx.t;
      if (name === "p") return this.ctx.p;
      if (name === "dur") return this.ctx.dur;
      if (name === "pi") return Math.PI;
      if (name === "tau") return Math.PI * 2;
      if (name === "seed") return this.ctx.seed;
      const fn = FUNCS[name];
      if (!fn) throw new Error(`unknown identifier '${name}'`);
      if (this.peek()?.k !== "lp") throw new Error(`expected '(' after ${name}`);
      this.eat();
      const args: number[] = [];
      if (this.peek()?.k !== "rp") {
        args.push(this.expr());
        while (this.peek()?.k === "comma") {
          this.eat();
          args.push(this.expr());
        }
      }
      if (this.peek()?.k !== "rp") throw new Error(`expected ')'`);
      this.eat();
      if (name === "wiggle") {
        const freq = args[0] ?? 2;
        const amp = args[1] ?? 1;
        return FUNCS.wiggle(freq, amp, this.ctx.t, this.ctx.seed);
      }
      if (name === "noise" && args.length === 0) return hash(this.ctx.t + this.ctx.seed);
      return fn(...args);
    }
    if (t.k === "lp") {
      this.eat();
      const v = this.expr();
      if (this.peek()?.k !== "rp") throw new Error("expected ')'");
      this.eat();
      return v;
    }
    throw new Error("bad expression");
  }
}

/** Parse and evaluate a drive expression. Throws on syntax/unknown ids. */
export function evalDriveExpr(src: string, ctx: DriveContext): number {
  const trimmed = src.trim();
  if (!trimmed) throw new Error("empty expression");
  const toks = tokenize(trimmed);
  return new Parser(toks, ctx).parse();
}

/** Validate syntax without needing real timing context. */
export function validateDriveExpr(src: string): string | null {
  try {
    evalDriveExpr(src, { t: 0.5, p: 0.5, dur: 2, seed: 1 });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function hashLayerSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 10000) / 1000;
}
