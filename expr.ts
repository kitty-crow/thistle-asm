export interface Lin {
  n: bigint;
  t: Map<string, bigint>;
}

const val = (n = 0n): Lin => ({ n, t: new Map() });
const term = (s: string): Lin => ({ n: 0n, t: new Map([[s, 1n]]) });

const add = (a: Lin, b: Lin, k = 1n): Lin => {
  const z: Lin = { n: a.n + b.n * k, t: new Map(a.t) };
  for (const [s, n] of b.t) {
    const x = (z.t.get(s) ?? 0n) + n * k;
    if (x) z.t.set(s, x); else z.t.delete(s);
  }
  return z;
};

const abs = (a: Lin, op: string): bigint => {
  if (a.t.size) throw new Error(`${op} needs an absolute expression`);
  return a.n;
};

export abstract class Exp {
  abstract eval(get: (s: string) => Lin | undefined): Lin;
}

class NumExp extends Exp {
  constructor(private readonly n: bigint) { super(); }
  override eval(): Lin { return val(this.n); }
}

class SymExp extends Exp {
  constructor(private readonly s: string) { super(); }
  override eval(get: (s: string) => Lin | undefined): Lin { return get(this.s) ?? term(this.s); }
}

class UniExp extends Exp {
  constructor(private readonly op: string, private readonly a: Exp) { super(); }
  override eval(get: (s: string) => Lin | undefined): Lin {
    const x = this.a.eval(get);
    if (this.op === "+") return x;
    if (this.op === "-") return add(val(), x, -1n);
    const n = abs(x, this.op);
    return val(this.op === "~" ? ~n : this.op === "!" ? BigInt(!n) : n);
  }
}

class BinExp extends Exp {
  constructor(private readonly op: string, private readonly a: Exp, private readonly b: Exp) { super(); }
  override eval(get: (s: string) => Lin | undefined): Lin {
    const a = this.a.eval(get), b = this.b.eval(get);
    if (this.op === "+") return add(a, b);
    if (this.op === "-") return add(a, b, -1n);
    if (this.op === "*" && !a.t.size) return add(val(), b, a.n);
    if (this.op === "*" && !b.t.size) return add(val(), a, b.n);
    const x = abs(a, this.op), y = abs(b, this.op);
    switch (this.op) {
      case "*": return val(x * y);
      case "/": if (!y) throw new Error("division by zero"); return val(x / y);
      case "%": if (!y) throw new Error("division by zero"); return val(x % y);
      case "<<": return val(x << y);
      case ">>": return val(x >> y);
      case "&": return val(x & y);
      case "^": return val(x ^ y);
      case "|": return val(x | y);
      case "==": return val(BigInt(x === y));
      case "!=": return val(BigInt(x !== y));
      case "<": return val(BigInt(x < y));
      case "<=": return val(BigInt(x <= y));
      case ">": return val(BigInt(x > y));
      case ">=": return val(BigInt(x >= y));
      case "&&": return val(BigInt(!!x && !!y));
      case "||": return val(BigInt(!!x || !!y));
      default: throw new Error(`unknown expression operator ${this.op}`);
    }
  }
}

interface Tok { k: "n" | "s" | "op" | "e"; s: string; }

const esc = (s: string): string => {
  if (s[0] !== "\\") return s;
  const m: Record<string, string> = { "\\": "\\", "'": "'", "\"": "\"", n: "\n", r: "\r", t: "\t", "0": "\0" };
  if (s[1] === "x") return String.fromCharCode(Number.parseInt(s.slice(2), 16));
  return m[s[1] ?? ""] ?? s.slice(1);
};

class Lex {
  private at = 0;
  constructor(private readonly s: string) {}

  next(): Tok {
    while (/\s/.test(this.s[this.at] ?? "")) this.at++;
    if (this.at >= this.s.length) return { k: "e", s: "" };
    const q = this.s.slice(this.at);
    const n = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+)/.exec(q);
    if (n) { this.at += n[0].length; return { k: "n", s: n[0] }; }
    const id = /^(?:[A-Za-z_.$][A-Za-z0-9_.$]*|[0-9]+[fb])/.exec(q);
    if (id) { this.at += id[0].length; return { k: "s", s: id[0] }; }
    if (q[0] === "'") {
      const m = /^'(\\(?:x[0-9a-fA-F]{2}|.)|[^'\\])'/.exec(q);
      if (!m) throw new Error("bad character literal");
      this.at += m[0].length;
      return { k: "n", s: String(esc(m[1]!).codePointAt(0) ?? 0) };
    }
    const op = /^(?:<<|>>|<=|>=|==|!=|&&|\|\||[()+\-*/%~!&|^<>])/.exec(q);
    if (!op) throw new Error(`bad expression token near '${q.slice(0, 12)}'`);
    this.at += op[0].length;
    return { k: "op", s: op[0] };
  }
}

const prec: Record<string, number> = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };

class Parser {
  private t: Tok;
  constructor(private readonly l: Lex) { this.t = l.next(); }

  parse(): Exp {
    const x = this.bin(1);
    if (this.t.k !== "e") throw new Error(`unexpected '${this.t.s}' in expression`);
    return x;
  }

  private bin(p: number): Exp {
    let a = this.unary();
    while (this.t.k === "op" && (prec[this.t.s] ?? 0) >= p) {
      const op = this.t.s, q = prec[op]!;
      this.t = this.l.next();
      a = new BinExp(op, a, this.bin(q + 1));
    }
    return a;
  }

  private unary(): Exp {
    if (this.t.k === "op" && ["+", "-", "~", "!"].includes(this.t.s)) {
      const op = this.t.s; this.t = this.l.next(); return new UniExp(op, this.unary());
    }
    if (this.t.k === "op" && this.t.s === "(") {
      this.t = this.l.next(); const x = this.bin(1);
      if (this.t.k !== "op" || this.t.s !== ")") throw new Error("missing ')' in expression");
      this.t = this.l.next(); return x;
    }
    if (this.t.k === "n") {
      const s = this.t.s; this.t = this.l.next();
      return new NumExp(/^0[xX]/.test(s) ? BigInt(s) : /^0[bB]/.test(s) ? BigInt(s) : /^0[oO]/.test(s) ? BigInt(s) : BigInt(s));
    }
    if (this.t.k === "s") { const s = this.t.s; this.t = this.l.next(); return new SymExp(s); }
    throw new Error(`expression expected near '${this.t.s}'`);
  }
}

export const expr = (s: string): Exp => new Parser(new Lex(s.trim())).parse();
export const absolute = (s: string, get: (k: string) => bigint | undefined = () => undefined): bigint => {
  const x = expr(s).eval(k => { const n = get(k); return n === undefined ? undefined : val(n); });
  if (x.t.size) throw new Error(`unresolved symbol ${[...x.t.keys()][0]}`);
  return x.n;
};
